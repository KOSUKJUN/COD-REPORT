// 사용자·그룹 관리 화면에서 사용하는 순수 함수 모음 (브라우저/Node 공용)

export const ROLE_OPTIONS = [
  { value: "ADMIN", label: "관리자", description: "사용자·그룹·접속정보와 모든 양식을 관리합니다." },
  { value: "EDITOR", label: "에디터", description: "보고서 양식을 만들고 편집하며 모든 결과를 열람합니다." },
  { value: "VIEWER", label: "뷰어", description: "권한을 받은 보고서 결과만 열람합니다." },
];

export const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS.map((role) => [role.value, role.label]));

const ROLE_ALIASES = new Map([
  ["admin", "ADMIN"], ["administrator", "ADMIN"], ["관리자", "ADMIN"], ["관리", "ADMIN"],
  ["editor", "EDITOR"], ["에디터", "EDITOR"], ["편집자", "EDITOR"], ["편집", "EDITOR"], ["작성자", "EDITOR"],
  ["viewer", "VIEWER"], ["뷰어", "VIEWER"], ["열람자", "VIEWER"], ["열람", "VIEWER"], ["사용자", "VIEWER"],
]);

export function normalizeRole(value, fallback = "VIEWER") {
  const key = String(value ?? "").trim().toLowerCase();
  if (!key) return fallback;
  return ROLE_ALIASES.get(key) ?? "";
}

// ---------- 상태 ----------

export const LOCK_LIMIT = 5;

export function userStatus(user) {
  if (!user.enabled) return "disabled";
  if (user.locked || Number(user.lockCount) >= LOCK_LIMIT) return "locked";
  return "active";
}

export const STATUS_LABELS = { active: "사용 중", locked: "잠김", disabled: "중지" };

// ---------- 한글 초성 검색 ----------

const CHOSUNG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

export function toChosung(value) {
  let result = "";
  for (const char of String(value ?? "")) {
    const code = char.charCodeAt(0) - 0xac00;
    result += code >= 0 && code <= 11171 ? CHOSUNG[Math.floor(code / 588)] : char;
  }
  return result;
}

function isChosungOnly(value) {
  return /^[ㄱ-ㅎ\s]+$/.test(value);
}

/** 이름·아이디·이메일·전화·그룹명에서 검색합니다. 초성(ㅎㄱㄷ)과 공백 구분 다중 키워드를 지원합니다. */
export function matchesQuery(fields, query) {
  const terms = String(query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = fields.filter(Boolean).join(" ").toLowerCase();
  const chosung = toChosung(haystack);
  const compactPhone = haystack.replace(/[-\s()]/g, "");
  return terms.every((term) => {
    if (haystack.includes(term)) return true;
    if (isChosungOnly(term) && chosung.includes(term)) return true;
    const digits = term.replace(/[-()]/g, "");
    return /^\d{3,}$/.test(digits) && compactPhone.includes(digits);
  });
}

// ---------- 필터 / 정렬 ----------

export function filterUsers(users, { query = "", role = "", status = "", groupCd = "", groupNames = new Map(), scopeCds = null } = {}) {
  return users.filter((user) => {
    if (role && user.role !== role) return false;
    if (status === "online") {
      if (!user.activeSessions) return false;
    } else if (status && userStatus(user) !== status) return false;
    if (groupCd === "__none__") {
      if (user.groupCds.length) return false;
    } else if (groupCd) {
      const scope = scopeCds ?? new Set([groupCd]);
      if (!user.groupCds.some((cd) => scope.has(cd))) return false;
    }
    const names = user.groupCds.map((cd) => groupNames.get(cd));
    return matchesQuery([user.name, user.userId, user.email, user.tel, ...names], query);
  });
}

const ROLE_ORDER = { ADMIN: 0, EDITOR: 1, VIEWER: 2 };
const STATUS_ORDER = { locked: 0, disabled: 1, active: 2 };

export function sortUsers(users, key = "name", direction = "asc") {
  const factor = direction === "desc" ? -1 : 1;
  const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
  const value = (user) => {
    switch (key) {
      case "role": return ROLE_ORDER[user.role] ?? 9;
      case "status": return STATUS_ORDER[userStatus(user)];
      case "lastLogin": return user.lastLoginAt ? parseServerDate(user.lastLoginAt)?.getTime() ?? 0 : 0;
      case "groups": return user.groupCds.length;
      case "userId": return user.userId;
      default: return user.name;
    }
  };
  return [...users].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    const result = typeof left === "number" && typeof right === "number"
      ? left - right
      : collator.compare(String(left), String(right));
    return (result || collator.compare(a.name, b.name)) * factor;
  });
}

// ---------- 그룹 트리 ----------

/** 그룹을 트리 순서로 펼쳐 depth와 하위 그룹 목록을 붙입니다. 끊어진 상위 참조는 최상위로 취급합니다. */
export function buildGroupTree(groups) {
  const byCd = new Map(groups.map((group) => [group.groupCd, group]));
  const children = new Map();
  for (const group of groups) {
    const parent = group.parentGroupCd && byCd.has(group.parentGroupCd) ? group.parentGroupCd : "";
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(group);
  }
  const collator = new Intl.Collator("ko", { numeric: true });
  for (const list of children.values()) list.sort((a, b) => collator.compare(a.name, b.name));

  const flat = [];
  const visited = new Set();
  const walk = (parentCd, depth, path) => {
    for (const group of children.get(parentCd) ?? []) {
      if (visited.has(group.groupCd)) continue;
      visited.add(group.groupCd);
      const entry = { ...group, depth, path: [...path, group.name], hasChildren: (children.get(group.groupCd) ?? []).length > 0 };
      flat.push(entry);
      walk(group.groupCd, depth + 1, entry.path);
    }
  };
  walk("", 0, []);
  // 순환 참조 등으로 방문하지 못한 그룹도 보이도록 추가
  for (const group of groups) {
    if (!visited.has(group.groupCd)) flat.push({ ...group, depth: 0, path: [group.name], hasChildren: false });
  }
  return flat;
}

export function descendantGroupCds(groups, groupCd) {
  const result = new Set([groupCd]);
  let added = true;
  while (added) {
    added = false;
    for (const group of groups) {
      if (group.parentGroupCd && result.has(group.parentGroupCd) && !result.has(group.groupCd)) {
        result.add(group.groupCd);
        added = true;
      }
    }
  }
  return result;
}

// ---------- 비밀번호 ----------

const PASSWORD_SETS = [
  "ABCDEFGHJKLMNPQRSTUVWXYZ",
  "abcdefghijkmnpqrstuvwxyz",
  "23456789",
  "!@#$%^&*-_=+?",
];

function randomInt(max) {
  const cryptoApi = globalThis.crypto;
  const buffer = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  let value;
  do {
    cryptoApi.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % max;
}

/** 헷갈리는 문자(0/O, 1/l/I)를 뺀 강력한 임시 비밀번호를 만듭니다. */
export function generatePassword(length = 16) {
  const size = Math.max(12, Math.min(64, length));
  const all = PASSWORD_SETS.join("");
  const chars = PASSWORD_SETS.map((set) => set[randomInt(set.length)]);
  while (chars.length < size) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function passwordStrength(password) {
  const value = String(password ?? "");
  if (value.length < 12) return { score: 0, label: "12자 이상 필요" };
  let variety = 0;
  if (/[a-z]/.test(value)) variety += 1;
  if (/[A-Z]/.test(value)) variety += 1;
  if (/\d/.test(value)) variety += 1;
  if (/[^A-Za-z0-9]/.test(value)) variety += 1;
  const score = Math.min(3, (value.length >= 16 ? 1 : 0) + Math.max(0, variety - 1));
  return { score, label: ["약함", "보통", "강함", "매우 강함"][score] };
}

// ---------- 표 붙여넣기 / CSV ----------

/** 엑셀에서 복사한 탭 구분 텍스트 또는 CSV를 2차원 배열로 변환합니다. */
export function parseDelimited(input) {
  const source = String(input ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = source.split("\n").find((line) => line.trim()) ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows
    .map((cells) => cells.map((value) => value.trim()))
    .filter((cells) => cells.some((value) => value));
}

const HEADER_ALIASES = {
  userId: ["아이디", "id", "userid", "user id", "login", "계정", "사번", "user_id"],
  name: ["이름", "name", "성명", "username", "user name", "사용자명", "user_nm"],
  email: ["이메일", "email", "e-mail", "메일", "mail"],
  tel: ["전화", "전화번호", "연락처", "tel", "phone", "휴대폰", "mobile"],
  role: ["역할", "권한", "role", "등급"],
  groups: ["그룹", "group", "groups", "부서", "팀", "소속"],
  password: ["비밀번호", "password", "pw", "초기 비밀번호"],
};

function detectColumn(header) {
  const key = header.trim().toLowerCase();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(key)) return field;
  }
  return "";
}

const IMPORT_DEFAULT_ORDER = ["userId", "name", "email", "role", "groups", "tel"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_ID_PATTERN = /^[A-Za-z0-9._@-]{3,200}$/;

/**
 * 붙여넣은 표를 사용자 가져오기 행으로 바꿉니다. 첫 행이 머리글이면 열 이름으로, 아니면
 * 아이디·이름·이메일·역할·그룹·전화 순서로 해석합니다.
 */
export function parseUserImport(input, { existingUserIds = [], defaultRole = "VIEWER" } = {}) {
  const table = parseDelimited(input);
  if (!table.length) return { columns: [], rows: [], hasHeader: false };
  const detected = table[0].map(detectColumn);
  const hasHeader = detected.filter(Boolean).length >= 2 || detected.includes("userId");
  const columns = hasHeader ? detected : table[0].map((_, index) => IMPORT_DEFAULT_ORDER[index] ?? "");
  const body = hasHeader ? table.slice(1) : table;
  const taken = new Set(existingUserIds.map((id) => id.toLowerCase()));
  const seen = new Set();

  const rows = body.map((cells, index) => {
    const record = { userId: "", name: "", email: "", tel: "", role: "", groups: [], password: "" };
    columns.forEach((field, column) => {
      if (!field) return;
      const value = cells[column] ?? "";
      if (field === "groups") {
        record.groups = value.split(/[,;|/]/).map((part) => part.trim()).filter(Boolean);
      } else {
        record[field] = value;
      }
    });
    const issues = [];
    if (!USER_ID_PATTERN.test(record.userId)) issues.push("아이디 형식 오류");
    if (!record.name) record.name = record.userId.split("@")[0];
    if (!record.name) issues.push("이름 없음");
    if (record.email && !EMAIL_PATTERN.test(record.email)) issues.push("이메일 형식 오류");
    const role = normalizeRole(record.role, defaultRole);
    if (!role) issues.push(`알 수 없는 역할 '${record.role}'`);
    record.role = role || defaultRole;
    if (record.password && record.password.length < 12) issues.push("비밀번호 12자 미만");
    const key = record.userId.toLowerCase();
    if (key && taken.has(key)) issues.push("이미 등록된 아이디");
    else if (key && seen.has(key)) issues.push("목록 안 중복");
    seen.add(key);
    return { line: index + (hasHeader ? 2 : 1), ...record, issues };
  });
  return { columns, rows, hasHeader };
}

function csvCell(value) {
  const textValue = String(value ?? "");
  // 수식 주입 방지: 엑셀이 수식으로 해석하는 시작 문자를 무력화합니다.
  const safe = /^[=+\-@\t\r]/.test(textValue) ? `'${textValue}` : textValue;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows) {
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

// ---------- 표시용 ----------

export function initials(name) {
  const value = String(name ?? "").trim();
  if (!value) return "?";
  if (/[가-힣]/.test(value[0])) return value.length >= 3 ? value.slice(1, 3) : value.slice(0, 2);
  const parts = value.split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : value.slice(0, 2)).toUpperCase();
}

const AVATAR_HUES = [222, 262, 192, 152, 32, 340, 12, 282];

export function avatarHue(seed) {
  let hash = 0;
  for (const char of String(seed ?? "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_HUES[hash % AVATAR_HUES.length];
}

/** 서버의 'YYYY-MM-DD HH:MM:SS'(UTC) 문자열을 Date로 바꿉니다. */
export function parseServerDate(value) {
  if (!value) return null;
  const date = new Date(String(value).includes("T") ? value : `${String(value).replace(" ", "T")}Z`);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function formatRelative(value, now = new Date()) {
  const date = value instanceof Date ? value : parseServerDate(value);
  if (!date) return "기록 없음";
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "방금 전";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}일 전`;
  return date.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
}

export function formatDateTime(value) {
  const date = value instanceof Date ? value : parseServerDate(value);
  if (!date) return "-";
  return date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
