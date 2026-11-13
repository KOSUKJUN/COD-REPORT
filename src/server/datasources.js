// 외부 DB 접속정보 저장·조회와 읽기 전용 쿼리 실행 (서버 전용).
import {
  clickhouseClient,
  mariadbConnection,
  oracleConnection,
  postgresClient,
  preloadDriver,
} from "./db-drivers.js";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import {
  connectionTestQuery,
  convertPlaceholders,
  getDatasourceType,
  parseDatasourceUrl,
  wrapWithRowLimit,
} from "../datasource-url.js";

export const LOCAL_DATASOURCE_ID = "";
const MAX_ROWS = 5000;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const QUERY_TIMEOUT_MS = 10000;
const CONNECT_TIMEOUT_MS = 5000;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// ---------- 비밀번호 암호화 (AES-256-GCM) ----------

let warnedAboutSecret = false;
function encryptionKey() {
  let secret = process.env.DATASOURCE_SECRET;
  if (!secret) {
    if (!warnedAboutSecret) {
      console.warn("DATASOURCE_SECRET 환경변수가 없어 DB 비밀번호에서 접속정보 암호화 키를 만듭니다. 운영 환경에서는 DATASOURCE_SECRET을 설정하세요.");
      warnedAboutSecret = true;
    }
    secret = `cod-report-datasource:${process.env.DB_PASSWORD ?? ""}`;
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain) {
  if (!plain) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")}`;
}

export function decryptSecret(value) {
  if (!value) return "";
  if (!value.startsWith("v1:")) throw httpError(500, "저장된 비밀번호 형식을 읽을 수 없습니다.");
  const data = Buffer.from(value.slice(3), "base64");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw httpError(500, "저장된 비밀번호를 복호화하지 못했습니다. 암호화 키(DATASOURCE_SECRET)가 바뀌었다면 비밀번호를 다시 입력해 주세요.");
  }
}

// ---------- 저장소 ----------

export const DATASOURCE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS report_datasources (
    datasource_id VARCHAR(64) NOT NULL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    db_type VARCHAR(20) NOT NULL,
    url VARCHAR(1000) NOT NULL,
    username VARCHAR(255) NOT NULL DEFAULT '',
    password_encrypted TEXT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY ux_report_datasource_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const SELECT_COLUMNS = `datasource_id AS id, name, db_type AS type, url, username,
  password_encrypted AS passwordEncrypted, enabled, created_at AS createdAt, updated_at AS updatedAt`;

// 화면으로는 비밀번호를 보내지 않고 저장 여부만 알린다.
function toPublic(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    url: row.url,
    username: row.username,
    hasPassword: Boolean(row.passwordEncrypted),
    enabled: Boolean(row.enabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function validateDatasourceInput(input, { requireAll = true } = {}) {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const type = input?.type;
  const url = typeof input?.url === "string" ? input.url.trim() : "";
  const username = typeof input?.username === "string" ? input.username.trim() : "";
  if (!name || name.length > 120) throw httpError(400, "데이터소스 이름은 1~120자로 입력해 주세요.");
  if (!getDatasourceType(type)) throw httpError(400, "DB 종류를 선택해 주세요.");
  if (!url || url.length > 1000) throw httpError(400, "URL은 1~1000자로 입력해 주세요.");
  parseDatasourceUrl(type, url);
  if (username.length > 255) throw httpError(400, "사용자는 255자 이내로 입력해 주세요.");
  if (input.password !== undefined && (typeof input.password !== "string" || input.password.length > 1000)) {
    throw httpError(400, "패스워드 형식이 올바르지 않습니다.");
  }
  if (requireAll && typeof input.enabled !== "boolean") throw httpError(400, "사용여부를 선택해 주세요.");
  return { name, type, url, username, password: input.password ?? "", enabled: Boolean(input.enabled) };
}

function duplicateNameError(error) {
  if (error?.code === "ER_DUP_ENTRY") {
    return httpError(409, "같은 이름의 데이터소스가 이미 있습니다.");
  }
  return error;
}

export async function listDatasources(pool) {
  const [rows] = await pool.query(`SELECT ${SELECT_COLUMNS} FROM report_datasources ORDER BY name`);
  return rows.map(toPublic);
}

async function getDatasourceRow(pool, id) {
  const [rows] = await pool.execute(`SELECT ${SELECT_COLUMNS} FROM report_datasources WHERE datasource_id = ?`, [id]);
  return rows[0] ?? null;
}

export async function createDatasource(pool, input) {
  const value = validateDatasourceInput(input);
  const id = `ds-${randomUUID()}`;
  try {
    await pool.execute(
      `INSERT INTO report_datasources (datasource_id, name, db_type, url, username, password_encrypted, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, value.name, value.type, value.url, value.username, encryptSecret(value.password), value.enabled],
    );
  } catch (error) {
    throw duplicateNameError(error);
  }
  return toPublic(await getDatasourceRow(pool, id));
}

// 패스워드를 비워 두면 기존 비밀번호를 유지한다. clearPassword 로 명시적으로 지울 수 있다.
export async function updateDatasource(pool, id, input) {
  const existing = await getDatasourceRow(pool, id);
  if (!existing) throw httpError(404, "수정할 데이터소스를 찾을 수 없습니다.");
  const value = validateDatasourceInput(input);
  const passwordEncrypted = input.clearPassword
    ? null
    : value.password
      ? encryptSecret(value.password)
      : existing.passwordEncrypted;
  try {
    await pool.execute(
      `UPDATE report_datasources
       SET name = ?, db_type = ?, url = ?, username = ?, password_encrypted = ?, enabled = ?
       WHERE datasource_id = ?`,
      [value.name, value.type, value.url, value.username, passwordEncrypted, value.enabled, id],
    );
  } catch (error) {
    throw duplicateNameError(error);
  }
  return toPublic(await getDatasourceRow(pool, id));
}

export async function deleteDatasources(pool, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => typeof id !== "string" || !id)) {
    throw httpError(400, "삭제할 데이터소스를 선택해 주세요.");
  }
  const [result] = await pool.query("DELETE FROM report_datasources WHERE datasource_id IN (?)", [ids]);
  return result.affectedRows;
}

// 저장된 접속정보(비밀번호 복호화 포함)를 실행용으로 읽는다.
export async function resolveDatasource(pool, id) {
  const row = await getDatasourceRow(pool, id);
  if (!row) throw httpError(404, "연결된 데이터소스를 찾을 수 없습니다. 접속정보 관리에서 확인해 주세요.");
  if (!row.enabled) throw httpError(400, `데이터소스 "${row.name}"은(는) 사용하지 않음으로 설정되어 있습니다.`);
  return { ...toPublic(row), password: decryptSecret(row.passwordEncrypted) };
}

// 접속 테스트용: 화면에서 입력 중인 값(비밀번호 비어 있으면 저장된 값)으로 접속정보를 만든다.
export async function datasourceForTest(pool, input) {
  const value = validateDatasourceInput({ ...input, enabled: true });
  let password = value.password;
  if (!password && input.id && !input.clearPassword) {
    const row = await getDatasourceRow(pool, input.id);
    password = row ? decryptSecret(row.passwordEncrypted) : "";
  }
  return { ...value, password };
}

// ---------- 실행 ----------

function limitRows(rows) {
  const resultRows = [];
  let bytes = 0;
  for (const row of rows.slice(0, MAX_ROWS)) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row));
    if (rowBytes > MAX_RESULT_BYTES) throw httpError(413, "조회 결과 한 행이 2MB 제한을 초과했습니다.");
    if (bytes + rowBytes > MAX_RESULT_BYTES) break;
    resultRows.push(row);
    bytes += rowBytes;
  }
  return { rows: resultRows, truncated: rows.length > resultRows.length };
}

function connectionError(datasource, error) {
  if (error.status) return error;
  console.error(`데이터소스 "${datasource.name ?? datasource.type}" 실행 실패:`, error.message);
  return httpError(502, `데이터소스 "${datasource.name ?? datasource.type}" 쿼리 실패: ${error.message}`);
}

async function runPostgres(config, datasource, sql, parameters) {
  const client = postgresClient({
    host: config.host,
    port: config.port,
    database: config.database,
    user: datasource.username,
    password: datasource.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS + 2000,
    application_name: "cod-report",
  });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query({ text: sql, values: parameters });
    return { columns: result.fields.map((field) => field.name), rows: result.rows };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

async function runOracle(config, datasource, sql, parameters) {
  const { connection, oracledb } = await oracleConnection({
    user: datasource.username,
    password: datasource.password,
    connectString: config.connectString,
    connectTimeout: Math.ceil(CONNECT_TIMEOUT_MS / 1000),
  });
  try {
    connection.callTimeout = QUERY_TIMEOUT_MS;
    await connection.execute("ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD HH24:MI:SS'");
    await connection.execute("ALTER SESSION SET NLS_TIMESTAMP_FORMAT = 'YYYY-MM-DD HH24:MI:SS.FF3'");
    await connection.execute("SET TRANSACTION READ ONLY");
    const dateTypes = [oracledb.DB_TYPE_DATE, oracledb.DB_TYPE_TIMESTAMP, oracledb.DB_TYPE_TIMESTAMP_TZ, oracledb.DB_TYPE_TIMESTAMP_LTZ];
    const result = await connection.execute(sql, parameters, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      maxRows: MAX_ROWS + 1,
      // 날짜는 세션 형식의 문자열로 받아 시간대 변환 없이 표시한다.
      fetchTypeHandler: (meta) => (dateTypes.includes(meta.dbType) ? { type: oracledb.STRING } : undefined),
    });
    return { columns: (result.metaData ?? []).map((column) => column.name), rows: result.rows ?? [] };
  } finally {
    await connection.rollback().catch(() => {});
    await connection.close().catch(() => {});
  }
}

async function runClickhouse(config, datasource, sql, parameters) {
  const client = clickhouseClient({
    url: config.httpUrl,
    username: datasource.username || "default",
    password: datasource.password,
    database: config.database,
    request_timeout: QUERY_TIMEOUT_MS,
    application: "cod-report",
  });
  try {
    const queryParams = Object.fromEntries(parameters.map((value, index) => [`p${index + 1}`, value === null || value === undefined ? "" : String(value)]));
    const resultSet = await client.query({ query: sql, query_params: queryParams, format: "JSONCompactEachRowWithNamesAndTypes" });
    const [names = [], , ...rows] = await resultSet.json();
    return {
      columns: names,
      rows: rows.map((row) => Object.fromEntries(names.map((name, index) => [name, row[index]]))),
    };
  } finally {
    await client.close().catch(() => {});
  }
}

async function runMariadb(config, datasource, sql, parameters) {
  const connection = await mariadbConnection({
    host: config.host,
    port: config.port,
    user: datasource.username,
    password: datasource.password,
    database: config.database || undefined,
    connectTimeout: CONNECT_TIMEOUT_MS,
    dateStrings: true,
    multipleStatements: false,
  });
  try {
    await connection.query("START TRANSACTION READ ONLY");
    const [rows, fields] = await connection.query({ sql, timeout: QUERY_TIMEOUT_MS }, parameters);
    return { columns: fields.map((field) => field.name), rows };
  } finally {
    await connection.rollback().catch(() => {});
    await connection.end().catch(() => {});
  }
}

const RUNNERS = {
  postgresql: runPostgres,
  oracle: runOracle,
  clickhouse: runClickhouse,
  mariadb: runMariadb,
};

// 이미 검증된 읽기 전용 SQL(? 자리표시자)을 외부 DB에서 실행한다.
export async function runExternalQuery(datasource, validatedSql, parameters) {
  const config = parseDatasourceUrl(datasource.type, datasource.url);
  const sql = wrapWithRowLimit(convertPlaceholders(validatedSql, datasource.type), datasource.type, MAX_ROWS + 1);
  try {
    await preloadDriver(datasource.type);
    const result = await RUNNERS[datasource.type](config, datasource, sql, parameters);
    return { columns: result.columns, ...limitRows(result.rows) };
  } catch (error) {
    throw connectionError(datasource, error);
  }
}

export async function testDatasourceConnection(datasource) {
  const config = parseDatasourceUrl(datasource.type, datasource.url);
  const started = Date.now();
  try {
    await preloadDriver(datasource.type);
    await RUNNERS[datasource.type](config, datasource, connectionTestQuery(datasource.type), []);
  } catch (error) {
    throw connectionError(datasource, error);
  }
  return { ok: true, elapsedMs: Date.now() - started };
}
