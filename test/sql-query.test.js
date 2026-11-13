import test from "node:test";
import assert from "node:assert/strict";
import { countQueryParameters, validateReadOnlyQuery } from "../src/sql-query.js";

test("allows parameterized SELECT and WITH queries", () => {
  assert.equal(
    validateReadOnlyQuery(" SELECT * FROM reports WHERE report_date = ? "),
    "SELECT * FROM reports WHERE report_date = ?",
  );
  assert.match(validateReadOnlyQuery("WITH recent AS (SELECT 1) SELECT * FROM recent"), /^WITH/);
});

test("rejects statements other than read-only queries", () => {
  for (const query of [
    "UPDATE reports SET title = 'x'",
    "SELECT 1; DELETE FROM reports",
    "SELECT * FROM reports FOR UPDATE",
    "SELECT LOAD_FILE('/etc/passwd')",
    "SELECT SLEEP(30)",
    "SELECT 1 -- comment",
  ]) {
    assert.throws(() => validateReadOnlyQuery(query), { status: 400 });
  }
});

test("allows reserved words inside string literals", () => {
  assert.equal(validateReadOnlyQuery("SELECT 'UPDATE' AS value"), "SELECT 'UPDATE' AS value");
});

test("rejects empty and oversized queries", () => {
  assert.throws(() => validateReadOnlyQuery(""), { status: 400 });
  assert.throws(() => validateReadOnlyQuery(`SELECT '${"x".repeat(10001)}'`), {
    status: 400,
  });
});

test("counts query parameters but ignores question marks in literals and identifiers", () => {
  assert.equal(
    countQueryParameters("SELECT '?' AS literal, `?column` FROM events WHERE started_at BETWEEN ? AND ?"),
    2,
  );
});
