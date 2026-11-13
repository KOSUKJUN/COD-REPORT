// 보고서(JSON)를 파일 형식과 무관한 문서 모델로 바꾼다.
// Word(.docx)·한글(.hwpx) 내보내기가 같은 모델을 사용하므로 화면·파일 간 내용이 일치한다.
//
// 캔버스는 1px = 1pt 이므로 화면 좌표를 그대로 옮긴다. 용지 크기는 report.pageSetup(기본 A4 595pt × 842pt)을 따른다.
// 각 파일 형식은 문서 모델의 page(용지 크기·여백·본문 너비)를 사용한다.

import { expandRepeatedBlocks, getBoundFieldValue, getTableMerges, getTableRows, getTableSummary } from "../data-binding.js";
import { formatReportDate, formatReportPeriod } from "../report-format.js";
import { getLayout, groupFlowRows, isFree } from "../layout.js";
import { hasAnyHeaderFooter, normalizeHeaderFooter } from "../header-footer.js";
import { getPageDimensions, normalizePageSetup } from "../page-setup.js";
import { resolvedColumnWidths, rowHeight } from "../table-size.js";

// 기본 용지(A4 세로). 실제 내보내기는 buildExportDocument 가 돌려주는 model.page 를 쓴다.
export const PAGE = getPageDimensions(null);
export const CONTENT_WIDTH_PT = PAGE.contentWidthPt;

export const DEFAULT_LATIN_FONT = "Segoe UI";
export const DEFAULT_HANGUL_FONT = "Malgun Gothic";

const TABLE_BORDER_COLOR = "#818793";
// 글자 크기가 저장되지 않은 요소는 화면에서 브라우저 기본값(16px)을 물려받는다.
const INHERITED_FONT_SIZE = 16;

function text(value) {
  return value === null || value === undefined ? "" : String(value);
}

// 서식 우선순위: 역할 기본값 < 요소 서식(textStyle) < 셀 서식
function runStyle(base, override = {}) {
  const style = { ...base };
  for (const key of [
    "fontFamily",
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
  ]) {
    if (override[key] !== undefined && override[key] !== "" && override[key] !== null) {
      style[key] = override[key];
    }
  }
  if (override.fontSize) style.size = Number(override.fontSize);
  // 원 문자는 파일 형식에서 지원하지 않아 문자 테두리로 바꾼다.
  if (style.enclosed) {
    style.border = true;
    delete style.enclosed;
  }
  return style;
}

function paragraph(textValue, style, options = {}) {
  return {
    type: "paragraph",
    text: text(textValue),
    style,
    align: options.align || "left",
    spaceBeforePt: options.spaceBeforePt ?? 0,
    spaceAfterPt: options.spaceAfterPt ?? 4,
    lineSpacing: options.lineSpacing ?? 1.3,
  };
}

function trendStyle(cellText) {
  if (cellText.startsWith("▼")) return { color: "#405f91", bold: true };
  if (cellText.startsWith("▲")) return { color: "#9c5252", bold: true };
  return {};
}

function buildTable(block, widthPt = CONTENT_WIDTH_PT) {
  const rows = getTableRows(block);
  const columnCount = Math.max(
    block.columns?.length ?? 0,
    ...rows.map((row) => row.cells?.length ?? 0),
    1,
  );
  const merges = getTableMerges(block);
  const covered = new Set();
  for (const merge of merges) {
    for (let r = merge.row; r < merge.row + merge.rowspan; r += 1) {
      for (let c = merge.column; c < merge.column + merge.colspan; c += 1) {
        if (r !== merge.row || c !== merge.column) covered.add(`${r}:${c}`);
      }
    }
  }

  const baseSize = Number(block.fontSize) || INHERITED_FONT_SIZE;
  const modelRows = rows.map((row, rowIndex) => ({
    heightPt: rowHeight(row) ?? undefined,
    cells: Array.from({ length: columnCount }, (_, columnIndex) => {
      if (covered.has(`${rowIndex}:${columnIndex}`)) return null;
      const merge = merges.find((item) => item.row === rowIndex && item.column === columnIndex);
      const cellText = text(row.cells?.[columnIndex]);
      const cellStyle = row.cellStyles?.[columnIndex] ?? {};
      const background =
        cellStyle.backgroundColor || block.columnStyles?.[columnIndex]?.backgroundColor || "";
      const base = {
        size: baseSize,
        color: "#333944",
        bold: Boolean(row.isTitleRow),
        ...trendStyle(cellText),
      };
      return {
        text: cellText,
        rowspan: Math.max(1, Math.min(merge?.rowspan ?? 1, rows.length - rowIndex)),
        colspan: Math.max(1, Math.min(merge?.colspan ?? 1, columnCount - columnIndex)),
        background,
        align: cellStyle.textAlign || "center",
        style: runStyle(base, cellStyle),
      };
    }),
  }));

  return {
    type: "table",
    columnCount,
    // 열마다 너비 비율(%) — 합 100
    columnPercents: resolvedColumnWidths(block, columnCount),
    rows: modelRows,
    borderColor: TABLE_BORDER_COLOR,
    rowHeightPt: 19,
    // The viewer's block has a 1px border on each side inside its flow width.
    widthPt: Math.max(1, widthPt - 2),
  };
}

// widthPt: 이 요소가 차지할 수 있는 너비(분할된 칸이면 칸 너비)
function blockItems(block, context, widthPt = context.contentWidthPt) {
  const ts = block.textStyle ?? {};
  const size = Number(block.fontSize) || INHERITED_FONT_SIZE;
  const align = block.align || "left";
  const field = (name, fallback = block[name]) => getBoundFieldValue(block, name, fallback ?? "");

  switch (block.type) {
    case "title":
      return [
        paragraph(
          field("content") || "제목 없는 보고서",
          runStyle({ size, bold: true, color: context.daily ? "#242a33" : "#202a42" }, ts),
          { align, spaceAfterPt: context.daily ? 2 : 8, lineSpacing: 1.4 },
        ),
      ];
    case "date":
      return [
        paragraph(
          formatReportDate(field("date", block.date ?? context.date)),
          runStyle({ size: 12, color: "#818a9b" }, ts),
          { align, spaceAfterPt: 16 },
        ),
      ];
    case "period":
      return [
        paragraph(
          `${formatReportPeriod(field("start"))} ~ ${formatReportPeriod(field("end"))}`,
          runStyle({ size: context.daily ? 9 : size, color: "#343a44" }, ts),
          { align: context.daily ? "center" : align, spaceAfterPt: 16 },
        ),
      ];
    case "subheading":
      return [
        paragraph(field("content"), runStyle({ size, bold: true, color: "#282e39" }, ts), {
          align,
          spaceBeforePt: 4,
          spaceAfterPt: 4,
        }),
      ];
    case "section":
      return [
        paragraph(field("heading") || "업무 항목", runStyle({ size, bold: true, color: "#30394c" }, ts), {
          align,
          spaceAfterPt: 5,
        }),
        paragraph(field("content"), runStyle({ size, color: "#4a5365" }, ts), {
          align,
          spaceAfterPt: 14,
          lineSpacing: 1.8,
        }),
      ];
    case "special":
      return [
        paragraph(field("heading"), runStyle({ size: 9, bold: true, color: "#343a44" }, ts), {
          align,
          spaceAfterPt: 3,
        }),
        paragraph(field("content"), runStyle({ size: 8, color: "#414751" }, ts), {
          align,
          spaceAfterPt: 8,
        }),
      ];
    case "divider":
      return [{ type: "divider", color: "#e5e8ee", spaceAfterPt: 16 }];
    case "image": {
      const raster = context.images[block.id];
      const src = raster?.src ?? block.image?.src;
      if (!src) return [];
      const widthPercent = Math.min(100, Math.max(5, Number(block.image?.widthPercent) || 100));
      const naturalWidth = Number(block.image?.naturalWidth) || raster?.width || 4;
      const naturalHeight = Number(block.image?.naturalHeight) || raster?.height || 3;
      const imageWidthPt = (widthPt * widthPercent) / 100;
      const items = [{
        type: "image",
        src,
        widthPt: imageWidthPt,
        heightPt: (imageWidthPt * naturalHeight) / naturalWidth,
        align: block.align || "center",
        spaceAfterPt: block.content ? 2 : 8,
      }];
      if (block.content) {
        items.push(paragraph(block.content, { size: 9, color: "#5d6678" }, { align: block.align || "center", spaceAfterPt: 8 }));
      }
      return items;
    }
    // 차트·도형은 화면에 그려진 모습을 그림(PNG)으로 받아 넣는다. 그림이 없으면 자리표시 문구를 둔다.
    case "chart":
    case "shape": {
      const raster = context.images[block.id];
      if (!raster?.src) {
        const label = block.type === "chart" ? `[차트: ${block.chart?.title || "제목 없음"}]` : `[도형${block.content ? `: ${block.content}` : ""}]`;
        return [paragraph(label, { size: 10, color: "#8a92a2", italic: true }, { align: "center", spaceAfterPt: 8 })];
      }
      // 화면에서 그려진 크기(1px = 1pt)를 쓰되 이 요소가 차지할 수 있는 너비를 넘지 않게 줄인다.
      const naturalWidth = block.type === "chart" ? raster.width || widthPt : Number(block.shape?.width) || raster.width;
      const naturalHeight = block.type === "chart" ? raster.height || Number(block.chart?.height) || 260 : Number(block.shape?.height) || raster.height;
      const scale = Math.min(1, widthPt / naturalWidth);
      return [{
        type: "image",
        src: raster.src,
        widthPt: naturalWidth * scale,
        heightPt: naturalHeight * scale,
        align: block.type === "chart" ? "center" : block.align || "center",
        spaceAfterPt: 8,
      }];
    }
    case "table": {
      const items = [];
      const heading = field("heading");
      const unit = field("unit");
      if (heading) {
        items.push(paragraph(heading, { size: 9, bold: true, color: "#2b3039" }, { spaceAfterPt: unit ? 0 : 4 }));
      }
      if (unit) {
        items.push(paragraph(unit, { size: 8, color: "#4a505b" }, { align: "right", spaceAfterPt: 2 }));
      }
      items.push(buildTable(block, widthPt));
      for (const definition of block.definitions ?? []) {
        items.push(paragraph(`· ${text(definition)}`, { size: 7, color: "#40577c" }, { spaceAfterPt: 0, lineSpacing: 1.2 }));
      }
      const summary = getTableSummary(block);
      if (summary) {
        items.push(paragraph(summary, { size: 8, bold: true, color: "#353a44" }, { spaceBeforePt: 3, spaceAfterPt: 6 }));
      } else {
        items.push(paragraph("", { size: 4 }, { spaceAfterPt: 4, lineSpacing: 1 }));
      }
      return items;
    }
    default:
      return [
        paragraph(field("content"), runStyle({ size, color: "#4a5365" }, ts), {
          align,
          spaceAfterPt: 10,
          lineSpacing: 1.8,
        }),
      ];
  }
}

// ---------- 요소 높이(layout.h) ----------
// 화면에서 높이를 늘린 요소는 파일에서도 비슷한 높이를 차지하게 한다.
// 표는 행 높이를 늘리고, 그림은 높이에 맞춰 비율대로 줄이고, 나머지는 아래 여백을 더한다.

function textWidthPt(line, size) {
  let width = 0;
  for (const char of line) width += (char.codePointAt(0) >= 0x2e80 ? 1 : 0.56) * size;
  return width;
}

function estimateItemHeight(item, widthPt) {
  if (item.type === "paragraph") {
    const size = Number(item.style?.size) || 10;
    const lines = item.text.split("\n").reduce(
      (sum, line) => sum + Math.max(1, Math.ceil(textWidthPt(line, size) / Math.max(20, widthPt))),
      0,
    );
    return lines * size * (item.lineSpacing || 1.3) + (item.spaceBeforePt || 0) + (item.spaceAfterPt || 0);
  }
  if (item.type === "table") return item.rows.length * item.rowHeightPt + (item.spaceAfterPt || 0);
  if (item.type === "image") return item.heightPt + (item.spaceAfterPt || 0);
  if (item.type === "divider") return 1 + (item.spaceAfterPt || 0);
  return 0;
}

export function estimateItemsHeight(items, widthPt = CONTENT_WIDTH_PT) {
  return items.reduce((sum, item) => sum + estimateItemHeight(item, widthPt), 0);
}

function applyBlockHeight(block, items, widthPt) {
  const height = getLayout(block).h;
  if (!height || !items.length || block.type === "chart" || block.type === "shape" || block.type === "divider") {
    return items;
  }
  const table = items.find((item) => item.type === "table");
  if (table && table.rows.length) {
    const other = estimateItemsHeight(items.filter((item) => item !== table), widthPt);
    table.rowHeightPt = Math.max(table.rowHeightPt, (height - other) / table.rows.length);
    return items;
  }
  const image = items.find((item) => item.type === "image");
  if (image) {
    const other = estimateItemsHeight(items.filter((item) => item !== image), widthPt) + (image.spaceAfterPt || 0);
    const available = Math.max(8, height - other);
    if (image.heightPt > available) {
      const scale = available / image.heightPt;
      image.widthPt *= scale;
      image.heightPt = available;
    }
  }
  const extra = height - estimateItemsHeight(items, widthPt);
  if (extra > 1) {
    const last = items[items.length - 1];
    last.spaceAfterPt = (last.spaceAfterPt || 0) + extra;
  }
  return items;
}

export function getReportPages(report) {
  return report?.pages?.length ? report.pages : [{ blocks: report?.blocks ?? [] }];
}

// 한 페이지의 요소를 화면과 같은 배치로 옮긴다.
// - 너비 100% 요소: 그대로 이어서
// - 가로로 나눈 줄: { type: "columns", columns: [{ widthPt, items }] } (파일에서는 테두리 없는 표)
// - 자유 배치: page.floating 에 용지 기준 좌표의 그림으로 (그림이 없으면 본문 끝에 이어서)
function pageContent(page, context) {
  const blocks = expandRepeatedBlocks(page.blocks);
  const items = [];
  const contentWidth = context.contentWidthPt;
  for (const row of groupFlowRows(blocks)) {
    if (row.length === 1 && row[0].width >= 100) {
      items.push(...applyBlockHeight(row[0].block, blockItems(row[0].block, context), contentWidth));
      continue;
    }
    items.push({
      type: "columns",
      columns: row.map(({ block, width }) => {
        const columnWidth = (contentWidth * width) / 100;
        // 칸 안쪽 여백(화면의 좌우 6px)을 빼고 배치한다.
        const innerWidth = Math.max(20, columnWidth - 12);
        return { widthPt: columnWidth, items: applyBlockHeight(block, blockItems(block, context, innerWidth), innerWidth) };
      }),
    });
  }

  const floating = [];
  for (const block of blocks.filter(isFree)) {
    const layout = getLayout(block);
    const raster = context.images[block.id];
    const src = raster?.src ?? (block.type === "image" ? block.image?.src : "");
    if (!src) {
      items.push(...blockItems(block, context));
      continue;
    }
    const widthPt = raster?.width || layout.w;
    const heightPt = raster?.height
      || (block.type === "image" && block.image?.naturalWidth
        ? (layout.w * block.image.naturalHeight) / block.image.naturalWidth
        : layout.w * 0.6);
    floating.push({ src, xPt: layout.x, yPt: layout.y, widthPt, heightPt, behind: layout.wrap === "behind", z: layout.z });
  }
  floating.sort((a, b) => a.z - b.z);
  return { items, floating };
}

// images: { [blockId]: { src: "data:image/png;base64,...", width, height } }
// 화면에서 그린 차트·도형·자유 배치 요소(또는 변환한 그림)를 내보내기 파일에 넣을 때 사용한다.
export function buildExportDocument(report, { images = {} } = {}) {
  const layoutType = report.layoutType || report.type;
  const page = getPageDimensions(report.pageSetup, layoutType);
  const context = { daily: layoutType === "daily", date: report.date, images, contentWidthPt: page.contentWidthPt };
  const pages = getReportPages(report);
  return {
    // 용지 크기(pt)·여백·본문 너비와 원래 설정(크기 이름·방향)
    page,
    pageSetup: normalizePageSetup(report.pageSetup),
    title: report.reportTitle || report.templateName || "보고서",
    dateText: formatReportDate(report.date),
    headerFooter: hasAnyHeaderFooter(report.headerFooter) ? normalizeHeaderFooter(report.headerFooter) : null,
    pages: pages.map((page) => pageContent(page, context)),
  };
}

// data URL → { bytes, extension, mediaType } (Word·한글에 넣을 수 있는 PNG/JPEG/GIF/BMP 만)
export function decodeImageDataUrl(src) {
  const match = /^data:image\/(png|jpe?g|gif|bmp);base64,([A-Za-z0-9+/=\s]+)$/i.exec(src ?? "");
  if (!match) return null;
  const subtype = match[1].toLowerCase();
  const extension = subtype === "jpeg" ? "jpg" : subtype;
  const base64 = match[2].replace(/\s/g, "");
  let bytes;
  if (typeof Buffer !== "undefined") {
    bytes = new Uint8Array(Buffer.from(base64, "base64"));
  } else {
    const binary = atob(base64);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  }
  return { bytes, extension, mediaType: `image/${extension === "jpg" ? "jpeg" : extension}` };
}

// 파일 이름에 쓸 수 없는 문자를 바꾼다.
export function exportFileName(report, extension) {
  const title = report.reportTitle?.trim() || report.templateName?.trim() ||
    (report.date ? `보고서-${report.date}` : "보고서");
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "보고서";
  return `${base}.${extension}`;
}
