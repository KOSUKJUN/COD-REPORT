import test from "node:test";
import assert from "node:assert/strict";
import {
  convertPlaceholders,
  parseDatasourceUrl,
  wrapWithRowLimit,
} from "../src/datasource-url.js";

test("parses Oracle service-name, SID and TNS URLs", () => {
  assert.deepEqual(parseDatasourceUrl("oracle", "jdbc:oracle:thin:@//192.168.0.101:1521/orcl"), {
    type: "oracle", host: "192.168.0.101", port: 1521, database: "orcl", connectString: "192.168.0.101:1521/orcl",
  });
  const sid = parseDatasourceUrl("oracle", "jdbc:oracle:thin:@db.local:1522:ORCL");
  assert.equal(sid.connectString, "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=db.local)(PORT=1522))(CONNECT_DATA=(SID=ORCL)))");
  assert.equal(parseDatasourceUrl("oracle", "db.local/FREEPDB1").connectString, "db.local:1521/FREEPDB1");
  assert.equal(parseDatasourceUrl("oracle", "(DESCRIPTION=(x))").connectString, "(DESCRIPTION=(x))");
  assert.throws(() => parseDatasourceUrl("oracle", "jdbc:oracle:thin:@//host:1521"), /Oracle URL/);
});

test("parses PostgreSQL, MariaDB/MySQL and ClickHouse URLs", () => {
  assert.deepEqual(parseDatasourceUrl("postgresql", "jdbc:postgresql://pg:5433/app?sslmode=require"), {
    type: "postgresql", host: "pg", port: 5433, database: "app", ssl: true,
  });
  assert.equal(parseDatasourceUrl("postgresql", "pg").database, "postgres");
  assert.deepEqual(
    parseDatasourceUrl("mariadb", "jdbc:mysql://dev.codvill.com:13306/igloo?useUnicode=yes&characterEncoding=UTF-8&serverTimezone=UTC"),
    { type: "mariadb", host: "dev.codvill.com", port: 13306, database: "igloo" },
  );
  assert.equal(parseDatasourceUrl("mariadb", "jdbc:mariadb://db/x").port, 3306);
  assert.equal(parseDatasourceUrl("clickhouse", "jdbc:clickhouse://ch:8123/logs").httpUrl, "http://ch:8123");
  assert.equal(parseDatasourceUrl("clickhouse", "https://ch/logs").httpUrl, "https://ch:8443");
  assert.equal(parseDatasourceUrl("clickhouse", "jdbc:ch://ch?ssl=true").httpUrl, "https://ch:8443");
  assert.equal(parseDatasourceUrl("clickhouse", "ch").database, "default");
  assert.throws(() => parseDatasourceUrl("mariadb", ""), /URL을 입력/);
  assert.throws(() => parseDatasourceUrl("mssql", "x"), /지원하지 않는/);
});

test("converts ? placeholders per database, ignoring literals", () => {
  const sql = "SELECT '?' AS q, \"a?\" FROM t WHERE a = ? AND b BETWEEN ? AND ?";
  assert.equal(convertPlaceholders(sql, "postgresql"), "SELECT '?' AS q, \"a?\" FROM t WHERE a = $1 AND b BETWEEN $2 AND $3");
  assert.equal(convertPlaceholders(sql, "oracle"), "SELECT '?' AS q, \"a?\" FROM t WHERE a = :1 AND b BETWEEN :2 AND :3");
  assert.equal(convertPlaceholders(sql, "clickhouse"), "SELECT '?' AS q, \"a?\" FROM t WHERE a = {p1:String} AND b BETWEEN {p2:String} AND {p3:String}");
  assert.equal(convertPlaceholders(sql, "mariadb"), sql);
});

test("wraps queries with a dialect-specific row limit", () => {
  assert.equal(wrapWithRowLimit("SELECT 1 FROM DUAL", "oracle", 10), "SELECT * FROM (SELECT 1 FROM DUAL) WHERE ROWNUM <= 10");
  assert.equal(wrapWithRowLimit("SELECT 1", "postgresql", 10), "SELECT * FROM (SELECT 1) AS report_binding_result LIMIT 10");
});
