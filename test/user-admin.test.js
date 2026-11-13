import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGroupTree,
  descendantGroupCds,
  filterUsers,
  generatePassword,
  matchesQuery,
  normalizeRole,
  parseDelimited,
  parseUserImport,
  sortUsers,
  toChosung,
  toCsv,
  userStatus,
} from "../src/user-admin.js";
import {
  AdminInputError,
  countActiveAdminsAfter,
  normalizeUserProfile,
  selfChangeError,
  wouldCreateGroupCycle,
} from "../src/server/user-admin.js";

const user = (overrides) => ({
  userCd: "usr-1", userId: "user1", name: "사용자", email: "", tel: "", role: "VIEWER",
  enabled: true, lockCount: 0, locked: false, activeSessions: 0, groupCds: [], ...overrides,
});

test("Korean initial-consonant search and multi-term search match users", () => {
  assert.equal(toChosung("홍길동"), "ㅎㄱㄷ");
  assert.equal(matchesQuery(["홍길동", "gildong"], "ㅎㄱㄷ"), true);
  assert.equal(matchesQuery(["홍길동", "gildong"], "ㄱㄷ"), true);
  assert.equal(matchesQuery(["홍길동", "gildong", "보안팀"], "길동 보안"), true);
  assert.equal(matchesQuery(["홍길동", "gildong"], "김"), false);
  assert.equal(matchesQuery(["홍길동", "010-1234-5678"], "01012345678"), true);
  assert.equal(matchesQuery(["anything"], "   "), true);
});

test("user filters combine group scope, unassigned and query", () => {
  const users = [
    user({ userCd: "a", name: "가", groupCds: ["g1"] }),
    user({ userCd: "b", name: "나", groupCds: ["g2"] }),
    user({ userCd: "c", name: "다", groupCds: [] }),
  ];
  assert.deepEqual(filterUsers(users, { groupCd: "__none__" }).map((u) => u.userCd), ["c"]);
  assert.deepEqual(filterUsers(users, { groupCd: "g1" }).map((u) => u.userCd), ["a"]);
  assert.deepEqual(
    filterUsers(users, { groupCd: "g1", scopeCds: new Set(["g1", "g2"]) }).map((u) => u.userCd),
    ["a", "b"],
  );
  const names = new Map([["g2", "보안팀"]]);
  assert.deepEqual(filterUsers(users, { query: "보안", groupNames: names }).map((u) => u.userCd), ["b"]);
});

test("status reflects disabled before locked", () => {
  assert.equal(userStatus(user({})), "active");
  assert.equal(userStatus(user({ lockCount: 5 })), "locked");
  assert.equal(userStatus(user({ enabled: false, lockCount: 5 })), "disabled");
});

test("sorting by role keeps admins first and falls back to name", () => {
  const sorted = sortUsers([
    user({ userCd: "1", name: "다", role: "VIEWER" }),
    user({ userCd: "2", name: "나", role: "ADMIN" }),
    user({ userCd: "3", name: "가", role: "VIEWER" }),
  ], "role");
  assert.deepEqual(sorted.map((u) => u.userCd), ["2", "3", "1"]);
});

test("group tree flattens hierarchy, tolerates broken parents and finds descendants", () => {
  const groups = [
    { groupCd: "b", name: "보안팀", parentGroupCd: "a" },
    { groupCd: "a", name: "본부", parentGroupCd: null },
    { groupCd: "c", name: "야간조", parentGroupCd: "b" },
    { groupCd: "x", name: "고아", parentGroupCd: "missing" },
  ];
  const tree = buildGroupTree(groups);
  assert.deepEqual(tree.map((g) => [g.groupCd, g.depth]), [["x", 0], ["a", 0], ["b", 1], ["c", 2]]);
  assert.deepEqual(tree.find((g) => g.groupCd === "c").path, ["본부", "보안팀", "야간조"]);
  assert.deepEqual([...descendantGroupCds(groups, "a")].sort(), ["a", "b", "c"]);
});

test("generated passwords are long, varied and avoid ambiguous characters", () => {
  for (let i = 0; i < 50; i += 1) {
    const password = generatePassword();
    assert.equal(password.length, 16);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[a-z]/);
    assert.match(password, /\d/);
    assert.match(password, /[^A-Za-z0-9]/);
    assert.doesNotMatch(password, /[0O1lI]/);
  }
});

test("pasted Excel tables and quoted CSV are parsed", () => {
  assert.deepEqual(parseDelimited("a\tb\n1\t2\n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseDelimited('id,name\n"a,1","say ""hi"""\r\n'), [["id", "name"], ["a,1", 'say "hi"']]);
});

test("user import detects headers, roles, groups and duplicates", () => {
  const input = [
    "이름\t아이디\t권한\t부서",
    "홍길동\tgildong\t에디터\t보안팀;야간조",
    "김영희\tyounghee\t\t",
    "중복\tgildong\tviewer\t",
    "기존\texisting\tadmin\t",
    "잘못\tbad id\t운영자\t",
  ].join("\n");
  const { rows, hasHeader } = parseUserImport(input, { existingUserIds: ["EXISTING"], defaultRole: "VIEWER" });
  assert.equal(hasHeader, true);
  assert.deepEqual(rows[0].groups, ["보안팀", "야간조"]);
  assert.equal(rows[0].role, "EDITOR");
  assert.equal(rows[1].role, "VIEWER");
  assert.deepEqual(rows[1].issues, []);
  assert.deepEqual(rows[2].issues, ["목록 안 중복"]);
  assert.deepEqual(rows[3].issues, ["이미 등록된 아이디"]);
  assert.ok(rows[4].issues.includes("아이디 형식 오류"));
  assert.ok(rows[4].issues.some((issue) => issue.includes("운영자")));
  assert.equal(rows[0].line, 2);
});

test("user import without header uses default column order", () => {
  const { rows, hasHeader } = parseUserImport("gildong,홍길동,g@example.com,admin");
  assert.equal(hasHeader, false);
  assert.equal(rows[0].userId, "gildong");
  assert.equal(rows[0].email, "g@example.com");
  assert.equal(rows[0].role, "ADMIN");
});

test("role aliases accept Korean and English names", () => {
  assert.equal(normalizeRole("관리자"), "ADMIN");
  assert.equal(normalizeRole("Editor"), "EDITOR");
  assert.equal(normalizeRole(""), "VIEWER");
  assert.equal(normalizeRole("운영자"), "");
});

test("CSV export adds BOM for Excel and neutralizes formulas", () => {
  const csv = toCsv([["이름", "메모"], ["=HYPERLINK()", 'a"b']]);
  assert.ok(csv.startsWith("﻿"));
  assert.ok(csv.includes("'=HYPERLINK()"));
  assert.ok(csv.includes('"a""b"'));
});

test("server keeps at least one active admin", () => {
  const admins = [
    { userCd: "a", role: "ADMIN", enabled: true },
    { userCd: "b", role: "ADMIN", enabled: true },
    { userCd: "c", role: "ADMIN", enabled: false },
  ];
  assert.equal(countActiveAdminsAfter(admins, new Map()), 2);
  assert.equal(countActiveAdminsAfter(admins, new Map([["a", { role: "VIEWER" }]])), 1);
  assert.equal(countActiveAdminsAfter(admins, new Map([["a", { deleted: true }], ["b", { enabled: false }]])), 0);
  assert.equal(countActiveAdminsAfter(admins, new Map([["c", { enabled: true }], ["a", { deleted: true }]])), 2);
});

test("server blocks risky self changes in bulk actions", () => {
  assert.ok(selfChangeError("delete", null, true));
  assert.ok(selfChangeError("disable", null, true));
  assert.ok(selfChangeError("setRole", "VIEWER", true));
  assert.equal(selfChangeError("setRole", "ADMIN", true), "");
  assert.equal(selfChangeError("delete", null, false), "");
  assert.equal(selfChangeError("addToGroup", "grp", true), "");
});

test("server rejects group cycles", () => {
  const groups = [
    { groupCd: "a", parentGroupCd: null },
    { groupCd: "b", parentGroupCd: "a" },
    { groupCd: "c", parentGroupCd: "b" },
  ];
  assert.equal(wouldCreateGroupCycle(groups, "a", "c"), true);
  assert.equal(wouldCreateGroupCycle(groups, "a", "a"), true);
  assert.equal(wouldCreateGroupCycle(groups, "c", "a"), false);
  assert.equal(wouldCreateGroupCycle(groups, "b", null), false);
});

test("server profile validation supports partial updates", () => {
  assert.deepEqual(normalizeUserProfile({ name: " 홍길동 ", password: "" }, { partial: true }), { name: "홍길동" });
  assert.throws(() => normalizeUserProfile({ email: "nope" }, { partial: true }), AdminInputError);
  assert.throws(() => normalizeUserProfile({ role: "ROOT" }, { partial: true }), AdminInputError);
  assert.throws(() => normalizeUserProfile({ groupCds: ["x"] }, { partial: true }), AdminInputError);
  const full = normalizeUserProfile({
    userId: "gildong", name: "홍길동", role: "viewer", password: "123456789012", email: "g@example.com",
  });
  assert.equal(full.role, "VIEWER");
  assert.equal(full.userId, "gildong");
  assert.throws(() => normalizeUserProfile({ userId: "a b", name: "x" }), AdminInputError);
});
