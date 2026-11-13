import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export const SESSION_COOKIE_NAME = "cod_report_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export const AUTH_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS TM_USER (
    USER_CD VARCHAR(50) NOT NULL PRIMARY KEY,
    SYSTEM_AUTH_CD VARCHAR(200) NULL,
    USER_NM VARCHAR(200) NOT NULL,
    USER_ID VARCHAR(200) NOT NULL,
    EMAIL VARCHAR(200) NULL,
    TEL VARCHAR(200) NULL,
    PW VARCHAR(255) NOT NULL,
    LOCK_CNT INT NOT NULL DEFAULT 0,
    THEME VARCHAR(10) NULL,
    MONITOR_SHARE_USER VARCHAR(50) NULL,
    USE_YN VARCHAR(1) NOT NULL DEFAULT 'Y',
    USER_REGIMENT VARCHAR(200) NULL,
    USER_IMG MEDIUMTEXT NULL,
    USER_ROLE VARCHAR(50) NOT NULL DEFAULT 'VIEWER',
    USER_TYPE VARCHAR(200) NULL,
    IP VARCHAR(50) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY ux_tm_user_id (USER_ID),
    KEY ix_tm_user_name (USER_NM)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS TM_GROUP (
    GROUP_CD VARCHAR(50) NOT NULL PRIMARY KEY,
    PAR_GROUP_CD VARCHAR(50) NULL,
    GROUP_NM VARCHAR(200) NOT NULL,
    GROUP_DESC VARCHAR(4000) NULL,
    LONGITUDE DOUBLE NULL,
    LATITUDE DOUBLE NULL,
    ADDRESS VARCHAR(4000) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY ux_tm_group_name (GROUP_NM),
    CONSTRAINT fk_tm_group_parent FOREIGN KEY (PAR_GROUP_CD) REFERENCES TM_GROUP(GROUP_CD) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS TC_ROLE (
    ROLE_CD VARCHAR(50) NOT NULL PRIMARY KEY,
    ROLE_NM VARCHAR(100) NOT NULL,
    UNIQUE KEY ux_tc_role_name (ROLE_NM)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS TC_USER_GROUP_ROLE (
    GROUP_CD VARCHAR(50) NOT NULL,
    USER_CD VARCHAR(50) NOT NULL,
    ROLE_CD VARCHAR(50) NOT NULL DEFAULT 'MEMBER',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (GROUP_CD, USER_CD),
    KEY ix_tc_user_group_role_user (USER_CD),
    CONSTRAINT fk_tc_user_group_role_group FOREIGN KEY (GROUP_CD) REFERENCES TM_GROUP(GROUP_CD) ON DELETE CASCADE,
    CONSTRAINT fk_tc_user_group_role_user FOREIGN KEY (USER_CD) REFERENCES TM_USER(USER_CD) ON DELETE CASCADE,
    CONSTRAINT fk_tc_user_group_role_role FOREIGN KEY (ROLE_CD) REFERENCES TC_ROLE(ROLE_CD)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS TC_USER_BLOCK_IP (
    USER_CD VARCHAR(50) NOT NULL,
    USR_BLOCK_IP VARCHAR(50) NOT NULL,
    PRIMARY KEY (USER_CD, USR_BLOCK_IP),
    CONSTRAINT fk_tc_user_block_ip_user FOREIGN KEY (USER_CD) REFERENCES TM_USER(USER_CD) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS TC_AUTH_SESSION (
    TOKEN_HASH CHAR(64) NOT NULL PRIMARY KEY,
    USER_CD VARCHAR(50) NOT NULL,
    EXPIRES_AT DATETIME NOT NULL,
    CREATED_AT TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    IP VARCHAR(50) NULL,
    USER_AGENT VARCHAR(500) NULL,
    KEY ix_tc_auth_session_user (USER_CD),
    KEY ix_tc_auth_session_expiry (EXPIRES_AT),
    CONSTRAINT fk_tc_auth_session_user FOREIGN KEY (USER_CD) REFERENCES TM_USER(USER_CD) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS TC_TEMPLATE_GROUP_ACL (
    TEMPLATE_ID VARCHAR(64) NOT NULL,
    GROUP_CD VARCHAR(50) NOT NULL,
    PRIMARY KEY (TEMPLATE_ID, GROUP_CD),
    CONSTRAINT fk_tc_template_group_acl_template FOREIGN KEY (TEMPLATE_ID) REFERENCES report_templates(template_id) ON DELETE CASCADE,
    CONSTRAINT fk_tc_template_group_acl_group FOREIGN KEY (GROUP_CD) REFERENCES TM_GROUP(GROUP_CD) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS TC_TEMPLATE_USER_ACL (
    TEMPLATE_ID VARCHAR(64) NOT NULL,
    USER_CD VARCHAR(50) NOT NULL,
    PRIMARY KEY (TEMPLATE_ID, USER_CD),
    CONSTRAINT fk_tc_template_user_acl_template FOREIGN KEY (TEMPLATE_ID) REFERENCES report_templates(template_id) ON DELETE CASCADE,
    CONSTRAINT fk_tc_template_user_acl_user FOREIGN KEY (USER_CD) REFERENCES TM_USER(USER_CD) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof encoded !== "string") return false;
  const [algorithm, saltText, hashText] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, "base64url");
    const salt = Buffer.from(saltText, "base64url");
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = Buffer.from(await scrypt(password, salt, expected.length));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function validatePassword(password) {
  return typeof password === "string" && password.length >= 12 && password.length <= 256;
}

export function createSessionToken() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    hash: createHash("sha256").update(token).digest("hex"),
  };
}

export function hashSessionToken(token) {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return "";
  return createHash("sha256").update(token).digest("hex");
}

export function readSessionCookie(cookieHeader = "") {
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

export function canViewTemplate(user, userGroupIds, acl) {
  if (user?.role === "ADMIN" || user?.role === "EDITOR") return true;
  if (!user || user.role !== "VIEWER") return false;
  const allowedGroups = new Set(acl?.groups ?? []);
  const allowedUsers = new Set(acl?.users ?? []);
  // 열람 대상을 지정하지 않은 양식은 모든 사용자에게 공개한다.
  if (allowedGroups.size === 0 && allowedUsers.size === 0) return true;
  return allowedUsers.has(user.userCd) || userGroupIds.some((groupId) => allowedGroups.has(groupId));
}

export function validateUserId(userId) {
  return typeof userId === "string" && /^[A-Za-z0-9._@-]{3,200}$/.test(userId);
}
