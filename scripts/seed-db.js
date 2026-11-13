import "dotenv/config";
import mysql from "mysql2/promise";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const seedFile = join(root, "database", "test-data.sql");

if (
  !process.env.DB_HOST ||
  !process.env.DB_USER ||
  !process.env.DB_PASSWORD ||
  !process.env.DB_NAME
) {
  throw new Error("DB_HOST, DB_USER, DB_PASSWORD, DB_NAME 설정이 필요합니다.");
}

const sql = await readFile(seedFile, "utf8");
const statements = sql.split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter(Boolean);
const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  multipleStatements: false,
});

try {
  for (const statement of statements) {
    await connection.query(statement);
  }
  console.log(`MariaDB 테스트 스키마와 데이터 적용 완료 (${statements.length}개 SQL 문)`);
} finally {
  await connection.end();
}
