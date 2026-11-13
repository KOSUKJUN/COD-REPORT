// DB 드라이버는 실제로 해당 DB를 쓸 때만 불러온다.

let pgModule;
let oracleModule;
let clickhouseModule;
let mysqlModule;

const PG_DATE_TYPE_OIDS = new Set([1082, 1083, 1114, 1184, 1266]); // date, time, timestamp, timestamptz, timetz

export async function loadPg() {
  pgModule ??= (await import("pg")).default;
  return pgModule;
}

export function postgresClient(config) {
  // 호출 전에 loadPg() 로 모듈이 준비되어 있어야 한다.
  const pg = pgModule;
  return new pg.Client({
    ...config,
    // 날짜·시간은 문자열 그대로 받아 서버 시간대 변환을 피한다.
    types: {
      getTypeParser: (oid, format) =>
        PG_DATE_TYPE_OIDS.has(oid) ? (value) => value : pg.types.getTypeParser(oid, format),
    },
  });
}

export async function oracleConnection(config) {
  oracleModule ??= (await import("oracledb")).default;
  const connection = await oracleModule.getConnection(config);
  return { connection, oracledb: oracleModule };
}

export async function loadClickhouse() {
  clickhouseModule ??= await import("@clickhouse/client");
  return clickhouseModule;
}

export function clickhouseClient(config) {
  return clickhouseModule.createClient(config);
}

export async function mariadbConnection(config) {
  mysqlModule ??= (await import("mysql2/promise")).default;
  return mysqlModule.createConnection(config);
}

export async function preloadDriver(type) {
  if (type === "postgresql") await loadPg();
  if (type === "clickhouse") await loadClickhouse();
}
