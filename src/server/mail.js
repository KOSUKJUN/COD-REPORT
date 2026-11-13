import { existsSync } from "node:fs";
import nodemailer from "nodemailer";
import puppeteer from "puppeteer-core";
import { decryptSecret, encryptSecret } from "./datasources.js";
import { exportFileName } from "../report-export/document-model.js";

export const MAIL_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS report_mail_server (
    id TINYINT NOT NULL PRIMARY KEY, host VARCHAR(253) NOT NULL, port SMALLINT UNSIGNED NOT NULL,
    security VARCHAR(16) NOT NULL, username VARCHAR(255) NOT NULL, password_encrypted TEXT NULL,
    sender VARCHAR(254) NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS report_template_mail (
    template_id VARCHAR(64) NOT NULL PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT FALSE,
    recipients_json TEXT NOT NULL, users_json TEXT NOT NULL, subject VARCHAR(200) NOT NULL,
    body TEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS report_mail_runs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, template_id VARCHAR(64) NOT NULL,
    report_id BIGINT UNSIGNED NULL, source VARCHAR(16) NOT NULL, status VARCHAR(16) NOT NULL,
    error_message VARCHAR(1000) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

function invalid(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const emailPattern = /^[^\s@,;<>\r\n]+@[^\s@,;<>\r\n]+\.[^\s@,;<>\r\n]+$/;
function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && emailPattern.test(value);
}

export function validateServer(input) {
  const host = typeof input?.host === "string" ? input.host.trim() : "";
  const sender = typeof input?.sender === "string" ? input.sender.trim() : "";
  const username = typeof input?.username === "string" ? input.username.trim() : "";
  const port = Number(input?.port);
  if (!host || host.length > 253 || !/^[a-z0-9.:-]+$/i.test(host)) throw invalid(400, "메일 서버 주소가 올바르지 않습니다.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid(400, "메일 서버 포트를 확인해 주세요.");
  if (!["tls", "starttls"].includes(input?.security)) throw invalid(400, "TLS 연결 방식을 선택해 주세요.");
  if (!validEmail(sender)) throw invalid(400, "보내는 사람 이메일 주소를 확인해 주세요.");
  if (username.length > 255 || /[\r\n]/.test(username)) throw invalid(400, "메일 서버 사용자 이름이 올바르지 않습니다.");
  if (input.password !== undefined && (typeof input.password !== "string" || input.password.length > 1000)) throw invalid(400, "메일 서버 비밀번호가 올바르지 않습니다.");
  return { host, port, security: input.security, username, sender, password: input.password || "" };
}

export function validateMailSettings(input) {
  if (typeof input?.enabled !== "boolean" || !Array.isArray(input.recipients) || !Array.isArray(input.users)) throw invalid(400, "메일 전송 설정 형식이 올바르지 않습니다.");
  const recipients = [...new Set(input.recipients.map((address) => typeof address === "string" ? address.trim() : address))];
  const users = [...new Set(input.users)];
  if (recipients.length > 100 || recipients.some((address) => !validEmail(address))) throw invalid(400, "받는 사람 이메일 주소를 확인해 주세요. 최대 100개까지 입력할 수 있습니다.");
  if (users.length > 100 || users.some((id) => typeof id !== "string" || !id || id.length > 64)) throw invalid(400, "받는 사람 사용자 목록이 올바르지 않습니다.");
  if (input.enabled && !recipients.length && !users.length) throw invalid(400, "자동 전송할 받는 사람을 지정해 주세요.");
  if (typeof input.subject !== "string" || input.subject.length > 200 || /[\r\n]/.test(input.subject)) throw invalid(400, "메일 제목은 줄바꿈 없이 200자 이내로 입력해 주세요.");
  if (typeof input.body !== "string" || input.body.length > 10000) throw invalid(400, "메일 본문은 10,000자 이내로 입력해 주세요.");
  return { enabled: input.enabled, recipients, users, subject: input.subject.trim(), body: input.body };
}

export async function getMailServer(pool, includePassword = false) {
  const [rows] = await pool.query("SELECT host, port, security, username, sender, password_encrypted AS passwordEncrypted FROM report_mail_server WHERE id = 1");
  if (!rows.length) return null;
  const { passwordEncrypted, ...settings } = rows[0];
  return { ...settings, hasPassword: Boolean(passwordEncrypted), ...(includePassword ? { password: decryptSecret(passwordEncrypted) } : {}) };
}

export async function saveMailServer(pool, input) {
  const settings = validateServer(input);
  const existing = await getMailServer(pool, true);
  const password = settings.password || (existing?.username === settings.username ? existing.password : "");
  if (settings.username && !password) throw invalid(400, "메일 서버 인증 비밀번호를 입력해 주세요.");
  await pool.execute(
    `INSERT INTO report_mail_server (id, host, port, security, username, password_encrypted, sender)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE host=VALUES(host), port=VALUES(port), security=VALUES(security),
       username=VALUES(username), password_encrypted=VALUES(password_encrypted), sender=VALUES(sender)`,
    [settings.host, settings.port, settings.security, settings.username, settings.username ? encryptSecret(password) : null, settings.sender],
  );
  return getMailServer(pool);
}

export async function getTemplateMail(pool, id) {
  const [rows] = await pool.execute("SELECT enabled, recipients_json AS recipients, users_json AS users, subject, body FROM report_template_mail WHERE template_id = ?", [id]);
  if (!rows.length) return { enabled: false, recipients: [], users: [], subject: "", body: "" };
  return { ...rows[0], enabled: Boolean(rows[0].enabled), recipients: JSON.parse(rows[0].recipients), users: JSON.parse(rows[0].users) };
}

export async function saveTemplateMail(pool, id, input) {
  const settings = validateMailSettings(input);
  if (settings.users.length) {
    const [rows] = await pool.query("SELECT USER_CD AS id FROM TM_USER WHERE USE_YN = 'Y'");
    const allowed = new Set(rows.map((row) => row.id));
    if (settings.users.some((user) => !allowed.has(user))) throw invalid(400, "사용 중인 사용자만 받는 사람으로 지정할 수 있습니다.");
  }
  await pool.execute(
    `INSERT INTO report_template_mail (template_id, enabled, recipients_json, users_json, subject, body)
     VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),
     recipients_json=VALUES(recipients_json), users_json=VALUES(users_json), subject=VALUES(subject), body=VALUES(body)`,
    [id, settings.enabled, JSON.stringify(settings.recipients), JSON.stringify(settings.users), settings.subject, settings.body],
  );
  return settings;
}

function transport(server) {
  return nodemailer.createTransport({
    host: server.host, port: server.port, secure: server.security === "tls",
    requireTLS: server.security === "starttls", connectionTimeout: 10000, greetingTimeout: 10000,
    socketTimeout: 30000, ...(server.username ? { auth: { user: server.username, pass: server.password } } : {}),
  });
}

export async function verifyMailServer(pool) {
  const server = await getMailServer(pool, true);
  if (!server) throw invalid(400, "리포트 설정에서 메일 서버를 먼저 저장해 주세요.");
  const smtp = transport(server);
  try { await smtp.verify(); } finally { smtp.close(); }
}

function browserPath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
  ];
  const path = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!path) throw invalid(503, "PDF 생성용 Chromium을 찾을 수 없습니다. CHROME_PATH를 설정해 주세요.");
  return path;
}

export async function renderReportPdf(report, port) {
  const browser = await puppeteer.launch({
    executablePath: browserPath(), headless: true,
    args: process.env.NODE_ENV === "production" && process.platform === "linux" ? ["--no-sandbox", "--disable-setuid-sandbox"] : [],
  });
  try {
    const page = await browser.newPage();
    const base = `http://127.0.0.1:${port}`;
    let blockedResource = false;
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      if (url.startsWith(`${base}/`) || url.startsWith("data:") || url.startsWith("blob:")) request.continue();
      else { blockedResource = true; request.abort(); }
    });
    await page.goto(`${base}/mail-render.html`, { waitUntil: "networkidle0", timeout: 30000 });
    await page.waitForFunction(() => typeof window.renderMailReport === "function", { timeout: 10000 });
    let timer;
    let encoded;
    try {
      encoded = await Promise.race([
        page.evaluate(async (data) => window.renderMailReport(data), report),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("PDF 생성 시간이 초과되었습니다.")), 90000);
        }),
      ]);
    } finally { clearTimeout(timer); }
    if (blockedResource) throw new Error("외부 리소스를 포함한 보고서는 안전하게 PDF로 변환할 수 없습니다.");
    return Buffer.from(encoded, "base64");
  } finally {
    await browser.close();
  }
}

export async function sendReportMail(pool, templateId, reportId, report, source, port, { render = renderReportPdf, createTransport = transport } = {}) {
  const settings = await getTemplateMail(pool, templateId);
  if (source === "schedule" && !settings.enabled) return false;
  let accepted = false;
  try {
    const server = await getMailServer(pool, true);
    if (!server) throw invalid(400, "리포트 설정에서 메일 서버를 먼저 저장해 주세요.");
    const addresses = [...settings.recipients];
    if (settings.users.length) {
      const [users] = await pool.query("SELECT USER_CD AS id, EMAIL AS email FROM TM_USER WHERE USE_YN = 'Y'");
      for (const id of settings.users) {
        const user = users.find((item) => item.id === id);
        if (!user || !validEmail(user.email)) throw invalid(400, "선택한 사용자 중 사용 중지되었거나 이메일이 없는 사용자가 있습니다.");
        addresses.push(user.email);
      }
    }
    const recipients = [...new Map(addresses.map((address) => [address.toLowerCase(), address])).values()];
    if (!recipients.length) throw invalid(400, "받는 사람을 지정해 주세요.");
    const pdf = await render(report, port);
    const smtp = createTransport(server);
    try {
      const result = await smtp.sendMail({
        from: server.sender, to: recipients, subject: settings.subject || `${report.templateName || "보고서"} - ${report.date}`,
        text: settings.body || "보고서를 첨부합니다.",
        attachments: [{ filename: exportFileName(report, "pdf"), content: pdf, contentType: "application/pdf" }],
      });
      accepted = result.accepted.length > 0;
      if (!accepted) throw new Error("메일 서버가 받는 사람을 수락하지 않았습니다.");
      if (result.rejected.length) throw new Error(`일부 받는 사람에게 전송하지 못했습니다: ${result.rejected.join(", ")}`);
    } finally { smtp.close(); }
    await pool.execute("INSERT INTO report_mail_runs (template_id, report_id, source, status) VALUES (?, ?, ?, 'succeeded')", [templateId, reportId, source]);
    return true;
  } catch (error) {
    if (accepted) error.message += " 일부 또는 전체 메일이 이미 전송되었을 수 있으므로 재전송 전 확인하세요.";
    try {
      await pool.execute("INSERT INTO report_mail_runs (template_id, report_id, source, status, error_message) VALUES (?, ?, ?, 'failed', ?)", [templateId, reportId, source, String(error.message).slice(0, 1000)]);
    } catch (logError) {
      console.error("메일 전송 이력 저장 실패:", logError.message);
    }
    throw error;
  }
}
