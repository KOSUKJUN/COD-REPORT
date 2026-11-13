// 글꼴 서식(요소·표 셀 단위) 공용 로직.
// 서식은 block.textStyle 또는 table.rows[r].cellStyles[c] 에 저장되며,
// 값이 없는 속성은 보고서 기본 스타일을 그대로 따른다.

export const FONT_FAMILIES = [
  { value: "Malgun Gothic", label: "맑은 고딕", stack: "'Malgun Gothic', '맑은 고딕', sans-serif" },
  { value: "Nanum Gothic", label: "나눔고딕", stack: "'Nanum Gothic', 'NanumGothic', '나눔고딕', 'Malgun Gothic', sans-serif" },
  { value: "Dotum", label: "돋움", stack: "Dotum, '돋움', 'Malgun Gothic', sans-serif" },
  { value: "Gulim", label: "굴림", stack: "Gulim, '굴림', 'Malgun Gothic', sans-serif" },
  { value: "Batang", label: "바탕", stack: "Batang, '바탕', 'Nanum Myeongjo', serif" },
  { value: "Gungsuh", label: "궁서", stack: "Gungsuh, '궁서', Batang, serif" },
  { value: "Nanum Myeongjo", label: "나눔명조", stack: "'Nanum Myeongjo', 'NanumMyeongjo', '나눔명조', Batang, serif" },
  { value: "Arial", label: "Arial", stack: "Arial, 'Helvetica Neue', sans-serif" },
  { value: "Segoe UI", label: "Segoe UI", stack: "'Segoe UI', Arial, sans-serif" },
  { value: "Tahoma", label: "Tahoma", stack: "Tahoma, Verdana, sans-serif" },
  { value: "Verdana", label: "Verdana", stack: "Verdana, Tahoma, sans-serif" },
  { value: "Times New Roman", label: "Times New Roman", stack: "'Times New Roman', Times, serif" },
  { value: "Georgia", label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { value: "Courier New", label: "Courier New", stack: "'Courier New', Courier, monospace" },
  { value: "Consolas", label: "Consolas", stack: "Consolas, 'Courier New', monospace" },
];

export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 96;

export const UNDERLINE_STYLES = [
  { value: "solid", label: "실선" },
  { value: "double", label: "이중 실선" },
  { value: "dotted", label: "점선" },
  { value: "dashed", label: "파선" },
  { value: "wavy", label: "물결선" },
];

export const TEXT_EFFECTS = [
  { value: "", label: "효과 없음" },
  { value: "shadow", label: "그림자" },
  { value: "outline", label: "윤곽선" },
  { value: "glow", label: "네온" },
];

export const CASE_MODES = [
  { value: "sentence", label: "문장의 첫 글자를 대문자로" },
  { value: "lower", label: "모두 소문자로" },
  { value: "upper", label: "모두 대문자로" },
  { value: "title", label: "단어의 첫 글자를 대문자로" },
  { value: "toggle", label: "대/소문자 전환" },
];

export const HIGHLIGHT_COLORS = [
  { value: "#ffff00", label: "노랑" },
  { value: "#00ff00", label: "밝은 녹색" },
  { value: "#00ffff", label: "청록" },
  { value: "#ff00ff", label: "분홍" },
  { value: "#0000ff", label: "파랑" },
  { value: "#ff0000", label: "빨강" },
  { value: "#000080", label: "진한 파랑" },
  { value: "#008080", label: "진한 청록" },
  { value: "#008000", label: "녹색" },
  { value: "#800080", label: "보라" },
  { value: "#800000", label: "진한 빨강" },
  { value: "#808000", label: "진한 노랑" },
  { value: "#808080", label: "회색 50%" },
  { value: "#c0c0c0", label: "회색 25%" },
  { value: "#000000", label: "검정" },
];

// Word 기본 테마 색(Office) 10열 × (기본 + 밝게/어둡게 5단계)
const THEME_BASE = [
  ["#ffffff", "흰색"],
  ["#000000", "검정"],
  ["#e7e6e6", "회색"],
  ["#44546a", "파랑 회색"],
  ["#4472c4", "파랑"],
  ["#ed7d31", "주황"],
  ["#a5a5a5", "회색"],
  ["#ffc000", "금색"],
  ["#5b9bd5", "하늘색"],
  ["#70ad47", "녹색"],
];

function mix(hex, target, amount) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const goal = target === "white" ? 255 : 0;
  return `#${channels
    .map((channel) => Math.round(channel + (goal - channel) * amount).toString(16).padStart(2, "0"))
    .join("")}`;
}

// 행별 변형: [밝게/어둡게, 비율]. 흰색 열은 어둡게, 검정 열은 밝게만 의미가 있다.
const THEME_VARIANTS = [
  { white: ["black", 0.05], black: ["white", 0.5], other: ["white", 0.8] },
  { white: ["black", 0.15], black: ["white", 0.35], other: ["white", 0.6] },
  { white: ["black", 0.25], black: ["white", 0.25], other: ["white", 0.4] },
  { white: ["black", 0.35], black: ["white", 0.15], other: ["black", 0.25] },
  { white: ["black", 0.5], black: ["white", 0.05], other: ["black", 0.5] },
];

export const THEME_COLORS = [
  THEME_BASE.map(([value, label]) => ({ value, label })),
  ...THEME_VARIANTS.map((variant) =>
    THEME_BASE.map(([value, label]) => {
      const key = value === "#ffffff" ? "white" : value === "#000000" ? "black" : "other";
      const [target, amount] = variant[key];
      return {
        value: mix(value, target, amount),
        label: `${label}, ${target === "white" ? "밝게" : "어둡게"} ${Math.round(amount * 100)}%`,
      };
    }),
  ),
];

export const STANDARD_COLORS = [
  { value: "#c00000", label: "진한 빨강" },
  { value: "#ff0000", label: "빨강" },
  { value: "#ffc000", label: "주황" },
  { value: "#ffff00", label: "노랑" },
  { value: "#92d050", label: "연한 녹색" },
  { value: "#00b050", label: "녹색" },
  { value: "#00b0f0", label: "연한 파랑" },
  { value: "#0070c0", label: "파랑" },
  { value: "#002060", label: "진한 파랑" },
  { value: "#7030a0", label: "보라" },
];

export const SHADING_COLOR = "#d9d9d9";

// 서식 속성 목록. fontSize 는 요소에서는 block.fontSize 로 별도 관리된다.
export const TEXT_STYLE_KEYS = [
  "fontFamily",
  "fontSize",
  "bold",
  "italic",
  "underline",
  "underlineStyle",
  "underlineColor",
  "strike",
  "script",
  "color",
  "highlight",
  "shading",
  "border",
  "enclosed",
  "effect",
  "textAlign",
];

const DEFAULT_BOLD_TYPES = new Set(["title", "subheading"]);

export function isDefaultBold(blockType) {
  return DEFAULT_BOLD_TYPES.has(blockType);
}

export function getFontStack(fontFamily) {
  if (!fontFamily) return undefined;
  const known = FONT_FAMILIES.find((font) => font.value === fontFamily);
  return known ? known.stack : `'${fontFamily.replaceAll("'", "")}', sans-serif`;
}

export function getFontLabel(fontFamily) {
  if (!fontFamily) return "기본 글꼴";
  return FONT_FAMILIES.find((font) => font.value === fontFamily)?.label ?? fontFamily;
}

export function clampFontSize(size) {
  const value = Number(size);
  if (!Number.isFinite(value)) return null;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value * 2) / 2));
}

export function growFontSize(size) {
  const value = Number(size) || 12;
  const next = FONT_SIZES.find((candidate) => candidate > value);
  return clampFontSize(next ?? Math.floor(value / 10) * 10 + 10);
}

export function shrinkFontSize(size) {
  const value = Number(size) || 12;
  const previous = [...FONT_SIZES].reverse().find((candidate) => candidate < value);
  return clampFontSize(previous ?? value - 1);
}

export function changeTextCase(text, mode) {
  if (typeof text !== "string" || !text) return text;
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  if (mode === "title") {
    return text
      .toLowerCase()
      .replace(/(^|[^\p{L}\p{N}'’])(\p{Ll})/gu, (_match, prefix, letter) => prefix + letter.toUpperCase());
  }
  if (mode === "sentence") {
    return text
      .toLowerCase()
      .replace(/(^\s*|[.!?]\s+|\n\s*)(\p{Ll})/gu, (_match, prefix, letter) => prefix + letter.toUpperCase());
  }
  if (mode === "toggle") {
    return [...text]
      .map((char) => {
        const upper = char.toUpperCase();
        return char === upper ? char.toLowerCase() : upper;
      })
      .join("");
  }
  return text;
}

// Word의 Shift+F3 처럼 소문자 → 대문자 → 단어 첫 글자 대문자 순으로 순환한다.
export function nextCycledCase(text) {
  if (typeof text !== "string") return "lower";
  if (text === text.toLowerCase()) return "upper";
  if (text === text.toUpperCase()) return "title";
  return "lower";
}

export function pickTextStyle(source = {}) {
  const style = {};
  for (const key of TEXT_STYLE_KEYS) {
    if (source[key] !== undefined && source[key] !== "" && source[key] !== null) {
      style[key] = source[key];
    }
  }
  return style;
}

// 값이 비어 있으면(undefined, "", null) 속성을 지워 기본 서식으로 되돌린다.
export function applyTextStylePatch(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === "" || value === null) {
      delete target[key];
    } else {
      target[key] = value;
    }
  }
  return target;
}

export function clearTextStyle(target, { keep = [] } = {}) {
  for (const key of TEXT_STYLE_KEYS) {
    if (!keep.includes(key)) delete target[key];
  }
  return target;
}

export function textStyleToCss(style = {}, { includeFontSize = false } = {}) {
  if (!style) return undefined;
  const css = {};
  if (style.fontFamily) css.fontFamily = getFontStack(style.fontFamily);
  if (includeFontSize && style.fontSize) css.fontSize = `${style.fontSize}px`;
  if (style.bold !== undefined) css.fontWeight = style.bold ? 700 : 400;
  if (style.italic !== undefined) css.fontStyle = style.italic ? "italic" : "normal";

  const lines = [];
  if (style.underline) lines.push("underline");
  if (style.strike) lines.push("line-through");
  if (lines.length) {
    css.textDecorationLine = lines.join(" ");
    if (style.underline) {
      css.textDecorationStyle = style.underlineStyle || "solid";
      if (style.underlineColor) css.textDecorationColor = style.underlineColor;
      css.textUnderlineOffset = "0.18em";
    }
  }

  if (style.script === "sub" || style.script === "super") {
    css.verticalAlign = style.script;
    css.fontSize = includeFontSize && style.fontSize
      ? `${Math.round(style.fontSize * 68) / 100}px`
      : "0.68em";
    css.lineHeight = "1";
  }

  if (style.color) css.color = style.color;
  const background = style.highlight || (style.shading ? SHADING_COLOR : "");
  if (background) css.backgroundColor = background;

  if (style.enclosed) {
    css.border = "1px solid currentColor";
    css.borderRadius = "999px";
    css.padding = "0 0.3em";
  } else if (style.border) {
    css.border = "1px solid currentColor";
    css.padding = "0 0.12em";
  }
  if (background || style.border || style.enclosed) {
    css.boxDecorationBreak = "clone";
    css.WebkitBoxDecorationBreak = "clone";
  }

  if (style.effect === "shadow") {
    css.textShadow = "0.06em 0.06em 0.12em rgba(0, 0, 0, 0.45)";
  } else if (style.effect === "outline") {
    css.WebkitTextStroke = `0.04em ${style.color || "#1f2937"}`;
    css.color = "#ffffff";
  } else if (style.effect === "glow") {
    css.textShadow = "0 0 0.2em rgba(68, 114, 196, 0.9), 0 0 0.45em rgba(68, 114, 196, 0.6)";
  }

  return Object.keys(css).length ? css : undefined;
}
