// 머리글·바닥글·페이지 번호 (Word '머리글/바닥글' 그룹).
// 각 영역은 왼쪽·가운데·오른쪽 세 칸의 글이며, 아래 필드를 넣으면 페이지마다 값으로 바뀐다.

export const FIELDS = [
  { token: "{페이지}", label: "페이지 번호" },
  { token: "{전체페이지}", label: "전체 페이지 수" },
  { token: "{날짜}", label: "작성일" },
  { token: "{제목}", label: "리포트 제목" },
];

export const PAGE_NUMBER_FORMATS = [
  { id: "arabic", label: "1, 2, 3", sample: "1" },
  { id: "dash", label: "- 1 -, - 2 -", sample: "- 1 -" },
  { id: "page-of", label: "1 / 3", sample: "1 / 3" },
  { id: "korean", label: "1 페이지", sample: "1 페이지" },
  { id: "roman-lower", label: "i, ii, iii", sample: "i" },
  { id: "roman-upper", label: "I, II, III", sample: "I" },
];

const EMPTY = () => ({ left: "", center: "", right: "" });

export function createHeaderFooter() {
  return {
    header: EMPTY(),
    footer: EMPTY(),
    differentFirstPage: false,
    firstHeader: EMPTY(),
    firstFooter: EMPTY(),
    differentOddEven: false,
    evenHeader: EMPTY(),
    evenFooter: EMPTY(),
    headerDivider: false,
    footerDivider: false,
    headerDistance: 22,
    footerDistance: 20,
    fontSize: 8,
    color: "#6b7385",
    pageNumber: { format: "arabic", start: 1 },
  };
}

// 저장된 설정에 빠진 값을 기본값으로 채운다.
export function normalizeHeaderFooter(value) {
  const base = createHeaderFooter();
  if (!value || typeof value !== "object") return base;
  const slots = (key) => ({ ...base[key], ...(value[key] ?? {}) });
  return {
    ...base,
    ...value,
    header: slots("header"),
    footer: slots("footer"),
    firstHeader: slots("firstHeader"),
    firstFooter: slots("firstFooter"),
    evenHeader: slots("evenHeader"),
    evenFooter: slots("evenFooter"),
    pageNumber: { ...base.pageNumber, ...(value.pageNumber ?? {}) },
  };
}

// Word 머리글/바닥글 갤러리에 해당하는 기본 모양
export const HEADER_GALLERY = [
  { id: "blank", label: "비어 있음", slots: { left: "", center: "머리글 입력", right: "" } },
  { id: "three", label: "비어 있음 (3열)", slots: { left: "왼쪽", center: "가운데", right: "오른쪽" } },
  { id: "title-date", label: "제목 + 작성일", slots: { left: "{제목}", center: "", right: "{날짜}" } },
  { id: "company", label: "회사명 + 제목", slots: { left: "CODVILL", center: "", right: "{제목}" } },
  { id: "confidential", label: "대외비", slots: { left: "", center: "대외비 (Confidential)", right: "" } },
];

export const FOOTER_GALLERY = [
  { id: "blank", label: "비어 있음", slots: { left: "", center: "바닥글 입력", right: "" } },
  { id: "three", label: "비어 있음 (3열)", slots: { left: "왼쪽", center: "가운데", right: "오른쪽" } },
  { id: "page-center", label: "페이지 번호 (가운데)", slots: { left: "", center: "{페이지}", right: "" } },
  { id: "page-of", label: "페이지 / 전체 페이지", slots: { left: "", center: "{페이지} / {전체페이지}", right: "" } },
  { id: "company-page", label: "회사명 + 페이지 번호", slots: { left: "CODVILL", center: "", right: "{페이지}" } },
];

export function hasContent(slots) {
  return Boolean(slots && (slots.left || slots.center || slots.right));
}

export function hasAnyHeaderFooter(value) {
  if (!value) return false;
  const config = normalizeHeaderFooter(value);
  return ["header", "footer", "firstHeader", "firstFooter", "evenHeader", "evenFooter"].some((key) => hasContent(config[key]));
}

function toRoman(number) {
  const table = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let rest = Math.max(1, Math.floor(number));
  let result = "";
  for (const [value, symbol] of table) {
    while (rest >= value) {
      result += symbol;
      rest -= value;
    }
  }
  return result;
}

// 페이지 번호 필드 하나의 표시 문자열
export function formatPageNumber(pageNumber, pageCount, format = "arabic") {
  switch (format) {
    case "dash": return `- ${pageNumber} -`;
    case "page-of": return `${pageNumber} / ${pageCount}`;
    case "korean": return `${pageNumber} 페이지`;
    case "roman-lower": return toRoman(pageNumber);
    case "roman-upper": return toRoman(pageNumber).toUpperCase();
    default: return String(pageNumber);
  }
}

// 이 페이지(0부터)에 쓸 머리글·바닥글 칸을 고른다.
export function slotsForPage(config, kind, pageIndex) {
  const value = normalizeHeaderFooter(config);
  const capital = kind === "header" ? "Header" : "Footer";
  if (value.differentFirstPage && pageIndex === 0) return value[`first${capital}`];
  const pageNumber = (Number(value.pageNumber.start) || 1) + pageIndex;
  if (value.differentOddEven && pageNumber % 2 === 0) return value[`even${capital}`];
  return value[kind];
}

export function resolveFields(text, { pageIndex = 0, pageCount = 1, title = "", date = "", config } = {}) {
  const value = normalizeHeaderFooter(config);
  const start = Number(value.pageNumber.start) || 1;
  const pageNumber = start + pageIndex;
  return String(text ?? "")
    .replaceAll("{페이지}", formatPageNumber(pageNumber, pageCount + start - 1, value.pageNumber.format))
    .replaceAll("{전체페이지}", String(pageCount + start - 1))
    .replaceAll("{날짜}", date)
    .replaceAll("{제목}", title);
}

export function resolveSlots(config, kind, info) {
  const slots = slotsForPage(config, kind, info.pageIndex);
  return {
    left: resolveFields(slots.left, { ...info, config }),
    center: resolveFields(slots.center, { ...info, config }),
    right: resolveFields(slots.right, { ...info, config }),
  };
}

const SLOT_KEYS = ["header", "footer", "firstHeader", "firstFooter", "evenHeader", "evenFooter"];

// Word '페이지 번호 → 페이지 위쪽/아래쪽 → 왼쪽/가운데/오른쪽': 해당 칸에 {페이지} 를 넣는다.
export function insertPageNumber(config, position, align) {
  const value = normalizeHeaderFooter(config);
  const target = position === "top" ? "header" : "footer";
  const slots = [target];
  if (value.differentFirstPage) slots.push(`first${target === "header" ? "Header" : "Footer"}`);
  if (value.differentOddEven) slots.push(`even${target === "header" ? "Header" : "Footer"}`);
  for (const key of slots) {
    if (!String(value[key][align]).includes("{페이지}")) {
      value[key][align] = value[key][align] ? `${value[key][align]} {페이지}` : "{페이지}";
    }
  }
  return value;
}

// Word '페이지 번호 제거': 모든 칸에서 페이지 번호·전체 페이지 필드를 지운다.
export function removePageNumbers(config) {
  const value = normalizeHeaderFooter(config);
  for (const key of SLOT_KEYS) {
    for (const align of ["left", "center", "right"]) {
      value[key][align] = value[key][align]
        .replace(/\{페이지\}\s*\/\s*\{전체페이지\}/g, "")
        .replaceAll("{페이지}", "")
        .replaceAll("{전체페이지}", "")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
  }
  return value;
}

export function hasPageNumber(config) {
  if (!config) return false;
  const value = normalizeHeaderFooter(config);
  return SLOT_KEYS.some((key) => ["left", "center", "right"].some((align) => value[key][align].includes("{페이지}")));
}

// 머리글 또는 바닥글 전체를 비운다(Word '머리글 제거').
export function clearArea(config, kind) {
  const value = normalizeHeaderFooter(config);
  const capital = kind === "header" ? "Header" : "Footer";
  value[kind] = EMPTY();
  value[`first${capital}`] = EMPTY();
  value[`even${capital}`] = EMPTY();
  return value;
}

export function applyGallery(config, kind, galleryId) {
  const gallery = (kind === "header" ? HEADER_GALLERY : FOOTER_GALLERY).find((item) => item.id === galleryId);
  const value = normalizeHeaderFooter(config);
  if (gallery) value[kind] = { ...gallery.slots };
  return value;
}
