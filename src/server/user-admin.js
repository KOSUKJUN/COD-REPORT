import { randomUUID } from "node:crypto";
import express from "express";
import { hashPassword, validatePassword, validateUserId } from "./auth.js";

export const ROLES = ["ADMIN", "EDITOR", "VIEWER"];
export const BULK_ACTIONS = [
  "setRole",
  "enable",
  "disable",
  "unlock",
  "addToGroup",
  "removeFromGroup",
  "logout",
  "delete",
];
export const MAX_IMPORT_ROWS = 500;
export const LOCK_LIMIT = 5;

const USER_CD_PATTERN = /^usr-[0-9a-f-]{36}$/;
const GROUP_CD_PATTERN = /^grp-[0-9a-f-]{36}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEL_PATTERN = /^[0-9+\-() .]{0,50}$/;

export class AdminInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function isUserCd(value) {
  return typeof value === "string" && USER_CD_PATTERN.test(value);
}

export function isGroupCd(value) {
  return typeof value === "string" && GROUP_CD_PATTERN.test(value);
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 사용자 프로필 입력을 검증합니다. partial=true이면 전달된 필드만 검증·반환합니다.
 */
export function normalizeUserProfile(body, { partial = false } = {}) {
  const result = {};
  const has = (key) => !partial || body?.[key] !== undefined;

  if (!partial) {
    const userId = text(body?.userId);
    if (!validateUserId(userId)) {
      throw new AdminInputError("아이디는 영문, 숫자, 마침표, 밑줄, @, 하이픈으로 3~200자 입력해 주세요.");
    }
    result.userId = userId;
  }
  if (has("name")) {
    const name = text(body?.name);
    if (!name || name.length > 200) throw new AdminInputError("이름을 1~200자로 입력해 주세요.");
    result.name = name;
  }
  if (has("email")) {
    const email = text(body?.email);
    if (email && (email.length > 200 || !EMAIL_PATTERN.test(email))) {
      throw new AdminInputError("이메일 형식을 확인해 주세요.");
    }
    result.email = email;
  }
  if (has("tel")) {
    const tel = text(body?.tel);
    if (!TEL_PATTERN.test(tel)) throw new AdminInputError("전화번호는 숫자와 + - ( ) 기호로 50자 이내 입력해 주세요.");
    result.tel = tel;
  }
  if (has("role")) {
    const role = String(body?.role || "").toUpperCase();
    if (!ROLES.includes(role)) throw new AdminInputError("역할을 관리자·에디터·뷰어 중에서 선택해 주세요.");
    result.role = role;
  }
  if (has("password")) {
    const password = body?.password;
    if (partial && (password === "" || password === null)) {
      // 비밀번호 미변경
    } else if (!validatePassword(password)) {
      throw new AdminInputError("비밀번호는 12~256자로 입력해 주세요.");
    } else {
      result.password = password;
    }
  }
  if (partial && body?.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") throw new AdminInputError("사용 상태 값이 올바르지 않습니다.");
    result.enabled = body.enabled;
  }
  if (partial && body?.unlock !== undefined) {
    result.unlock = body.unlock === true;
  }
  if (body?.groupCds !== undefined) {
    result.groupCds = normalizeIdList(body.groupCds, isGroupCd, "그룹 목록 형식이 올바르지 않습니다.");
  }
  return result;
}

export function normalizeIdList(value, validator, message, max = 1000) {
  if (!Array.isArray(value) || value.length > max || value.some((item) => !validator(item))) {
    throw new AdminInputError(message);
  }
  return [...new Set(value)];
}

/**
 * 변경 후 남는 활성 관리자 수를 계산합니다.
 * admins: [{ userCd, role, enabled }], changes: Map<userCd, { role?, enabled?, deleted? }>
 */
export function countActiveAdminsAfter(admins, changes) {
  let count = 0;
  for (const admin of admins) {
    const change = changes.get(admin.userCd) ?? {};
    if (change.deleted) continue;
    const role = change.role ?? admin.role;
    const enabled = change.enabled ?? admin.enabled;
    if (role === "ADMIN" && enabled) count += 1;
  }
  // 관리자가 아닌 사용자를 관리자로 올리는 변경은 수를 줄이지 않으므로 하한 검사에는 포함하지 않습니다.
  return count;
}

/** parentGroupCd를 상위로 지정하면 순환이 생기는지 확인합니다. */
export function wouldCreateGroupCycle(groups, groupCd, parentGroupCd) {
  if (!parentGroupCd) return false;
  if (parentGroupCd === groupCd) return true;
  const parentOf = new Map(groups.map((group) => [group.groupCd, group.parentGroupCd]));
  let cursor = parentGroupCd;
  const seen = new Set();
  while (cursor) {
    if (cursor === groupCd) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

/** 일괄 작업이 자기 계정을 위험하게 변경하는지 확인합니다. */
export function selfChangeError(action, value, selfIncluded) {
  if (!selfIncluded) return "";
  if (action === "delete") return "자기 계정은 삭제할 수 없습니다. 선택에서 제외해 주세요.";
  if (action === "disable") return "자기 계정은 사용 중지할 수 없습니다. 선택에서 제외해 주세요.";
  if (action === "setRole" && value !== "ADMIN") {
    return "자기 계정의 관리자 권한은 해제할 수 없습니다. 다른 관리자에게 요청해 주세요.";
  }
  return "";
}

export async function ensureUserAdminSchema(pool) {
  const [columns] = await pool.execute(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'TM_USER' AND column_name = 'LAST_LOGIN_AT'`,
  );
  if (!columns.length) {
    try {
      await pool.query("ALTER TABLE TM_USER ADD COLUMN LAST_LOGIN_AT DATETIME NULL");
    } catch (error) {
      // information_schema 대소문자 처리 차이로 이미 있는 열을 못 찾은 경우
      if (error?.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
}

async function lockAdmins(connection) {
  const [rows] = await connection.query(
    "SELECT USER_CD AS userCd, USER_ROLE AS role, USE_YN AS enabled FROM TM_USER WHERE USER_ROLE = 'ADMIN' FOR UPDATE",
  );
  return rows.map((row) => ({
    userCd: row.userCd,
    role: String(row.role).toUpperCase(),
    enabled: row.enabled === "Y",
  }));
}

async function withTransaction(pool, work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

function inPlaceholders(values) {
  return values.map(() => "?").join(",");
}

async function assertGroupsExist(connection, groupCds) {
  if (!groupCds.length) return;
  const [rows] = await connection.query(
    `SELECT GROUP_CD FROM TM_GROUP WHERE GROUP_CD IN (${inPlaceholders(groupCds)})`,
    groupCds,
  );
  if (rows.length !== groupCds.length) throw new AdminInputError("존재하지 않는 그룹이 포함되어 있습니다.");
}

async function replaceUserGroups(connection, userCd, groupCds) {
  await connection.execute("DELETE FROM TC_USER_GROUP_ROLE WHERE USER_CD = ?", [userCd]);
  if (groupCds.length) {
    await connection.query(
      "INSERT INTO TC_USER_GROUP_ROLE (GROUP_CD, USER_CD, ROLE_CD) VALUES ?",
      [groupCds.map((groupCd) => [groupCd, userCd, "MEMBER"])],
    );
  }
}

function mapDuplicate(error, message) {
  if (error?.code === "ER_DUP_ENTRY") return new AdminInputError(message, 409);
  return error;
}

export function createUserAdminRouter({ getPool }) {
  const router = express.Router();
  const route = (handler) => async (request, response, next) => {
    try {
      await handler(request, response);
    } catch (error) {
      next(error);
    }
  };

  // ---------- 사용자 ----------

  router.get("/users", route(async (_request, response) => {
    const pool = getPool();
    const [[users], [memberships], [sessions]] = await Promise.all([
      pool.query(`
        SELECT USER_CD AS userCd, USER_ID AS userId, USER_NM AS name, EMAIL AS email, TEL AS tel,
          USER_ROLE AS role, USE_YN AS enabled, LOCK_CNT AS lockCount,
          LAST_LOGIN_AT AS lastLoginAt, created_at AS createdAt
        FROM TM_USER ORDER BY USER_NM, USER_ID
      `),
      pool.query(`
        SELECT m.USER_CD AS userCd, m.GROUP_CD AS groupCd
        FROM TC_USER_GROUP_ROLE m JOIN TM_GROUP g ON g.GROUP_CD = m.GROUP_CD
        ORDER BY g.GROUP_NM
      `),
      pool.query(`
        SELECT USER_CD AS userCd, COUNT(*) AS count, MAX(CREATED_AT) AS lastSessionAt
        FROM TC_AUTH_SESSION WHERE EXPIRES_AT > UTC_TIMESTAMP() GROUP BY USER_CD
      `),
    ]);
    const groupsByUser = new Map();
    for (const { userCd, groupCd } of memberships) {
      if (!groupsByUser.has(userCd)) groupsByUser.set(userCd, []);
      groupsByUser.get(userCd).push(groupCd);
    }
    const sessionsByUser = new Map(sessions.map((row) => [row.userCd, Number(row.count)]));
    response.json({
      users: users.map((user) => ({
        ...user,
        email: user.email ?? "",
        tel: user.tel ?? "",
        role: String(user.role).toUpperCase(),
        enabled: user.enabled === "Y",
        lockCount: Number(user.lockCount),
        locked: Number(user.lockCount) >= LOCK_LIMIT,
        activeSessions: sessionsByUser.get(user.userCd) ?? 0,
        groupCds: groupsByUser.get(user.userCd) ?? [],
      })),
    });
  }));

  router.post("/users", route(async (request, response) => {
    const profile = normalizeUserProfile(request.body);
    if (!profile.role) throw new AdminInputError("역할을 선택해 주세요.");
    if (!profile.password) throw new AdminInputError("초기 비밀번호를 입력해 주세요.");
    const groupCds = profile.groupCds ?? [];
    const userCd = `usr-${randomUUID()}`;
    const passwordHash = await hashPassword(profile.password);
    try {
      await withTransaction(getPool(), async (connection) => {
        await assertGroupsExist(connection, groupCds);
        await connection.execute(
          `INSERT INTO TM_USER (USER_CD, USER_NM, USER_ID, EMAIL, TEL, PW, USER_ROLE, USE_YN)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'Y')`,
          [userCd, profile.name, profile.userId, profile.email || null, profile.tel || null, passwordHash, profile.role],
        );
        await replaceUserGroups(connection, userCd, groupCds);
      });
    } catch (error) {
      throw mapDuplicate(error, "이미 사용 중인 아이디입니다.");
    }
    response.status(201).json({ user: { userCd, userId: profile.userId } });
  }));

  const updateUser = route(async (request, response) => {
    const { userCd } = request.params;
    if (!isUserCd(userCd)) throw new AdminInputError("사용자 식별자가 올바르지 않습니다.");
    const changes = normalizeUserProfile(request.body, { partial: true });
    const self = userCd === request.authUser.userCd;
    if (self && changes.enabled === false) throw new AdminInputError("자기 계정은 사용 중지할 수 없습니다.");
    if (self && changes.role && changes.role !== "ADMIN") {
      throw new AdminInputError("자기 계정의 관리자 권한은 해제할 수 없습니다. 다른 관리자에게 요청해 주세요.");
    }
    const passwordHash = changes.password ? await hashPassword(changes.password) : null;

    await withTransaction(getPool(), async (connection) => {
      const admins = await lockAdmins(connection);
      const [rows] = await connection.execute(
        "SELECT USER_ROLE AS role, USE_YN AS enabled FROM TM_USER WHERE USER_CD = ? FOR UPDATE",
        [userCd],
      );
      if (!rows.length) throw new AdminInputError("사용자를 찾을 수 없습니다.", 404);
      const currentRole = String(rows[0].role).toUpperCase();
      const nextChange = new Map([[userCd, { role: changes.role, enabled: changes.enabled }]]);
      if (countActiveAdminsAfter(admins, nextChange) < 1) {
        throw new AdminInputError("마지막 활성 관리자의 권한이나 상태는 변경할 수 없습니다.", 409);
      }
      const sets = [];
      const values = [];
      const assign = (column, value) => {
        sets.push(`${column} = ?`);
        values.push(value);
      };
      if (changes.name !== undefined) assign("USER_NM", changes.name);
      if (changes.email !== undefined) assign("EMAIL", changes.email || null);
      if (changes.tel !== undefined) assign("TEL", changes.tel || null);
      if (changes.role !== undefined) assign("USER_ROLE", changes.role);
      if (changes.enabled !== undefined) assign("USE_YN", changes.enabled ? "Y" : "N");
      if (passwordHash) assign("PW", passwordHash);
      if (changes.unlock || passwordHash) assign("LOCK_CNT", 0);
      if (sets.length) {
        await connection.execute(`UPDATE TM_USER SET ${sets.join(", ")} WHERE USER_CD = ?`, [...values, userCd]);
      }
      if (changes.groupCds) {
        await assertGroupsExist(connection, changes.groupCds);
        await replaceUserGroups(connection, userCd, changes.groupCds);
      }
      const revokeSessions = passwordHash || changes.enabled === false ||
        (changes.role !== undefined && changes.role !== currentRole);
      if (revokeSessions && !self) {
        await connection.execute("DELETE FROM TC_AUTH_SESSION WHERE USER_CD = ?", [userCd]);
      }
    });
    response.sendStatus(204);
  });
  router.patch("/users/:userCd", updateUser);
  router.put("/users/:userCd", updateUser);

  router.delete("/users/:userCd", route(async (request, response) => {
    const { userCd } = request.params;
    if (!isUserCd(userCd)) throw new AdminInputError("사용자 식별자가 올바르지 않습니다.");
    if (userCd === request.authUser.userCd) throw new AdminInputError("자기 계정은 삭제할 수 없습니다.");
    await withTransaction(getPool(), async (connection) => {
      const admins = await lockAdmins(connection);
      if (countActiveAdminsAfter(admins, new Map([[userCd, { deleted: true }]])) < 1) {
        throw new AdminInputError("마지막 활성 관리자 계정은 삭제할 수 없습니다.", 409);
      }
      await connection.execute("DELETE FROM TM_USER WHERE USER_CD = ?", [userCd]);
    });
    response.sendStatus(204);
  }));

  router.post("/users/bulk", route(async (request, response) => {
    const action = request.body?.action;
    if (!BULK_ACTIONS.includes(action)) throw new AdminInputError("지원하지 않는 일괄 작업입니다.");
    const userCds = normalizeIdList(request.body?.userCds, isUserCd, "선택한 사용자 목록이 올바르지 않습니다.", 2000);
    if (!userCds.length) throw new AdminInputError("사용자를 한 명 이상 선택해 주세요.");
    let value = request.body?.value;
    if (action === "setRole") {
      value = String(value || "").toUpperCase();
      if (!ROLES.includes(value)) throw new AdminInputError("변경할 역할을 선택해 주세요.");
    }
    if ((action === "addToGroup" || action === "removeFromGroup") && !isGroupCd(value)) {
      throw new AdminInputError("그룹을 선택해 주세요.");
    }
    const selfError = selfChangeError(action, value, userCds.includes(request.authUser.userCd));
    if (selfError) throw new AdminInputError(selfError);

    const affected = await withTransaction(getPool(), async (connection) => {
      const placeholders = inPlaceholders(userCds);
      const [existing] = await connection.query(
        `SELECT USER_CD AS userCd, USER_ROLE AS role FROM TM_USER WHERE USER_CD IN (${placeholders}) FOR UPDATE`,
        userCds,
      );
      if (existing.length !== userCds.length) throw new AdminInputError("이미 삭제된 사용자가 포함되어 있습니다. 새로고침해 주세요.", 409);

      if (["setRole", "disable", "delete"].includes(action)) {
        const admins = await lockAdmins(connection);
        const change = action === "setRole" ? { role: value } : action === "disable" ? { enabled: false } : { deleted: true };
        const changes = new Map(userCds.map((userCd) => [userCd, change]));
        if (countActiveAdminsAfter(admins, changes) < 1) {
          throw new AdminInputError("이 작업을 하면 활성 관리자가 남지 않습니다.", 409);
        }
      }

      switch (action) {
        case "setRole": {
          const changed = existing.filter((user) => String(user.role).toUpperCase() !== value).map((user) => user.userCd);
          await connection.query(`UPDATE TM_USER SET USER_ROLE = ? WHERE USER_CD IN (${placeholders})`, [value, ...userCds]);
          if (changed.length) {
            await connection.query(`DELETE FROM TC_AUTH_SESSION WHERE USER_CD IN (${inPlaceholders(changed)})`, changed);
          }
          return userCds.length;
        }
        case "enable":
          await connection.query(`UPDATE TM_USER SET USE_YN = 'Y' WHERE USER_CD IN (${placeholders})`, userCds);
          return userCds.length;
        case "disable":
          await connection.query(`UPDATE TM_USER SET USE_YN = 'N' WHERE USER_CD IN (${placeholders})`, userCds);
          await connection.query(`DELETE FROM TC_AUTH_SESSION WHERE USER_CD IN (${placeholders})`, userCds);
          return userCds.length;
        case "unlock":
          await connection.query(`UPDATE TM_USER SET LOCK_CNT = 0 WHERE USER_CD IN (${placeholders})`, userCds);
          return userCds.length;
        case "logout": {
          const others = userCds.filter((userCd) => userCd !== request.authUser.userCd);
          if (others.length) {
            await connection.query(`DELETE FROM TC_AUTH_SESSION WHERE USER_CD IN (${inPlaceholders(others)})`, others);
          }
          return others.length;
        }
        case "addToGroup": {
          await assertGroupsExist(connection, [value]);
          const [result] = await connection.query(
            "INSERT IGNORE INTO TC_USER_GROUP_ROLE (GROUP_CD, USER_CD, ROLE_CD) VALUES ?",
            [userCds.map((userCd) => [value, userCd, "MEMBER"])],
          );
          return result.affectedRows;
        }
        case "removeFromGroup": {
          const [result] = await connection.query(
            `DELETE FROM TC_USER_GROUP_ROLE WHERE GROUP_CD = ? AND USER_CD IN (${placeholders})`,
            [value, ...userCds],
          );
          return result.affectedRows;
        }
        case "delete": {
          const [result] = await connection.query(`DELETE FROM TM_USER WHERE USER_CD IN (${placeholders})`, userCds);
          return result.affectedRows;
        }
        default:
          return 0;
      }
    });
    response.json({ affected });
  }));

  router.post("/users/import", route(async (request, response) => {
    const rows = request.body?.users;
    const createMissingGroups = request.body?.createMissingGroups === true;
    if (!Array.isArray(rows) || !rows.length || rows.length > MAX_IMPORT_ROWS) {
      throw new AdminInputError(`한 번에 1~${MAX_IMPORT_ROWS}명까지 가져올 수 있습니다.`);
    }
    const errors = [];
    const valid = [];
    const seenIds = new Set();
    rows.forEach((row, index) => {
      try {
        const profile = normalizeUserProfile({ ...row, groupCds: undefined });
        if (!profile.role) profile.role = "VIEWER";
        if (!profile.password) throw new AdminInputError("비밀번호가 없습니다.");
        const key = profile.userId.toLowerCase();
        if (seenIds.has(key)) throw new AdminInputError("목록 안에 같은 아이디가 중복되어 있습니다.");
        seenIds.add(key);
        const groupNames = Array.isArray(row?.groups)
          ? [...new Set(row.groups.map((name) => text(name)).filter(Boolean))]
          : [];
        if (groupNames.some((name) => name.length > 200)) throw new AdminInputError("그룹 이름은 200자 이내여야 합니다.");
        valid.push({ index, profile, groupNames });
      } catch (error) {
        errors.push({ index, userId: text(row?.userId), error: error.message });
      }
    });

    const pool = getPool();
    if (valid.length) {
      const ids = valid.map((item) => item.profile.userId);
      const [existing] = await pool.query(
        `SELECT USER_ID AS userId FROM TM_USER WHERE USER_ID IN (${inPlaceholders(ids)})`,
        ids,
      );
      const taken = new Set(existing.map((row) => row.userId.toLowerCase()));
      for (let i = valid.length - 1; i >= 0; i -= 1) {
        if (taken.has(valid[i].profile.userId.toLowerCase())) {
          errors.push({ index: valid[i].index, userId: valid[i].profile.userId, error: "이미 사용 중인 아이디입니다." });
          valid.splice(i, 1);
        }
      }
    }

    const [groupRows] = await pool.query("SELECT GROUP_CD AS groupCd, GROUP_NM AS name FROM TM_GROUP");
    const groupByName = new Map(groupRows.map((group) => [group.name.toLowerCase(), group.groupCd]));
    if (!createMissingGroups) {
      for (let i = valid.length - 1; i >= 0; i -= 1) {
        const missing = valid[i].groupNames.filter((name) => !groupByName.has(name.toLowerCase()));
        if (missing.length) {
          errors.push({ index: valid[i].index, userId: valid[i].profile.userId, error: `없는 그룹: ${missing.join(", ")}` });
          valid.splice(i, 1);
        }
      }
    }

    const hashes = await Promise.all(valid.map((item) => hashPassword(item.profile.password)));
    const created = [];
    const createdGroups = [];
    if (valid.length) {
      await withTransaction(pool, async (connection) => {
        for (const item of valid) {
          for (const name of item.groupNames) {
            if (groupByName.has(name.toLowerCase())) continue;
            const groupCd = `grp-${randomUUID()}`;
            await connection.execute("INSERT INTO TM_GROUP (GROUP_CD, GROUP_NM) VALUES (?, ?)", [groupCd, name]);
            groupByName.set(name.toLowerCase(), groupCd);
            createdGroups.push(name);
          }
        }
        for (const [position, item] of valid.entries()) {
          const userCd = `usr-${randomUUID()}`;
          const { profile } = item;
          await connection.execute(
            `INSERT INTO TM_USER (USER_CD, USER_NM, USER_ID, EMAIL, TEL, PW, USER_ROLE, USE_YN)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'Y')`,
            [userCd, profile.name, profile.userId, profile.email || null, profile.tel || null, hashes[position], profile.role],
          );
          const groupCds = item.groupNames.map((name) => groupByName.get(name.toLowerCase()));
          await replaceUserGroups(connection, userCd, [...new Set(groupCds)]);
          created.push({ index: item.index, userId: profile.userId, userCd });
        }
      }).catch((error) => {
        throw mapDuplicate(error, "가져오는 동안 다른 곳에서 같은 아이디가 등록되었습니다. 다시 시도해 주세요.");
      });
    }
    errors.sort((a, b) => a.index - b.index);
    response.status(created.length ? 201 : 200).json({ created, createdGroups, errors });
  }));

  // ---------- 그룹 ----------

  router.get("/groups", route(async (_request, response) => {
    const pool = getPool();
    const [[groups], [members], [templates]] = await Promise.all([
      pool.query(`
        SELECT GROUP_CD AS groupCd, PAR_GROUP_CD AS parentGroupCd, GROUP_NM AS name,
          GROUP_DESC AS description, created_at AS createdAt
        FROM TM_GROUP ORDER BY GROUP_NM
      `),
      pool.query(`
        SELECT m.GROUP_CD AS groupCd, u.USER_CD AS userCd, u.USER_ID AS userId, u.USER_NM AS name
        FROM TC_USER_GROUP_ROLE m JOIN TM_USER u ON u.USER_CD = m.USER_CD
        ORDER BY u.USER_NM
      `),
      pool.query(`
        SELECT a.GROUP_CD AS groupCd, t.template_id AS id, t.template_name AS name, t.template_group AS category
        FROM TC_TEMPLATE_GROUP_ACL a JOIN report_templates t ON t.template_id = a.TEMPLATE_ID
        ORDER BY t.template_group, t.template_name
      `),
    ]);
    response.json({
      groups: groups.map((group) => ({
        ...group,
        description: group.description ?? "",
        users: members.filter((member) => member.groupCd === group.groupCd)
          .map(({ userCd, userId, name }) => ({ userCd, userId, name })),
        templates: templates.filter((template) => template.groupCd === group.groupCd)
          .map(({ id, name, category }) => ({ id, name, category })),
      })),
    });
  }));

  function normalizeGroup(body, { partial = false } = {}) {
    const result = {};
    if (!partial || body?.name !== undefined) {
      const name = text(body?.name);
      if (!name || name.length > 200) throw new AdminInputError("그룹 이름을 1~200자로 입력해 주세요.");
      result.name = name;
    }
    if (!partial || body?.description !== undefined) {
      const description = text(body?.description);
      if (description.length > 4000) throw new AdminInputError("설명은 4000자 이내로 입력해 주세요.");
      result.description = description;
    }
    if (body?.parentGroupCd !== undefined) {
      const parent = body.parentGroupCd || null;
      if (parent !== null && !isGroupCd(parent)) throw new AdminInputError("상위 그룹이 올바르지 않습니다.");
      result.parentGroupCd = parent;
    }
    if (body?.userCds !== undefined) {
      result.userCds = normalizeIdList(body.userCds, isUserCd, "구성원 목록 형식이 올바르지 않습니다.", 2000);
    }
    return result;
  }

  async function assertUsersExist(connection, userCds) {
    if (!userCds.length) return;
    const [rows] = await connection.query(
      `SELECT USER_CD FROM TM_USER WHERE USER_CD IN (${inPlaceholders(userCds)})`,
      userCds,
    );
    if (rows.length !== userCds.length) throw new AdminInputError("존재하지 않는 사용자가 포함되어 있습니다.");
  }

  async function replaceGroupMembers(connection, groupCd, userCds) {
    await connection.execute("DELETE FROM TC_USER_GROUP_ROLE WHERE GROUP_CD = ?", [groupCd]);
    if (userCds.length) {
      await connection.query(
        "INSERT INTO TC_USER_GROUP_ROLE (GROUP_CD, USER_CD, ROLE_CD) VALUES ?",
        [userCds.map((userCd) => [groupCd, userCd, "MEMBER"])],
      );
    }
  }

  router.post("/groups", route(async (request, response) => {
    const group = normalizeGroup(request.body);
    const groupCd = `grp-${randomUUID()}`;
    try {
      await withTransaction(getPool(), async (connection) => {
        if (group.parentGroupCd) await assertGroupsExist(connection, [group.parentGroupCd]);
        await connection.execute(
          "INSERT INTO TM_GROUP (GROUP_CD, PAR_GROUP_CD, GROUP_NM, GROUP_DESC) VALUES (?, ?, ?, ?)",
          [groupCd, group.parentGroupCd ?? null, group.name, group.description || null],
        );
        if (group.userCds?.length) {
          await assertUsersExist(connection, group.userCds);
          await replaceGroupMembers(connection, groupCd, group.userCds);
        }
      });
    } catch (error) {
      throw mapDuplicate(error, "같은 이름의 그룹이 이미 있습니다.");
    }
    response.status(201).json({ group: { groupCd, ...group } });
  }));

  const updateGroup = route(async (request, response) => {
    const { groupCd } = request.params;
    if (!isGroupCd(groupCd)) throw new AdminInputError("그룹 식별자가 올바르지 않습니다.");
    const changes = normalizeGroup(request.body, { partial: true });
    try {
      await withTransaction(getPool(), async (connection) => {
        const [all] = await connection.query(
          "SELECT GROUP_CD AS groupCd, PAR_GROUP_CD AS parentGroupCd FROM TM_GROUP FOR UPDATE",
        );
        if (!all.some((group) => group.groupCd === groupCd)) throw new AdminInputError("그룹을 찾을 수 없습니다.", 404);
        if (changes.parentGroupCd !== undefined) {
          if (changes.parentGroupCd && !all.some((group) => group.groupCd === changes.parentGroupCd)) {
            throw new AdminInputError("상위 그룹을 찾을 수 없습니다.");
          }
          if (wouldCreateGroupCycle(all, groupCd, changes.parentGroupCd)) {
            throw new AdminInputError("자기 자신이나 하위 그룹을 상위 그룹으로 지정할 수 없습니다.");
          }
        }
        const sets = [];
        const values = [];
        if (changes.name !== undefined) { sets.push("GROUP_NM = ?"); values.push(changes.name); }
        if (changes.description !== undefined) { sets.push("GROUP_DESC = ?"); values.push(changes.description || null); }
        if (changes.parentGroupCd !== undefined) { sets.push("PAR_GROUP_CD = ?"); values.push(changes.parentGroupCd); }
        if (sets.length) {
          await connection.execute(`UPDATE TM_GROUP SET ${sets.join(", ")} WHERE GROUP_CD = ?`, [...values, groupCd]);
        }
        if (changes.userCds) {
          await assertUsersExist(connection, changes.userCds);
          await replaceGroupMembers(connection, groupCd, changes.userCds);
        }
      });
    } catch (error) {
      throw mapDuplicate(error, "같은 이름의 그룹이 이미 있습니다.");
    }
    response.sendStatus(204);
  });
  router.patch("/groups/:groupCd", updateGroup);
  router.put("/groups/:groupCd", updateGroup);

  router.put("/groups/:groupCd/members", route(async (request, response) => {
    const { groupCd } = request.params;
    if (!isGroupCd(groupCd)) throw new AdminInputError("그룹 식별자가 올바르지 않습니다.");
    const userCds = normalizeIdList(request.body?.userCds, isUserCd, "그룹 구성원 목록 형식이 올바르지 않습니다.", 2000);
    await withTransaction(getPool(), async (connection) => {
      await assertGroupsExist(connection, [groupCd]);
      await assertUsersExist(connection, userCds);
      await replaceGroupMembers(connection, groupCd, userCds);
    });
    response.sendStatus(204);
  }));

  router.delete("/groups/:groupCd", route(async (request, response) => {
    const { groupCd } = request.params;
    if (!isGroupCd(groupCd)) throw new AdminInputError("그룹 식별자가 올바르지 않습니다.");
    await withTransaction(getPool(), async (connection) => {
      const [rows] = await connection.execute(
        "SELECT PAR_GROUP_CD AS parentGroupCd FROM TM_GROUP WHERE GROUP_CD = ? FOR UPDATE",
        [groupCd],
      );
      if (!rows.length) return;
      // 하위 그룹은 삭제되는 그룹의 상위 그룹으로 올려 조직 구조를 유지합니다.
      await connection.execute(
        "UPDATE TM_GROUP SET PAR_GROUP_CD = ? WHERE PAR_GROUP_CD = ?",
        [rows[0].parentGroupCd ?? null, groupCd],
      );
      await connection.execute("DELETE FROM TM_GROUP WHERE GROUP_CD = ?", [groupCd]);
    });
    response.sendStatus(204);
  }));

  return router;
}
