import "dotenv/config";
import express from "express";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  countQueryParameters,
  validateReadOnlyQuery,
} from "./src/sql-query.js";
import {
  DATASOURCE_SCHEMA_SQL,
  createDatasource,
  datasourceForTest,
  deleteDatasources,
  listDatasources,
  resolveDatasource,
  runExternalQuery,
  testDatasourceConnection,
  updateDatasource,
} from "./src/server/datasources.js";
import {
  getReportPeriod,
  getScheduleClock,
  isScheduleDue,
  isValidDateTimeInput,
  resolveDateRangeParameters,
  resolveScheduleParameters,
} from "./src/report-scheduler.js";
import {
  AUTH_SCHEMA_SQL,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  canViewTemplate,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  readSessionCookie,
  validatePassword,
  validateUserId,
  verifyPassword,
} from "./src/server/auth.js";
import { createUserAdminRouter, ensureUserAdminSchema } from "./src/server/user-admin.js";
import { AI_KEY_SCHEMA_SQL } from "./src/server/ai-keys.js";
import { AI_SETTINGS_SCHEMA_SQL } from "./src/server/ai-settings.js";
import { createAiRouter } from "./src/server/ai-routes.js";
import { createDefaultTemplates } from "./src/default-templates.js";
import { normalizePageSetup } from "./src/page-setup.js";
import {
  MAIL_SCHEMA_SQL, getMailServer, saveMailServer, verifyMailServer,
  getTemplateMail, saveTemplateMail, sendReportMail,
} from "./src/server/mail.js";

const root = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(
  process.env.PORT || (process.argv.includes("--production") ? 19080 : 3001),
);
let pool;
let reportSchemaReady;

function isDatabaseConfigured() {
  return Boolean(
    process.env.DB_HOST &&
      process.env.DB_USER &&
      process.env.DB_PASSWORD &&
      process.env.DB_NAME,
  );
}

function getPool() {
  if (!isDatabaseConfigured()) {
    const error = new Error("DB 접속 환경변수를 설정해 주세요.");
    error.status = 503;
    throw error;
  }

  pool ??= mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 4,
    waitForConnections: true,
    // 화면 하나가 API 여러 개를 동시에 부르므로(인증 확인만 요청마다 쿼리 3개) 대기열을 넉넉히 둔다.
    queueLimit: 64,
    multipleStatements: false,
    connectTimeout: 5000,
    dateStrings: true,
  });
  return pool;
}

async function ensureReportSchema() {
  if (!reportSchemaReady) {
    reportSchemaReady = (async () => {
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS reports (
          report_key VARCHAR(64) NOT NULL PRIMARY KEY,
          report_json LONGTEXT NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS report_documents (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          report_type VARCHAR(64) NOT NULL,
          report_date DATE NOT NULL,
          report_json LONGTEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_report_type_date (report_type, report_date),
          KEY ix_report_updated_at (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      const [reportIndexes] = await getPool().execute(
        `SELECT index_name FROM information_schema.statistics
         WHERE table_schema = DATABASE() AND table_name = 'report_documents'
           AND index_name = 'uq_report_type_date'`,
      );
      if (reportIndexes.length) {
        await getPool().query(
          "ALTER TABLE report_documents DROP INDEX uq_report_type_date",
        );
      }
      await getPool().query(`
        ALTER TABLE report_documents
          MODIFY COLUMN report_type VARCHAR(64) NOT NULL
      `);
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS report_templates (
          template_id VARCHAR(64) NOT NULL PRIMARY KEY,
          template_group VARCHAR(120) NOT NULL,
          template_name VARCHAR(120) NOT NULL,
          layout_type VARCHAR(16) NOT NULL,
          template_json LONGTEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ON UPDATE CURRENT_TIMESTAMP,
          KEY ix_template_group (template_group)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      for (const statement of AUTH_SCHEMA_SQL) {
        await getPool().query(statement);
      }
      await ensureUserAdminSchema(getPool());
      await getPool().query(`
        INSERT IGNORE INTO TC_ROLE (ROLE_CD, ROLE_NM) VALUES
          ('ADMIN', '관리자'), ('EDITOR', '에디터'), ('VIEWER', '뷰어'), ('MEMBER', '그룹 구성원')
      `);
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS report_schedules (
          template_id VARCHAR(64) NOT NULL PRIMARY KEY,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          frequency VARCHAR(16) NOT NULL,
          scheduled_time CHAR(5) NOT NULL,
          weekday TINYINT UNSIGNED NOT NULL DEFAULT 1,
          day_of_month TINYINT UNSIGNED NOT NULL DEFAULT 1,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS report_schedule_runs (
          template_id VARCHAR(64) NOT NULL,
          scheduled_date DATE NOT NULL,
          status VARCHAR(16) NOT NULL,
          error_message TEXT,
          started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP NULL,
          PRIMARY KEY (template_id, scheduled_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      await getPool().query(DATASOURCE_SCHEMA_SQL);
      await getPool().query(AI_KEY_SCHEMA_SQL);
      await getPool().query(AI_SETTINGS_SCHEMA_SQL);
      for (const statement of MAIL_SCHEMA_SQL) await getPool().query(statement);
      await getPool().query(`
        INSERT IGNORE INTO report_schedules
          (template_id, enabled, frequency, scheduled_time, weekday, day_of_month)
        SELECT template_id, TRUE, layout_type, '08:00', 1, 1
        FROM report_templates
      `);
      await getPool().query(`
        INSERT IGNORE INTO report_documents (report_type, report_date, report_json)
        SELECT
          JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.type')),
          STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.date')), '%Y-%m-%d'),
          report_json
        FROM reports
        WHERE report_key = 'latest'
          AND JSON_VALID(report_json)
          AND JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.type')) IN ('daily', 'weekly', 'monthly')
          AND JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.date')) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      `);
      await migrateLegacyTemplates();
    })()
      .catch((error) => {
        reportSchemaReady = undefined;
        throw error;
      });
  }
  await reportSchemaReady;
}

// 예전 기본 양식(daily/weekly/monthly)을 일반 양식으로 바꾼다.
// - 양식은 처음 한 번만 DB에 만든다(legacy_template_map에 기록). 이후 삭제해도 다시 생기지 않는다.
// - 예전 유형으로 저장된 리포트는 시작할 때마다 새 양식 id로 옮긴다.
async function migrateLegacyTemplates() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS legacy_template_map (
      legacy_type VARCHAR(16) NOT NULL PRIMARY KEY,
      template_id VARCHAR(64) NOT NULL,
      migrated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [mapped] = await getPool().query("SELECT legacy_type AS legacyType FROM legacy_template_map");
  const done = new Set(mapped.map((row) => row.legacyType));
  for (const template of createDefaultTemplates()) {
    if (done.has(template.legacyType)) continue;
    const id = `custom-${randomUUID()}`;
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO report_templates
          (template_id, template_group, template_name, layout_type, template_json)
         VALUES (?, ?, ?, ?, ?)`,
        [
          id,
          template.group,
          template.label,
          template.layoutType,
          JSON.stringify({
            layoutType: template.layoutType,
            blocks: template.blocks,
            pages: template.pages,
            headerFooter: null,
          }),
        ],
      );
      // 예전 기본 양식에는 자동 생성이 없었으므로 꺼진 상태로 만든다.
      await connection.execute(
        `INSERT INTO report_schedules
          (template_id, enabled, frequency, scheduled_time, weekday, day_of_month)
         VALUES (?, FALSE, ?, '08:00', 1, 1)`,
        [id, template.layoutType],
      );
      await connection.execute(
        "INSERT INTO legacy_template_map (legacy_type, template_id) VALUES (?, ?)",
        [template.legacyType, id],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  await getPool().query(`
    UPDATE report_documents d
    JOIN legacy_template_map m ON m.legacy_type = d.report_type
    SET d.report_type = m.template_id,
      d.report_json = JSON_SET(
        d.report_json,
        '$.type', m.template_id,
        '$.layoutType', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(d.report_json, '$.layoutType')), m.legacy_type)
      )
    WHERE JSON_VALID(d.report_json)
  `);
}

app.use(express.json({ limit: "20mb" }));

function authCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}

async function findSessionUser(token, request) {
  const tokenHash = hashSessionToken(token);
  if (!tokenHash) return null;
  const [rows] = await getPool().execute(
    `SELECT u.USER_CD AS userCd, u.USER_ID AS userId, u.USER_NM AS name,
       u.EMAIL AS email, u.USER_ROLE AS role, u.LOCK_CNT AS lockCount
     FROM TC_AUTH_SESSION s
     JOIN TM_USER u ON u.USER_CD = s.USER_CD
     WHERE s.TOKEN_HASH = ? AND s.EXPIRES_AT > UTC_TIMESTAMP()
       AND u.USE_YN = 'Y' AND u.LOCK_CNT < 5
     LIMIT 1`,
    [tokenHash],
  );
  const user = rows[0];
  if (!user) return null;
  const ip = request.ip || request.socket.remoteAddress || "";
  const [blocked] = await getPool().execute(
    "SELECT 1 FROM TC_USER_BLOCK_IP WHERE USER_CD = ? AND USR_BLOCK_IP = ? LIMIT 1",
    [user.userCd, ip],
  );
  if (blocked.length) return null;
  const [groups] = await getPool().execute(
    "SELECT GROUP_CD AS groupCd FROM TC_USER_GROUP_ROLE WHERE USER_CD = ?",
    [user.userCd],
  );
  return { ...user, role: String(user.role).toUpperCase(), groups: groups.map((row) => row.groupCd) };
}

async function createLoginSession(request, response, userCd) {
  const { token, hash } = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await getPool().execute("DELETE FROM TC_AUTH_SESSION WHERE EXPIRES_AT <= UTC_TIMESTAMP()");
  await getPool().execute(
    `INSERT INTO TC_AUTH_SESSION (TOKEN_HASH, USER_CD, EXPIRES_AT, IP, USER_AGENT)
     VALUES (?, ?, ?, ?, ?)`,
    [
      hash,
      userCd,
      expiresAt.toISOString().slice(0, 19).replace("T", " "),
      request.ip || request.socket.remoteAddress || null,
      String(request.get("user-agent") || "").slice(0, 500) || null,
    ],
  );
  response.cookie(SESSION_COOKIE_NAME, token, authCookieOptions());
}

async function adminCount() {
  const [rows] = await getPool().query("SELECT COUNT(*) AS count FROM TM_USER");
  return Number(rows[0].count);
}

function validateAuthInput(body) {
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!validateUserId(userId)) {
    const error = new Error("아이디는 영문, 숫자, 마침표, 밑줄, @, 하이픈으로 3~200자 입력해 주세요.");
    error.status = 400;
    throw error;
  }
  if (!name || name.length > 200) {
    const error = new Error("이름을 1~200자로 입력해 주세요.");
    error.status = 400;
    throw error;
  }
  if (!validatePassword(body?.password)) {
    const error = new Error("비밀번호는 12~256자로 입력해 주세요.");
    error.status = 400;
    throw error;
  }
  return { userId, name, password: body.password };
}

function sendAuthError(response, status, message) {
  response.status(status).json({ error: message });
}

app.get("/api/auth/status", async (request, response, next) => {
  try {
    await ensureReportSchema();
    const userCount = await adminCount();
    const token = readSessionCookie(request.get("cookie") || "");
    const user = userCount ? await findSessionUser(token, request) : null;
    response.set("Cache-Control", "no-store");
    response.json({ setupRequired: userCount === 0, user });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/setup", async (request, response, next) => {
  let connection;
  let lockAcquired = false;
  try {
    await ensureReportSchema();
    const { userId, name, password } = validateAuthInput(request.body);
    connection = await getPool().getConnection();
    const [lockRows] = await connection.query("SELECT GET_LOCK('cod_report_initial_admin', 5) AS acquired");
    lockAcquired = Number(lockRows[0]?.acquired) === 1;
    if (!lockAcquired) {
      sendAuthError(response, 503, "초기 관리자 설정을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const [existing] = await connection.query("SELECT USER_CD FROM TM_USER LIMIT 1");
    if (existing.length) {
      sendAuthError(response, 409, "초기 관리자 설정이 이미 완료되었습니다. 로그인해 주세요.");
      return;
    }
    const userCd = `usr-${randomUUID()}`;
    await connection.execute(
      `INSERT INTO TM_USER (USER_CD, USER_NM, USER_ID, PW, USER_ROLE, USE_YN)
       VALUES (?, ?, ?, ?, 'ADMIN', 'Y')`,
      [userCd, name, userId, await hashPassword(password)],
    );
    await createLoginSession(request, response, userCd);
    response.status(201).json({ user: { userCd, userId, name, role: "ADMIN", groups: [] } });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      sendAuthError(response, 409, "이미 사용 중인 아이디입니다.");
      return;
    }
    next(error);
  } finally {
    if (lockAcquired) {
      await connection?.query("SELECT RELEASE_LOCK('cod_report_initial_admin')");
    }
    connection?.release();
  }
});

app.post("/api/auth/login", async (request, response, next) => {
  try {
    await ensureReportSchema();
    const userId = typeof request.body?.userId === "string" ? request.body.userId.trim() : "";
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!userId || !password || userId.length > 200 || password.length > 256) {
      sendAuthError(response, 400, "아이디와 비밀번호를 확인해 주세요.");
      return;
    }
    const [rows] = await getPool().execute(
      `SELECT USER_CD AS userCd, USER_ID AS userId, USER_NM AS name,
         PW AS passwordHash, USER_ROLE AS role, LOCK_CNT AS lockCount, USE_YN AS enabled
       FROM TM_USER WHERE USER_ID = ? LIMIT 1`,
      [userId],
    );
    const user = rows[0];
    if (!user || user.enabled !== "Y" || Number(user.lockCount) >= 5 ||
      !(await verifyPassword(password, user.passwordHash))) {
      if (user && Number(user.lockCount) < 5) {
        await getPool().execute(
          "UPDATE TM_USER SET LOCK_CNT = LOCK_CNT + 1 WHERE USER_CD = ?",
          [user.userCd],
        );
      }
      sendAuthError(response, 401, "아이디 또는 비밀번호를 확인해 주세요. 5회 실패 시 관리자에게 잠금 해제를 요청해야 합니다.");
      return;
    }
    const ip = request.ip || request.socket.remoteAddress || "";
    const [blocked] = await getPool().execute(
      "SELECT 1 FROM TC_USER_BLOCK_IP WHERE USER_CD = ? AND USR_BLOCK_IP = ? LIMIT 1",
      [user.userCd, ip],
    );
    if (blocked.length) {
      sendAuthError(response, 403, "현재 네트워크에서는 로그인할 수 없습니다.");
      return;
    }
    await getPool().execute(
      "UPDATE TM_USER SET LOCK_CNT = 0, LAST_LOGIN_AT = UTC_TIMESTAMP() WHERE USER_CD = ?",
      [user.userCd],
    );
    await createLoginSession(request, response, user.userCd);
    const [groups] = await getPool().execute(
      "SELECT GROUP_CD AS groupCd FROM TC_USER_GROUP_ROLE WHERE USER_CD = ?",
      [user.userCd],
    );
    response.set("Cache-Control", "no-store");
    response.json({
      user: {
        userCd: user.userCd,
        userId: user.userId,
        name: user.name,
        role: String(user.role).toUpperCase(),
        groups: groups.map((row) => row.groupCd),
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", async (request, response, next) => {
  try {
    await ensureReportSchema();
    const tokenHash = hashSessionToken(readSessionCookie(request.get("cookie") || ""));
    if (tokenHash) {
      await getPool().execute("DELETE FROM TC_AUTH_SESSION WHERE TOKEN_HASH = ?", [tokenHash]);
    }
    response.clearCookie(SESSION_COOKIE_NAME, { ...authCookieOptions(), maxAge: undefined });
    response.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.use("/api", async (request, response, next) => {
  try {
    await ensureReportSchema();
    const token = readSessionCookie(request.get("cookie") || "");
    const user = await findSessionUser(token, request);
    if (!user) {
      sendAuthError(response, 401, "로그인이 필요합니다.");
      return;
    }
    request.authUser = user;
    response.set("Cache-Control", "no-store");
    next();
  } catch (error) {
    next(error);
  }
});

function requireRoles(...roles) {
  return (request, response, next) => {
    if (!roles.includes(request.authUser?.role)) {
      sendAuthError(response, 403, "이 기능을 사용할 권한이 없습니다.");
      return;
    }
    next();
  };
}

function requireSameOrigin(request, response, next) {
  const origin = request.get("origin");
  if (!origin || origin !== `${request.protocol}://${request.get("host")}`) {
    return response.status(403).json({ error: "동일한 사이트에서 요청해 주세요." });
  }
  next();
}

app.use("/api", createAiRouter({ getPool, requireRoles, requireSameOrigin }));

function validateReportType(type) {
  return ["daily", "weekly", "monthly"].includes(type) ||
    (typeof type === "string" && /^custom-[0-9a-f-]{36}$/.test(type));
}

function isValidReportDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsedDate.valueOf()) &&
    parsedDate.toISOString().slice(0, 10) === date;
}

function validateReport(report) {
  const isCustomTemplate = typeof report?.type === "string" &&
    report.type.startsWith("custom-");
  if (
    !report ||
    !validateReportType(report.type) ||
    !isValidReportDate(report.date) ||
    !Array.isArray(report.blocks) ||
    (isCustomTemplate && !["daily", "weekly", "monthly"].includes(report.layoutType)) ||
    (report.pages !== undefined &&
      (!Array.isArray(report.pages) ||
        report.pages.some((page) => !page || !Array.isArray(page.blocks))))
  ) {
    const error = new Error("보고서 유형, 날짜 또는 요소 형식이 올바르지 않습니다.");
    error.status = 400;
    throw error;
  }
}

function validateTemplate(template) {
  if (
    !template ||
    typeof template.group !== "string" ||
    !template.group.trim() ||
    template.group.trim().length > 120 ||
    typeof template.label !== "string" ||
    !template.label.trim() ||
    template.label.trim().length > 120 ||
    !["daily", "weekly", "monthly"].includes(template.layoutType) ||
    !Array.isArray(template.blocks) ||
    (template.pages !== undefined &&
      (!Array.isArray(template.pages) ||
        template.pages.some((page) => !page || !Array.isArray(page.blocks)))) ||
    (template.headerFooter !== undefined &&
      template.headerFooter !== null &&
      (typeof template.headerFooter !== "object" || Array.isArray(template.headerFooter))) ||
    (template.pageSetup !== undefined &&
      template.pageSetup !== null &&
      (typeof template.pageSetup !== "object" || Array.isArray(template.pageSetup)))
  ) {
    const error = new Error("양식 그룹, 이름 또는 보고서 요소 형식이 올바르지 않습니다.");
    error.status = 400;
    throw error;
  }
}

function validateTemplateAccess(access = {}) {
  const normalizeIds = (ids, label) => {
    if (ids === undefined) return [];
    if (!Array.isArray(ids) || ids.length > 500 ||
      ids.some((id) => typeof id !== "string" || !id.trim() || id.length > 50)) {
      const error = new Error(`${label} 권한 목록 형식이 올바르지 않습니다.`);
      error.status = 400;
      throw error;
    }
    return [...new Set(ids.map((id) => id.trim()))];
  };
  if (!access || typeof access !== "object" || Array.isArray(access)) {
    const error = new Error("보고서 열람 권한 형식이 올바르지 않습니다.");
    error.status = 400;
    throw error;
  }
  return {
    groups: normalizeIds(access.groups, "그룹"),
    users: normalizeIds(access.users, "사용자"),
  };
}

async function loadTemplateAccess(templateId) {
  const [[groups], [users]] = await Promise.all([
    getPool().execute(
      "SELECT GROUP_CD AS id FROM TC_TEMPLATE_GROUP_ACL WHERE TEMPLATE_ID = ?",
      [templateId],
    ),
    getPool().execute(
      "SELECT USER_CD AS id FROM TC_TEMPLATE_USER_ACL WHERE TEMPLATE_ID = ?",
      [templateId],
    ),
  ]);
  return { groups: groups.map((row) => row.id), users: users.map((row) => row.id) };
}

// 모든 양식의 열람 권한을 쿼리 2개로 읽는다. 양식마다 따로 조회하면 목록이 길 때
// DB 연결 풀 대기열(queueLimit)이 넘쳐 "Queue limit reached"로 실패한다.
async function loadAllTemplateAccess() {
  const [[groups], [users]] = await Promise.all([
    getPool().query("SELECT TEMPLATE_ID AS templateId, GROUP_CD AS id FROM TC_TEMPLATE_GROUP_ACL"),
    getPool().query("SELECT TEMPLATE_ID AS templateId, USER_CD AS id FROM TC_TEMPLATE_USER_ACL"),
  ]);
  const accessById = new Map();
  const entry = (templateId) => {
    if (!accessById.has(templateId)) accessById.set(templateId, { groups: [], users: [] });
    return accessById.get(templateId);
  };
  for (const row of groups) entry(row.templateId).groups.push(row.id);
  for (const row of users) entry(row.templateId).users.push(row.id);
  return (templateId) => accessById.get(templateId) ?? { groups: [], users: [] };
}

async function replaceTemplateAccess(templateId, access) {
  const normalized = validateTemplateAccess(access);
  for (const [table, column, ids] of [
    ["TM_GROUP", "GROUP_CD", normalized.groups],
    ["TM_USER", "USER_CD", normalized.users],
  ]) {
    if (!ids.length) continue;
    const placeholders = ids.map(() => "?").join(",");
    const [existing] = await getPool().execute(
      `SELECT ${column} AS id FROM ${table} WHERE ${column} IN (${placeholders})`,
      ids,
    );
    if (existing.length !== ids.length) {
      const error = new Error("열람 권한에 존재하지 않거나 비활성화된 그룹·사용자가 포함되어 있습니다.");
      error.status = 400;
      throw error;
    }
  }
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("DELETE FROM TC_TEMPLATE_GROUP_ACL WHERE TEMPLATE_ID = ?", [templateId]);
    await connection.execute("DELETE FROM TC_TEMPLATE_USER_ACL WHERE TEMPLATE_ID = ?", [templateId]);
    if (normalized.groups.length) {
      const values = normalized.groups.map((groupId) => [templateId, groupId]);
      await connection.query(
        "INSERT INTO TC_TEMPLATE_GROUP_ACL (TEMPLATE_ID, GROUP_CD) VALUES ?",
        [values],
      );
    }
    if (normalized.users.length) {
      const values = normalized.users.map((userId) => [templateId, userId]);
      await connection.query(
        "INSERT INTO TC_TEMPLATE_USER_ACL (TEMPLATE_ID, USER_CD) VALUES ?",
        [values],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return normalized;
}

// accessFor를 넘기면 미리 읽어 둔 권한을 쓰고, 없으면 해당 양식만 조회한다.
async function canUserViewReportType(user, type, accessFor) {
  if (user.role === "ADMIN" || user.role === "EDITOR") return true;
  if (!validateReportType(type)) return false;
  // 예전 기본 양식 유형(daily/weekly/monthly)으로 남은 리포트는 권한을 지정할 수 없으므로 모든 사용자에게 공개한다.
  // (서버 시작 시 새 양식으로 옮기므로 보통은 남지 않는다.)
  if (!type.startsWith("custom-")) return true;
  const access = accessFor ? accessFor(type) : await loadTemplateAccess(type);
  return canViewTemplate(user, user.groups, access);
}

function validateSchedule(schedule) {
  if (
    !schedule ||
    typeof schedule.enabled !== "boolean" ||
    !["daily", "weekly", "monthly"].includes(schedule.frequency) ||
    typeof schedule.time !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time) ||
    !Number.isInteger(Number(schedule.weekday)) ||
    Number(schedule.weekday) < 0 ||
    Number(schedule.weekday) > 6 ||
    !Number.isInteger(Number(schedule.dayOfMonth)) ||
    Number(schedule.dayOfMonth) < 1 ||
    Number(schedule.dayOfMonth) > 31
  ) {
    const error = new Error("보고서 실행 일정 형식이 올바르지 않습니다.");
    error.status = 400;
    throw error;
  }
}

async function loadReport(type, date) {
  const [rows] = await getPool().execute(
    `SELECT report_json FROM report_documents
     WHERE report_type = ? AND report_date = ?
     ORDER BY updated_at DESC, id DESC LIMIT 1`,
    [type, date],
  );
  return rows.length ? JSON.parse(rows[0].report_json) : null;
}

async function saveReport(report) {
  validateReport(report);
  await ensureReportSchema();
  const [existing] = await getPool().execute(
    `SELECT id FROM report_documents
     WHERE report_type = ? AND report_date = ?
     ORDER BY updated_at DESC, id DESC LIMIT 1`,
    [report.type, report.date],
  );
  if (existing.length) {
    await getPool().execute(
      "UPDATE report_documents SET report_json = ? WHERE id = ?",
      [JSON.stringify(report), existing[0].id],
    );
    return Number(existing[0].id);
  }
  const [result] = await getPool().execute(
    "INSERT INTO report_documents (report_type, report_date, report_json) VALUES (?, ?, ?)",
    [report.type, report.date, JSON.stringify(report)],
  );
  return Number(result.insertId);
}

async function insertReport(report) {
  validateReport(report);
  await ensureReportSchema();
  const [result] = await getPool().execute(
    "INSERT INTO report_documents (report_type, report_date, report_json) VALUES (?, ?, ?)",
    [report.type, report.date, JSON.stringify(report)],
  );
  return Number(result.insertId);
}

// datasourceId 가 비어 있으면 리포트 DB, 있으면 접속정보에 등록된 외부 DB에서 실행한다.
async function executeBindingQuery(query, parameters, datasourceId = "") {
  const sql = validateReadOnlyQuery(query);
  if (!Array.isArray(parameters) || parameters.length > 100) {
    const error = new Error("쿼리 파라미터는 최대 100개까지 배열로 전달해 주세요.");
    error.status = 400;
    throw error;
  }
  const placeholderCount = countQueryParameters(sql);
  if (placeholderCount !== parameters.length) {
    const error = new Error(
      `쿼리의 ? 자리표시자는 ${placeholderCount}개인데 파라미터는 ${parameters.length}개입니다. 파라미터 개수를 맞춰 주세요.`,
    );
    error.status = 400;
    throw error;
  }
  if (datasourceId) {
    await ensureReportSchema();
    const datasource = await resolveDatasource(getPool(), datasourceId);
    return runExternalQuery(datasource, sql, parameters);
  }
  const connection = await getPool().getConnection();
  let transactionStarted = false;
  try {
    await connection.query("START TRANSACTION READ ONLY");
    transactionStarted = true;
    const [rows, fields] = await connection.query({
      sql: `SELECT * FROM (${sql}) AS report_binding_result LIMIT 5001`,
      timeout: 10000,
    }, parameters);
    await connection.commit();
    transactionStarted = false;

    const resultRows = [];
    let resultBytes = 0;
    for (const row of rows.slice(0, 5000)) {
      const rowBytes = Buffer.byteLength(JSON.stringify(row));
      if (rowBytes > 2 * 1024 * 1024) {
        const error = new Error("조회 결과 한 행이 2MB 제한을 초과했습니다.");
        error.status = 413;
        throw error;
      }
      if (resultBytes + rowBytes > 2 * 1024 * 1024) {
        break;
      }
      resultRows.push(row);
      resultBytes += rowBytes;
    }

    return {
      columns: fields.map((field) => field.name),
      rows: resultRows,
      truncated: rows.length > resultRows.length,
    };
  } finally {
    if (transactionStarted) {
      await connection.rollback().catch((rollbackError) => {
        console.error("예약 쿼리 트랜잭션 롤백 실패:", rollbackError.message);
      });
    }
    connection.release();
  }
}

// 요소의 데이터 바인딩(표·필드)과 요약 바인딩을 각각의 쿼리·데이터소스로 새로 조회한다.
async function refreshBlockBindings(block, resolveParameters) {
  const name = block.heading || block.content || block.type;
  const bindings = [
    [block.dataBinding, `요소 "${name}"`],
    [block.type === "table" ? block.summaryBinding : null, `요소 "${name}"의 요약`],
  ];
  for (const [binding, label] of bindings) {
    if (!binding?.enabled || !binding.query?.trim()) continue;
    const { stored, resolved } = resolveParameters(binding, label);
    let result;
    try {
      result = await executeBindingQuery(binding.query, resolved, binding.datasourceId || "");
    } catch (error) {
      error.message = `${label} 조회 실패: ${error.message}`;
      throw error;
    }
    binding.columns = result.columns;
    binding.rows = result.rows;
    binding.parameters = stored;
    binding.lastRefreshedAt = new Date().toISOString();
    binding.truncated = result.truncated;
  }
}

function getTemplatePages(template) {
  return Array.isArray(template.pages) && template.pages.length
    ? template.pages
    : [{ blocks: template.blocks ?? [] }];
}

async function generateScheduledReport(templateId, scheduledDate, schedule) {
  const [rows] = await getPool().execute(
    `SELECT template_group AS \`group\`, template_name AS label,
      layout_type AS layoutType, template_json AS templateJson
     FROM report_templates WHERE template_id = ?`,
    [templateId],
  );
  if (!rows.length) {
    throw new Error(`예약된 양식을 찾을 수 없습니다: ${templateId}`);
  }

  const template = {
    ...rows[0],
    ...JSON.parse(rows[0].templateJson),
  };
  const reportPeriod = getReportPeriod(scheduledDate, schedule.frequency);
  const pages = [];
  for (const page of getTemplatePages(template)) {
    const pageBlocks = [];
    for (const originalBlock of page.blocks ?? []) {
      const block = structuredClone(originalBlock);
      if (block.type === "date") {
        block.date = scheduledDate;
      } else if (block.type === "period") {
        block.start = `${reportPeriod.periodStart}T08:00`;
        const periodEndNextDay = new Date(`${reportPeriod.periodEnd}T00:00:00Z`);
        periodEndNextDay.setUTCDate(periodEndNextDay.getUTCDate() + 1);
        block.end = `${periodEndNextDay.toISOString().slice(0, 10)}T08:00`;
      }

      await refreshBlockBindings(block, (binding, label) => {
        let parameters;
        try {
          parameters = JSON.parse(binding.parametersText || "[]");
        } catch {
          throw new Error(`${label}의 쿼리 파라미터가 JSON 형식이 아닙니다.`);
        }
        if (!Array.isArray(parameters)) {
          throw new Error(`${label}의 쿼리 파라미터는 배열이어야 합니다.`);
        }
        return {
          stored: parameters,
          resolved: resolveScheduleParameters(parameters, reportPeriod),
        };
      });
      pageBlocks.push(block);
    }
    pages.push({ ...page, blocks: pageBlocks });
  }

  const report = {
    type: templateId,
    date: scheduledDate,
    layoutType: template.layoutType,
    templateName: template.label,
    templateGroup: template.group,
    blocks: pages[0]?.blocks ?? [],
    pages,
    headerFooter: template.headerFooter ?? null,
    pageSetup: template.pageSetup ? normalizePageSetup(template.pageSetup) : null,
    generatedAt: new Date().toISOString(),
  };
  const id = await saveReport(report);
  return { id, report };
}

async function generateReportNow({ type, start, end, title: requestTitle }) {
  if (!validateReportType(type)) {
    const error = new Error("선택한 보고서 양식이 올바르지 않습니다.");
    error.status = 400;
    throw error;
  }
  if (!isValidDateTimeInput(start) || !isValidDateTimeInput(end) || start > end) {
    const error = new Error("시작과 종료 날짜시간을 올바르게 선택해 주세요.");
    error.status = 400;
    throw error;
  }
  if (
    requestTitle !== undefined &&
    (typeof requestTitle !== "string" || requestTitle.trim().length > 160)
  ) {
    const error = new Error("리포트 제목은 160자 이내로 입력해 주세요.");
    error.status = 400;
    throw error;
  }

  const [rows] = await getPool().execute(
    `SELECT template_group AS \`group\`, template_name AS label,
      layout_type AS layoutType, template_json AS templateJson
     FROM report_templates WHERE template_id = ?`,
    [type],
  );
  if (!rows.length) {
    const error = new Error("선택한 보고서 양식을 찾을 수 없습니다. 삭제된 양식일 수 있습니다.");
    error.status = 404;
    throw error;
  }
  const template = { ...rows[0], ...JSON.parse(rows[0].templateJson) };

  const range = {
    start: start.replace("T", " ") + ":00",
    end: end.replace("T", " ") + ":00",
  };
  const generatedDate = getScheduleClock().date;
  const pages = [];
  for (const page of getTemplatePages(template)) {
    const pageBlocks = [];
    for (const originalBlock of page.blocks ?? []) {
      const block = structuredClone(originalBlock);
      if (block.type === "date") {
        block.date = generatedDate;
      } else if (block.type === "period") {
        block.start = start;
        block.end = end;
      }

      await refreshBlockBindings(block, (binding, label) => {
        // ? 가 없으면 조건 없이 그대로 조회하고, 두 개면 시작·종료 시각을 차례로 넣는다.
        const parameterCount = countQueryParameters(validateReadOnlyQuery(binding.query));
        if (parameterCount === 0) return { stored: [], resolved: [] };
        if (parameterCount !== 2) {
          const error = new Error(`${label}의 조회문은 ? 를 쓰지 않거나, 시작·종료 시각용 ? 두 개를 사용해야 합니다. (지금 ${parameterCount}개)`);
          error.status = 400;
          throw error;
        }
        const parameters = resolveDateRangeParameters(range);
        return { stored: parameters, resolved: parameters };
      });
      pageBlocks.push(block);
    }
    pages.push({ ...page, blocks: pageBlocks });
  }

  const report = {
    type,
    date: generatedDate,
    layoutType: template.layoutType,
    templateName: template.label,
    reportTitle: requestTitle?.trim() || `${template.label}-${generatedDate}`,
    templateGroup: template.group,
    blocks: pages[0]?.blocks ?? [],
    pages,
    headerFooter: template.headerFooter ?? null,
    pageSetup: template.pageSetup ? normalizePageSetup(template.pageSetup) : null,
    generatedAt: new Date().toISOString(),
    generationRange: { start, end },
  };
  const id = await insertReport(report);
  return { id, ...report };
}

async function runDueSchedules() {
  await ensureReportSchema();
  const [schedules] = await getPool().query(`
    SELECT template_id AS templateId, enabled, frequency,
      scheduled_time AS time, weekday, day_of_month AS dayOfMonth
    FROM report_schedules WHERE enabled = TRUE
  `);
  const now = new Date();
  const clock = getScheduleClock(now);
  for (const schedule of schedules) {
    if (!isScheduleDue(schedule, now)) {
      continue;
    }
    const [claim] = await getPool().execute(
      `INSERT IGNORE INTO report_schedule_runs
        (template_id, scheduled_date, status)
       VALUES (?, ?, 'running')`,
      [schedule.templateId, clock.date],
    );
    if (!claim.affectedRows) {
      continue;
    }
    try {
      const generated = await generateScheduledReport(schedule.templateId, clock.date, schedule);
      await getPool().execute(
        `UPDATE report_schedule_runs
         SET status = 'succeeded', completed_at = CURRENT_TIMESTAMP
         WHERE template_id = ? AND scheduled_date = ?`,
        [schedule.templateId, clock.date],
      );
      console.info(`예약 보고서 생성 완료: ${schedule.templateId} ${clock.date}`);
      try {
        await sendReportMail(getPool(), schedule.templateId, generated.id, generated.report, "schedule", port);
      } catch (error) {
        console.error(`예약 보고서 메일 전송 실패 (${schedule.templateId} ${clock.date}):`, error.message);
      }
    } catch (error) {
      await getPool().execute(
        `UPDATE report_schedule_runs
         SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
         WHERE template_id = ? AND scheduled_date = ?`,
        [error.message, schedule.templateId, clock.date],
      );
      console.error(`예약 보고서 생성 실패 (${schedule.templateId} ${clock.date}):`, error.message);
    }
  }
}

app.use("/api/admin", requireRoles("ADMIN"), createUserAdminRouter({ getPool }));

app.get("/api/mail/server", requireRoles("ADMIN"), async (_request, response, next) => {
  try { response.json({ server: await getMailServer(getPool()) }); } catch (error) { next(error); }
});

app.put("/api/mail/server", requireRoles("ADMIN"), requireSameOrigin, async (request, response, next) => {
  try { response.json({ server: await saveMailServer(getPool(), request.body) }); } catch (error) { next(error); }
});

app.post("/api/mail/server/test", requireRoles("ADMIN"), requireSameOrigin, async (_request, response, next) => {
  try { await verifyMailServer(getPool()); response.json({ ok: true }); } catch (error) {
    if (!error.status) { error.status = 502; error.message = `메일 서버 연결에 실패했습니다: ${error.message}`; }
    next(error);
  }
});

async function ensureMailTemplate(id) {
  if (!validateReportType(id)) { const error = new Error("양식 식별자가 올바르지 않습니다."); error.status = 400; throw error; }
  const [rows] = await getPool().execute("SELECT template_id FROM report_templates WHERE template_id = ?", [id]);
  if (!rows.length) { const error = new Error("양식을 찾을 수 없습니다."); error.status = 404; throw error; }
}

app.get("/api/templates/:id/mail", requireRoles("ADMIN", "EDITOR"), async (request, response, next) => {
  try {
    await ensureMailTemplate(request.params.id);
    const settings = await getTemplateMail(getPool(), request.params.id);
    const [runs] = await getPool().execute(
      "SELECT source, status, error_message AS error, created_at AS createdAt FROM report_mail_runs WHERE template_id = ? ORDER BY id DESC LIMIT 10",
      [request.params.id],
    );
    response.json({ settings, runs });
  } catch (error) { next(error); }
});

app.put("/api/templates/:id/mail", requireRoles("ADMIN", "EDITOR"), requireSameOrigin, async (request, response, next) => {
  try {
    await ensureMailTemplate(request.params.id);
    response.json({ settings: await saveTemplateMail(getPool(), request.params.id, request.body) });
  } catch (error) { next(error); }
});

app.post("/api/templates/:id/mail/send", requireRoles("ADMIN", "EDITOR"), requireSameOrigin, async (request, response, next) => {
  try {
    await ensureMailTemplate(request.params.id);
    // 뷰어에서 보고 있는 보고서(reportId)를 보낸다. 지정하지 않으면 이 양식의 최신 보고서.
    const reportId = request.body?.reportId;
    if (reportId !== undefined && (!Number.isSafeInteger(Number(reportId)) || Number(reportId) < 1)) {
      response.status(400).json({ error: "보고서 식별자가 올바르지 않습니다." });
      return;
    }
    const [rows] = reportId !== undefined
      ? await getPool().execute(
        "SELECT id, report_json FROM report_documents WHERE id = ? AND report_type = ?",
        [Number(reportId), request.params.id],
      )
      : await getPool().execute(
        "SELECT id, report_json FROM report_documents WHERE report_type = ? ORDER BY report_date DESC, updated_at DESC, id DESC LIMIT 1",
        [request.params.id],
      );
    if (!rows.length) {
      response.status(404).json({ error: reportId !== undefined ? "전송할 보고서를 찾을 수 없습니다. 목록을 새로고침해 주세요." : "전송할 생성된 보고서가 없습니다. 먼저 보고서를 생성해 주세요." });
      return;
    }
    await sendReportMail(getPool(), request.params.id, rows[0].id, JSON.parse(rows[0].report_json), "manual", port);
    response.json({ ok: true, reportId: rows[0].id });
  } catch (error) {
    if (!error.status) { error.status = 502; error.message = `메일 전송에 실패했습니다: ${error.message}`; }
    next(error);
  }
});

app.get("/api/access-options", requireRoles("ADMIN", "EDITOR"), async (_request, response, next) => {
  try {
    const [[groups], [users]] = await Promise.all([
      getPool().query("SELECT GROUP_CD AS id, GROUP_NM AS name FROM TM_GROUP ORDER BY GROUP_NM"),
      getPool().query("SELECT USER_CD AS id, USER_ID AS userId, USER_NM AS name, EMAIL AS email FROM TM_USER WHERE USE_YN = 'Y' ORDER BY USER_NM"),
    ]);
    response.json({ groups, users });
  } catch (error) {
    next(error);
  }
});

app.get("/api/templates", async (request, response, next) => {
  try {
    await ensureReportSchema();
    const [rows] = await getPool().query(`
      SELECT template_id AS id, template_group AS \`group\`,
        template_name AS label, layout_type AS layoutType, template_json AS templateJson,
        created_at AS createdAt, updated_at AS updatedAt
      FROM report_templates
      ORDER BY template_group, template_name
    `);
    const accessFor = await loadAllTemplateAccess();
    const templates = rows.map(({ templateJson, ...template }) => ({
      ...template,
      ...JSON.parse(templateJson),
      access: accessFor(template.id),
    }));
    response.json({
      templates: templates.filter((template) =>
        canViewTemplate(request.authUser, request.authUser.groups, template.access),
      ),
    });
  } catch (error) {
    if (!error.status) {
      // 사용자에게는 일반 문구를 보여 주되, 원인은 서버 로그에 남긴다.
      console.error("보고서 양식 조회 실패:", error);
      error.status = 503;
      error.message = "DB 연결 또는 보고서 양식 조회에 실패했습니다. 서버 로그를 확인해 주세요.";
    }
    next(error);
  }
});

app.post("/api/templates", requireRoles("ADMIN", "EDITOR"), async (request, response, next) => {
  try {
    const template = request.body;
    validateTemplate(template);
    const access = validateTemplateAccess(template.access);
    await ensureReportSchema();
    const id = `custom-${randomUUID()}`;
    const templateData = {
      layoutType: template.layoutType,
      blocks: template.blocks,
      pages: template.pages,
      headerFooter: template.headerFooter ?? null,
      pageSetup: template.pageSetup ? normalizePageSetup(template.pageSetup) : null,
    };
    await getPool().execute(
      `INSERT INTO report_templates
        (template_id, template_group, template_name, layout_type, template_json)
       VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        template.group.trim(),
        template.label.trim(),
        template.layoutType,
        JSON.stringify(templateData),
      ],
    );
    await replaceTemplateAccess(id, access);
    await getPool().execute(
      `INSERT INTO report_schedules
        (template_id, enabled, frequency, scheduled_time, weekday, day_of_month)
       VALUES (?, TRUE, ?, '08:00', 1, 1)`,
      [id, template.layoutType],
    );
    const createdAt = new Date().toISOString();
    response.status(201).json({
      id,
      group: template.group.trim(),
      label: template.label.trim(),
      createdAt,
      updatedAt: createdAt,
      access,
      ...templateData,
    });
  } catch (error) {
    if (!error.status) {
      error.status = 503;
      error.message = "DB 연결 또는 보고서 양식 저장에 실패했습니다. 서버 로그를 확인해 주세요.";
    }
    next(error);
  }
});

app.put("/api/templates/:id", requireRoles("ADMIN", "EDITOR"), async (request, response, next) => {
  try {
    const { id } = request.params;
    if (!/^custom-[0-9a-f-]{36}$/.test(id)) {
      response.status(400).json({ error: "보고서 양식 id가 올바르지 않습니다." });
      return;
    }
    const template = request.body;
    validateTemplate(template);
    const access = template.access === undefined
      ? await loadTemplateAccess(id)
      : validateTemplateAccess(template.access);
    await ensureReportSchema();
    const templateData = {
      layoutType: template.layoutType,
      blocks: template.blocks,
      pages: template.pages,
      headerFooter: template.headerFooter ?? null,
      pageSetup: template.pageSetup ? normalizePageSetup(template.pageSetup) : null,
    };
    const [existing] = await getPool().execute(
      "SELECT template_id FROM report_templates WHERE template_id = ?",
      [id],
    );
    if (!existing.length) {
      response.status(404).json({ error: "수정할 보고서 양식을 찾을 수 없습니다." });
      return;
    }
    await getPool().execute(
      `UPDATE report_templates
       SET template_group = ?, template_name = ?, layout_type = ?, template_json = ?
       WHERE template_id = ?`,
      [
        template.group.trim(),
        template.label.trim(),
        template.layoutType,
        JSON.stringify(templateData),
        id,
      ],
    );
    if (template.access !== undefined) {
      await replaceTemplateAccess(id, access);
    }
    response.json({
      id,
      group: template.group.trim(),
      label: template.label.trim(),
      updatedAt: new Date().toISOString(),
      access,
      ...templateData,
    });
  } catch (error) {
    if (!error.status) {
      error.status = 503;
      error.message = "DB 연결 또는 보고서 양식 저장에 실패했습니다. 서버 로그를 확인해 주세요.";
    }
    next(error);
  }
});

app.put("/api/templates/:id/access", requireRoles("ADMIN", "EDITOR"), async (request, response, next) => {
  try {
    const { id } = request.params;
    if (!/^custom-[0-9a-f-]{36}$/.test(id)) {
      sendAuthError(response, 400, "보고서 양식 id가 올바르지 않습니다.");
      return;
    }
    const [existing] = await getPool().execute(
      "SELECT template_id FROM report_templates WHERE template_id = ?",
      [id],
    );
    if (!existing.length) {
      sendAuthError(response, 404, "권한을 설정할 보고서 양식을 찾을 수 없습니다.");
      return;
    }
    const access = await replaceTemplateAccess(id, request.body);
    response.json({ access });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/templates/:id", requireRoles("ADMIN", "EDITOR"), async (request, response, next) => {
  try {
    const { id } = request.params;
    if (!/^custom-[0-9a-f-]{36}$/.test(id)) {
      response.status(400).json({ error: "보고서 양식 id가 올바르지 않습니다." });
      return;
    }
    await ensureReportSchema();
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [deleted] = await connection.execute(
        "DELETE FROM report_templates WHERE template_id = ?",
        [id],
      );
      if (!deleted.affectedRows) {
        await connection.rollback();
        response.status(404).json({ error: "삭제할 보고서 양식을 찾을 수 없습니다." });
        return;
      }
      await connection.execute("DELETE FROM report_schedules WHERE template_id = ?", [id]);
      await connection.execute("DELETE FROM report_schedule_runs WHERE template_id = ?", [id]);
      await connection.execute("DELETE FROM report_template_mail WHERE template_id = ?", [id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    response.status(204).end();
  } catch (error) {
    if (!error.status) {
      error.status = 503;
      error.message = "DB 연결 또는 보고서 양식 삭제에 실패했습니다. 서버 로그를 확인해 주세요.";
    }
    next(error);
  }
});

app.get("/api/schedules", requireRoles("ADMIN", "EDITOR"), async (_request, response, next) => {
  try {
    await ensureReportSchema();
    const [rows] = await getPool().query(`
      SELECT template_id AS templateId, enabled, frequency,
        scheduled_time AS time, weekday, day_of_month AS dayOfMonth
      FROM report_schedules
    `);
    response.json({
      schedules: rows.map((schedule) => ({
        ...schedule,
        enabled: Boolean(schedule.enabled),
        weekday: Number(schedule.weekday),
        dayOfMonth: Number(schedule.dayOfMonth),
      })),
    });
  } catch (error) {
    if (!error.status) {
      error.status = 503;
      error.message = "보고서 실행 일정을 불러오지 못했습니다.";
    }
    next(error);
  }
});

app.put("/api/schedules/:type", requireRoles("ADMIN", "EDITOR"), async (request, response, next) => {
  try {
    const { type } = request.params;
    if (!/^custom-[0-9a-f-]{36}$/.test(type)) {
      response.status(400).json({ error: "보고서 양식 id가 올바르지 않습니다." });
      return;
    }
    validateSchedule(request.body);
    await ensureReportSchema();
    const [templatesFound] = await getPool().execute(
      "SELECT template_id FROM report_templates WHERE template_id = ?",
      [type],
    );
    if (!templatesFound.length) {
      response.status(404).json({ error: "일정을 설정할 보고서 양식을 찾을 수 없습니다." });
      return;
    }
    const { enabled, frequency, time, weekday, dayOfMonth } = request.body;
    await getPool().execute(
      `INSERT INTO report_schedules
        (template_id, enabled, frequency, scheduled_time, weekday, day_of_month)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE enabled = VALUES(enabled),
         frequency = VALUES(frequency), scheduled_time = VALUES(scheduled_time),
         weekday = VALUES(weekday), day_of_month = VALUES(day_of_month)`,
      [type, enabled, frequency, time, weekday, dayOfMonth],
    );
    response.json({ templateId: type, ...request.body, timeZone: "Asia/Seoul" });
  } catch (error) {
    if (!error.status) {
      error.status = 503;
      error.message = "보고서 실행 일정을 저장하지 못했습니다.";
    }
    next(error);
  }
});

app.get("/api/reports", async (request, response, next) => {
  try {
    const { type } = request.query;
    if (type !== undefined && !validateReportType(type)) {
      response.status(400).json({ error: "보고서 유형이 올바르지 않습니다." });
      return;
    }

    await ensureReportSchema();
    const [rows] = type
      ? await getPool().execute(
        `SELECT id, report_type AS type, report_date AS date, updated_at AS updatedAt,
          JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.templateName')) AS templateName,
          JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.reportTitle')) AS reportTitle,
          JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.generationRange.start')) AS rangeStart,
          JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.generationRange.end')) AS rangeEnd
        FROM report_documents WHERE report_type = ?
        ORDER BY report_date DESC, updated_at DESC, id DESC`,
        [type],
      )
      : await getPool().query(`
        SELECT id, report_type AS type, report_date AS date, updated_at AS updatedAt,
          JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.templateName')) AS templateName,
          JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.reportTitle')) AS reportTitle,
          JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.generationRange.start')) AS rangeStart,
          JSON_UNQUOTE(JSON_EXTRACT(report_json, '$.generationRange.end')) AS rangeEnd
        FROM report_documents
        ORDER BY report_date DESC, updated_at DESC, id DESC
      `);
    const accessFor = await loadAllTemplateAccess();
    const visibleReports = [];
    for (const row of rows) {
      if (await canUserViewReportType(request.authUser, row.type, accessFor)) {
        visibleReports.push(row);
      }
    }
    response.json({ reports: visibleReports });
  } catch (error) {
    if (!error.status) {
      error.status = 503;
      error.message = "DB 연결 또는 보고서 목록 조회에 실패했습니다. 서버 로그를 확인해 주세요.";
    }
    next(error);
  }
});

app.get("/api/reports/instances/:id", async (request, response, next) => {
  try {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      response.status(400).json({ error: "보고서 식별자가 올바르지 않습니다." });
      return;
    }
    await ensureReportSchema();
    const [rows] = await getPool().execute(
      "SELECT report_json FROM report_documents WHERE id = ?",
      [id],
    );
    if (!rows.length) {
      response.sendStatus(404);
      return;
    }
    const report = JSON.parse(rows[0].report_json);
    if (!await canUserViewReportType(request.authUser, report.type)) {
      response.sendStatus(404);
      return;
    }
    response.json(report);
  } catch (error) {
    if (!error.status) {
      error.status = 503;
      error.message = "보고서 조회에 실패했습니다.";
    }
    next(error);
  }
});

// 뷰어에서 값을 수정한 리포트를 같은 리포트(id)에 덮어쓴다.
// 내용(blocks/pages)만 바꾸고 양식·날짜·제목·생성 범위 같은 리포트 정보는 저장된 값을 유지한다.
app.put("/api/reports/instances/:id", requireRoles("ADMIN", "EDITOR"), async (request, response, next) => {
  try {
    const id = Number(request.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      response.status(400).json({ error: "보고서 식별자가 올바르지 않습니다." });
      return;
    }
    const { blocks, pages, baseEditedAt } = request.body ?? {};
    if (
      !Array.isArray(blocks) ||
      (pages !== undefined && (!Array.isArray(pages) || pages.some((page) => !page || !Array.isArray(page.blocks))))
    ) {
      response.status(400).json({ error: "리포트 요소 형식이 올바르지 않습니다." });
      return;
    }
    await ensureReportSchema();
    const [rows] = await getPool().execute(
      "SELECT report_json FROM report_documents WHERE id = ?",
      [id],
    );
    if (!rows.length) {
      response.status(404).json({ error: "수정할 리포트를 찾을 수 없습니다. 목록을 새로고침해 주세요." });
      return;
    }
    const existing = JSON.parse(rows[0].report_json);
    // 다른 사람이 먼저 저장했다면 덮어쓰지 않는다.
    if ((existing.editedAt ?? null) !== (baseEditedAt ?? null)) {
      response.status(409).json({
        error: "다른 사용자가 이 리포트를 먼저 수정했습니다. 리포트를 다시 불러온 뒤 수정해 주세요.",
      });
      return;
    }
    const updated = {
      ...existing,
      blocks,
      ...(pages !== undefined ? { pages } : {}),
      editedAt: new Date().toISOString(),
    };
    validateReport(updated);
    await getPool().execute(
      "UPDATE report_documents SET report_json = ? WHERE id = ?",
      [JSON.stringify(updated), id],
    );
    response.json({ id, ...updated });
  } catch (error) {
    if (!error.status) {
      error.status = 503;
      error.message = "리포트를 저장하지 못했습니다. 서버 로그를 확인해 주세요.";
    }
    next(error);
  }
});

app.post("/api/reports/generate", async (request, response, next) => {
  try {
    const type = request.body?.type;
    if (typeof type !== "string" ||
      !await canUserViewReportType(request.authUser, type)) {
      response.sendStatus(404);
      return;
    }
    await ensureReportSchema();
    response.status(201).json(await generateReportNow(request.body));
  } catch (error) {
    if (!error.status) {
      error.status = 503;
      error.message = "DB 연결 또는 새 보고서 생성에 실패했습니다. 서버 로그를 확인해 주세요.";
    }
    next(error);
  }
});

app.get("/api/reports/:type/:date", async (request, response, next) => {
  try {
    const { type, date } = request.params;
    if (!validateReportType(type) || !isValidReportDate(date)) {
      response.status(400).json({ error: "보고서 유형 또는 날짜가 올바르지 않습니다." });
      return;
    }
    if (!await canUserViewReportType(request.authUser, type)) {
      response.sendStatus(404);
      return;
    }

    await ensureReportSchema();
    const report = await loadReport(type, date);
    if (!report) {
      response.sendStatus(404);
      return;
    }
    response.json(report);
  } catch (error) {
    if (!error.status) {
      error.status = 503;
      error.message = "DB 연결 또는 보고서 조회에 실패했습니다. 서버 로그를 확인해 주세요.";
    }
    next(error);
  }
});

app.put("/api/reports", requireRoles("ADMIN", "EDITOR"), async (request, response, next) => {
  try {
    await saveReport(request.body);
    response.sendStatus(204);
  } catch (error) {
    if (!error.status) {
      error.status = 503;
      error.message = "DB 연결 또는 보고서 저장에 실패했습니다. 서버 로그를 확인해 주세요.";
    }
    next(error);
  }
});

app.get("/api/reports/latest", async (request, response, next) => {
  try {
    await ensureReportSchema();
    const [rows] = await getPool().query(
      "SELECT report_json FROM report_documents ORDER BY updated_at DESC, report_date DESC LIMIT 1",
    );
    if (rows.length === 0) {
      response.sendStatus(404);
      return;
    }
    const report = JSON.parse(rows[0].report_json);
    if (!await canUserViewReportType(request.authUser, report.type)) {
      response.sendStatus(404);
      return;
    }
    response.json(report);
  } catch (error) {
    if (!error.status) {
      error.status = 503;
      error.message = "DB 연결 또는 보고서 조회에 실패했습니다. 서버 로그를 확인해 주세요.";
    }
    next(error);
  }
});

app.put("/api/reports/latest", requireRoles("ADMIN", "EDITOR"), async (request, response, next) => {
  try {
    await saveReport(request.body);
    response.sendStatus(204);
  } catch (error) {
    if (!error.status) {
      error.status = 503;
      error.message = "DB 연결 또는 보고서 저장에 실패했습니다. 서버 로그를 확인해 주세요.";
    }
    next(error);
  }
});

app.get("/api/data/status", requireRoles("ADMIN", "EDITOR"), async (_request, response) => {
  const configured = isDatabaseConfigured();
  if (!configured) {
    response.json({ configured, connected: false });
    return;
  }

  try {
    await getPool().query("SELECT 1");
    response.json({ configured, connected: true });
  } catch (error) {
    console.error("DB 연결 상태 확인 실패:", error.message);
    response.json({ configured, connected: false });
  }
});

app.post("/api/data/query", requireRoles("ADMIN", "EDITOR"), async (request, response, next) => {
  try {
    const datasourceId = request.body?.datasourceId ?? "";
    if (typeof datasourceId !== "string" || datasourceId.length > 64) {
      const error = new Error("데이터소스 식별자가 올바르지 않습니다.");
      error.status = 400;
      throw error;
    }
    response.json(
      await executeBindingQuery(request.body?.query, request.body?.parameters ?? [], datasourceId),
    );
  } catch (error) {
    if (error instanceof Error && !error.status) {
      error.status = error.code === "ER_PARSE_ERROR" ||
        error.code === "ER_BAD_FIELD_ERROR" ||
        error.code === "ER_NO_SUCH_TABLE" ||
        error.code === "ER_BAD_TABLE_ERROR" ||
        error.code === "ER_WRONG_ARGUMENTS" ||
        error.code === "ER_WRONG_VALUE_COUNT_ON_ROW"
        ? 400
        : 503;
      if (error.status === 503) {
        error.message = "DB 연결 또는 쿼리 실행에 실패했습니다. 서버 로그를 확인해 주세요.";
      }
    }
    next(error);
  }
});

// ---------- 접속정보(외부 데이터소스) 관리 ----------

function datasourceRoute(handler) {
  return async (request, response, next) => {
    try {
      await ensureReportSchema();
      await handler(request, response);
    } catch (error) {
      if (!error.status) {
        console.error("접속정보 처리 실패:", error.message);
        error.status = 503;
        error.message = "DB 연결 또는 접속정보 처리에 실패했습니다. 서버 로그를 확인해 주세요.";
      }
      next(error);
    }
  };
}

app.get("/api/datasources", requireRoles("ADMIN", "EDITOR"), datasourceRoute(async (_request, response) => {
  response.json({ datasources: await listDatasources(getPool()) });
}));

app.post("/api/datasources", requireRoles("ADMIN"), datasourceRoute(async (request, response) => {
  response.status(201).json(await createDatasource(getPool(), request.body ?? {}));
}));

app.put("/api/datasources/:id", requireRoles("ADMIN"), datasourceRoute(async (request, response) => {
  response.json(await updateDatasource(getPool(), request.params.id, request.body ?? {}));
}));

app.post("/api/datasources/delete", requireRoles("ADMIN"), datasourceRoute(async (request, response) => {
  response.json({ deleted: await deleteDatasources(getPool(), request.body?.ids) });
}));

app.post("/api/datasources/test", requireRoles("ADMIN"), datasourceRoute(async (request, response) => {
  const datasource = await datasourceForTest(getPool(), request.body ?? {});
  response.json(await testDatasourceConnection(datasource));
}));

app.use("/reports", async (request, response, next) => {
  try {
    await ensureReportSchema();
    const user = await findSessionUser(
      readSessionCookie(request.get("cookie") || ""),
      request,
    );
    if (!user || !["ADMIN", "EDITOR"].includes(user.role)) {
      response.sendStatus(user ? 403 : 401);
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
});

app.use(express.static(join(root, "dist")));
app.get("/{*path}", (_request, response, next) => {
  response.sendFile(join(root, "dist", "index.html"), (error) => {
    if (error) {
      next(error);
    }
  });
});

app.use((error, _request, response, _next) => {
  console.error("API 요청 처리 실패:", error.message);
  response.status(error.status || 500).json({
    error: error.status ? error.message : "서버 요청을 처리하지 못했습니다.",
  });
});

if (process.env.NODE_ENV !== "test") {
  app.listen(port, process.env.API_HOST || "127.0.0.1", () => {
    console.log(`cod-report API: http://${process.env.API_HOST || "127.0.0.1"}:${port}`);
    const checkSchedules = () => {
      if (!isDatabaseConfigured()) {
        return;
      }
      runDueSchedules().catch((error) => {
        console.error("예약 일정 확인 실패:", error.message);
      });
    };
    checkSchedules();
    const timer = setInterval(checkSchedules, 15_000);
    timer.unref();
  });
}
