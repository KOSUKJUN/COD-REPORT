import test from "node:test";
import assert from "node:assert/strict";
import { getMailServer, saveMailServer, saveTemplateMail, sendReportMail, validateMailSettings, validateServer } from "../src/server/mail.js";

test("validates SMTP configuration and email headers", () => {
  const server = { host: "smtp.example.com", port: 587, security: "starttls", username: "user", password: "secret", sender: "sender@example.com" };
  assert.equal(validateServer(server).port, 587);
  assert.throws(() => validateServer({ ...server, sender: "a@example.com\nBcc: other@example.com" }), /이메일/);
  assert.throws(() => validateServer({ ...server, security: "plain" }), /TLS/);
  assert.throws(() => validateServer({ ...server, port: 65536 }), /포트/);
  const settings = { enabled: true, recipients: ["a@example.com", "a@example.com"], users: [], subject: "제목", body: "내용" };
  assert.deepEqual(validateMailSettings(settings).recipients, ["a@example.com"]);
  assert.throws(() => validateMailSettings({ ...settings, recipients: [] }), /받는 사람/);
  assert.throws(() => validateMailSettings({ ...settings, subject: "제목\r\nBcc: a@example.com" }), /제목/);
  assert.throws(() => validateMailSettings({ ...settings, recipients: ["not-an-address"] }), /이메일/);
});

test("SMTP password is encrypted, write-only and retained only for the same username", async (t) => {
  const previous = process.env.DATASOURCE_SECRET;
  process.env.DATASOURCE_SECRET = "test-mail-secret";
  t.after(() => { if (previous === undefined) delete process.env.DATASOURCE_SECRET; else process.env.DATASOURCE_SECRET = previous; });
  let stored;
  const pool = {
    async query() { return [stored ? [stored] : []]; },
    async execute(_sql, values) {
      stored = { host: values[0], port: values[1], security: values[2], username: values[3], passwordEncrypted: values[4], sender: values[5] };
      return [{}];
    },
  };
  const config = { host: "smtp.example.com", port: 465, security: "tls", username: "user", password: "password", sender: "sender@example.com" };
  const publicConfig = await saveMailServer(pool, config);
  assert.equal(publicConfig.hasPassword, true);
  assert.equal(publicConfig.password, undefined);
  assert.ok(stored.passwordEncrypted.startsWith("v1:"));
  assert.ok(!stored.passwordEncrypted.includes("password"));
  await saveMailServer(pool, { ...config, password: "" });
  assert.equal((await getMailServer(pool, true)).password, "password");
  await assert.rejects(saveMailServer(pool, { ...config, username: "other", password: "" }), /비밀번호/);
  await saveMailServer(pool, { ...config, username: "", password: "" });
  assert.equal(stored.passwordEncrypted, null);
});

test("template mail configuration rejects missing or inactive users", async () => {
  const writes = [];
  const pool = {
    async query() { return [[{ id: "usr-active" }]]; },
    async execute(sql, params) { writes.push({ sql, params }); return [{}]; },
  };
  const settings = { enabled: true, recipients: [], users: ["usr-active"], subject: "", body: "" };
  await saveTemplateMail(pool, "custom-test", settings);
  assert.deepEqual(JSON.parse(writes[0].params[3]), ["usr-active"]);
  await assert.rejects(saveTemplateMail(pool, "custom-test", { ...settings, users: ["usr-disabled"] }), /사용 중인 사용자/);
});

test("sends a generated PDF to the saved recipients and records success or failure", async () => {
  const logs = [];
  let enabled = 1;
  const pool = {
    async query(sql) {
      if (sql.includes("report_mail_server")) return [[{ host: "smtp.example.com", port: 465, security: "tls", username: "", sender: "sender@example.com", passwordEncrypted: null }]];
      if (sql.includes("TM_USER")) return [[{ id: "usr-1", email: "other@example.com" }]];
      throw new Error("unexpected query");
    },
    async execute(sql, params) {
      if (sql.startsWith("SELECT")) return [[{ enabled, recipients: '["other@example.com","direct@example.com"]', users: '["usr-1"]', subject: "", body: "" }]];
      logs.push({ sql, params });
      return [{}];
    },
  };
  const report = { date: "2026-11-08", templateName: "보고서", reportTitle: "보고서", blocks: [] };
  const pdf = Buffer.from("%PDF-test");
  let mail;
  const options = {
    render: async (actualReport, port) => { assert.equal(actualReport, report); assert.equal(port, 3001); return pdf; },
    createTransport: () => ({ sendMail: async (value) => { mail = value; return { accepted: value.to, rejected: [] }; }, close() {} }),
  };
  assert.equal(await sendReportMail(pool, "custom-test", 42, report, "schedule", 3001, options), true);
  assert.deepEqual(mail.to, ["other@example.com", "direct@example.com"]);
  assert.equal(mail.subject, "보고서 - 2026-11-08");
  assert.equal(mail.attachments[0].content, pdf);
  assert.match(logs[0].sql, /succeeded/);
  enabled = 0;
  assert.equal(await sendReportMail(pool, "custom-test", 42, report, "schedule", 3001, options), false);
  assert.equal(logs.length, 1);
  await assert.rejects(sendReportMail(pool, "custom-test", 42, report, "manual", 3001, {
    ...options, createTransport: () => ({ sendMail: async () => ({ accepted: ["other@example.com"], rejected: ["direct@example.com"] }), close() {} }),
  }), /이미 전송되었을 수/);
  assert.match(logs[1].sql, /failed/);
});
