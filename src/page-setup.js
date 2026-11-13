// 용지 크기·방향 (MS Word 레이아웃 › 크기와 같은 개념)
//
// pageSetup = { size: "A4" | ... | "custom", orientation: "portrait" | "landscape", widthMm, heightMm }
// widthMm/heightMm 은 사용자 지정(custom)일 때만 쓰며 항상 세로 기준(짧은 변 = 너비)으로 저장한다.
//
// 화면 캔버스는 1px = 1pt 이므로 용지 크기(pt)를 그대로 px 로 쓴다. (A4 = 595 × 842)
// 여백은 지금처럼 고정이다(위 62, 아래 50, 좌우 58 — 일간 화면은 42/34/38).

export const PAPER_SIZES = [
  { id: "A4", label: "A4", widthMm: 210, heightMm: 297 },
  { id: "A3", label: "A3", widthMm: 297, heightMm: 420 },
  { id: "A5", label: "A5", widthMm: 148, heightMm: 210 },
  { id: "B4", label: "B4 (JIS)", widthMm: 257, heightMm: 364 },
  { id: "B5", label: "B5 (JIS)", widthMm: 182, heightMm: 257 },
  { id: "Letter", label: "Letter", widthMm: 215.9, heightMm: 279.4 },
  { id: "Legal", label: "Legal", widthMm: 215.9, heightMm: 355.6 },
  { id: "Executive", label: "Executive", widthMm: 184.2, heightMm: 266.7 },
  { id: "Tabloid", label: "Tabloid", widthMm: 279.4, heightMm: 431.8 },
];

export const CUSTOM_SIZE_LIMITS = { minMm: 100, maxMm: 600 };

export const PAGE_MARGINS = { topPt: 62, bottomPt: 50, sidePt: 58 };
export const DAILY_PAGE_MARGINS = { topPt: 42, bottomPt: 34, sidePt: 38 };

export const DEFAULT_PAGE_SETUP = Object.freeze({ size: "A4", orientation: "portrait" });

export function mmToPt(mm) {
  return (mm * 72) / 25.4;
}

function clampMm(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(CUSTOM_SIZE_LIMITS.maxMm, Math.max(CUSTOM_SIZE_LIMITS.minMm, number)) * 10) / 10;
}

// 저장된 값(없거나 잘못된 값 포함)을 항상 쓸 수 있는 형태로 맞춘다.
export function normalizePageSetup(setup) {
  const orientation = setup?.orientation === "landscape" ? "landscape" : "portrait";
  if (setup?.size === "custom") {
    const a = clampMm(setup.widthMm, 210);
    const b = clampMm(setup.heightMm, 297);
    return { size: "custom", orientation, widthMm: Math.min(a, b), heightMm: Math.max(a, b) };
  }
  const paper = PAPER_SIZES.find((item) => item.id === setup?.size) ?? PAPER_SIZES[0];
  return { size: paper.id, orientation };
}

export function isDefaultPageSetup(setup) {
  const normalized = normalizePageSetup(setup);
  return normalized.size === "A4" && normalized.orientation === "portrait";
}

// 용지 크기(mm, 방향 반영)
export function getPaperMm(setup) {
  const normalized = normalizePageSetup(setup);
  const paper = normalized.size === "custom"
    ? normalized
    : PAPER_SIZES.find((item) => item.id === normalized.size);
  const short = Math.min(paper.widthMm, paper.heightMm);
  const long = Math.max(paper.widthMm, paper.heightMm);
  return normalized.orientation === "landscape"
    ? { widthMm: long, heightMm: short }
    : { widthMm: short, heightMm: long };
}

// 용지 크기(pt = 화면 px). A4 세로는 정확히 595 × 842.
export function getPageDimensions(setup, layoutType) {
  const { widthMm, heightMm } = getPaperMm(setup);
  const widthPt = Math.round(mmToPt(widthMm));
  const heightPt = Math.round(mmToPt(heightMm));
  const margins = layoutType === "daily" ? DAILY_PAGE_MARGINS : PAGE_MARGINS;
  return {
    widthPt,
    heightPt,
    marginTopPt: margins.topPt,
    marginBottomPt: margins.bottomPt,
    marginSidePt: margins.sidePt,
    contentWidthPt: widthPt - margins.sidePt * 2,
    landscape: widthPt > heightPt,
  };
}

function formatMm(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function pageSizeLabel(setup) {
  const normalized = normalizePageSetup(setup);
  return normalized.size === "custom"
    ? "사용자 지정"
    : PAPER_SIZES.find((item) => item.id === normalized.size).label;
}

// 예: "A4 · 세로 (210 × 297mm)"
export function describePageSetup(setup) {
  const normalized = normalizePageSetup(setup);
  const { widthMm, heightMm } = getPaperMm(normalized);
  return `${pageSizeLabel(normalized)} · ${normalized.orientation === "landscape" ? "가로" : "세로"} (${formatMm(widthMm)} × ${formatMm(heightMm)}mm)`;
}

export function paperDimensionText(paper) {
  return `${formatMm(paper.widthMm)} × ${formatMm(paper.heightMm)}mm`;
}

// 인쇄할 때만 용지 크기를 바꾼다(기본 스타일의 @page 는 A4 세로). 인쇄 창이 닫히면 원래대로 돌린다.
export function printWithPageSetup(setup) {
  const { widthMm, heightMm } = getPaperMm(setup);
  const style = document.createElement("style");
  style.dataset.pageSetupPrint = "";
  style.textContent = `@media print { @page { size: ${widthMm}mm ${heightMm}mm; } }`;
  document.head.append(style);
  const cleanup = () => {
    style.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  // afterprint 를 보내지 않는 브라우저 대비
  setTimeout(cleanup, 60_000);
}

// Excel(SpreadsheetML) paperSize 번호. 목록에 없으면 0(프린터 기본).
const XLSX_PAPER_SIZE = { Letter: 1, Tabloid: 3, Legal: 5, Executive: 7, A3: 8, A4: 9, A5: 11, B4: 12, B5: 13 };

export function xlsxPaperSize(setup) {
  return XLSX_PAPER_SIZE[normalizePageSetup(setup).size] ?? 0;
}
