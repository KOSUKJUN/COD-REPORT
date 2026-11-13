import test from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_COOKIE_NAME,
  canViewTemplate,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  readSessionCookie,
  validatePassword,
  validateUserId,
  verifyPassword,
} from "../src/server/auth.js";

test("passwords are stored as salted scrypt hashes and checked safely", async () => {
  const hash = await hashPassword("correct horse battery");
  assert.notEqual(hash, "correct horse battery");
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword("correct horse battery", hash), true);
  assert.equal(await verifyPassword("wrong password", hash), false);
  assert.equal(await verifyPassword("anything", "invalid"), false);
});

test("authentication input validation enforces id and password bounds", () => {
  assert.equal(validateUserId("report.user_1@example.com"), true);
  assert.equal(validateUserId("ab"), false);
  assert.equal(validateUserId("bad user"), false);
  assert.equal(validatePassword("123456789012"), true);
  assert.equal(validatePassword("short"), false);
});

test("session cookie values are opaque, hashed, and parsed by cookie name", () => {
  const session = createSessionToken();
  assert.ok(session.token.length >= 32);
  assert.equal(hashSessionToken(session.token), session.hash);
  assert.notEqual(session.hash, session.token);
  assert.equal(hashSessionToken("short"), "");
  assert.equal(
    readSessionCookie(`theme=dark; ${SESSION_COOKIE_NAME}=${encodeURIComponent(session.token)}`),
    session.token,
  );
  assert.equal(readSessionCookie("theme=dark"), "");
});

test("template viewer access grants either a matching group or a matching user", () => {
  const acl = { groups: ["grp-allowed"], users: ["usr-allowed"] };
  assert.equal(canViewTemplate({ role: "VIEWER", userCd: "usr-other" }, ["grp-allowed"], acl), true);
  assert.equal(canViewTemplate({ role: "VIEWER", userCd: "usr-allowed" }, [], acl), true);
  assert.equal(canViewTemplate({ role: "VIEWER", userCd: "usr-other" }, ["grp-other"], acl), false);
  assert.equal(canViewTemplate({ role: "VIEWER", userCd: "usr-other" }, [], { groups: [], users: [] }), true);
  assert.equal(canViewTemplate({ role: "VIEWER", userCd: "usr-other" }, ["grp-other"], undefined), true);
  assert.equal(canViewTemplate(null, [], { groups: [], users: [] }), false);
  assert.equal(canViewTemplate({ role: "EDITOR" }, [], { groups: [], users: [] }), true);
});
