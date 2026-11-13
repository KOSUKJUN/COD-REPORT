// 문서 모델 → MS Word(.docx). 편집 가능한 텍스트·표(병합·음영 포함)로 만든다.
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeightRule,
  HorizontalPositionRelativeFrom,
  ImageRun,
  NumberFormat,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  TabStopType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  TextWrappingType,
  UnderlineType,
  VerticalAlign,
  VerticalPositionRelativeFrom,
  WidthType,
} from "docx";
import {
  CONTENT_WIDTH_PT,
  DEFAULT_HANGUL_FONT,
  DEFAULT_LATIN_FONT,
  buildExportDocument,
  decodeImageDataUrl,
} from "./document-model.js";

const TWIPS_PER_PT = 20;
const twips = (pt) => Math.round(pt * TWIPS_PER_PT);
const hex = (color) => (color || "").replace("#", "").toUpperCase();

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

const UNDERLINE = {
  solid: UnderlineType.SINGLE,
  double: UnderlineType.DOUBLE,
  dotted: UnderlineType.DOTTED,
  dashed: UnderlineType.DASH,
  wavy: UnderlineType.WAVE,
};

// Word 형광펜은 정해진 15색만 지원하므로 같은 색은 형광펜, 나머지는 문자 음영으로 넣는다.
const HIGHLIGHT_NAMES = {
  "#ffff00": "yellow",
  "#00ff00": "green",
  "#00ffff": "cyan",
  "#ff00ff": "magenta",
  "#0000ff": "blue",
  "#ff0000": "red",
  "#000080": "darkBlue",
  "#008080": "darkCyan",
  "#008000": "darkGreen",
  "#800080": "darkMagenta",
  "#800000": "darkRed",
  "#808000": "darkYellow",
  "#808080": "darkGray",
  "#c0c0c0": "lightGray",
  "#000000": "black",
};

function fontFor(style) {
  if (style.fontFamily) {
    return { ascii: style.fontFamily, hAnsi: style.fontFamily, eastAsia: style.fontFamily, cs: style.fontFamily };
  }
  return { ascii: DEFAULT_LATIN_FONT, hAnsi: DEFAULT_LATIN_FONT, eastAsia: DEFAULT_HANGUL_FONT, cs: DEFAULT_LATIN_FONT };
}

function runOptions(style) {
  const options = {
    font: fontFor(style),
    size: Math.round((style.size || 10) * 2),
    bold: Boolean(style.bold),
    italics: Boolean(style.italic),
    color: hex(style.effect === "outline" ? style.color || "#1f2937" : style.color) || undefined,
  };
  if (style.underline) {
    options.underline = {
      type: UNDERLINE[style.underlineStyle] ?? UnderlineType.SINGLE,
      ...(style.underlineColor ? { color: hex(style.underlineColor) } : {}),
    };
  }
  if (style.strike) options.strike = true;
  if (style.script === "sub") options.subScript = true;
  if (style.script === "super") options.superScript = true;
  const highlight = style.highlight?.toLowerCase();
  if (highlight && HIGHLIGHT_NAMES[highlight]) {
    options.highlight = HIGHLIGHT_NAMES[highlight];
  } else if (highlight || style.shading) {
    options.shading = { type: ShadingType.CLEAR, color: "auto", fill: hex(highlight || "#d9d9d9") };
  }
  if (style.border) {
    options.border = { style: BorderStyle.SINGLE, size: 4, color: "auto", space: 0 };
  }
  return options;
}

function textRuns(textValue, style) {
  const lines = String(textValue ?? "").split("\n");
  return lines.map((line, index) => new TextRun({ ...runOptions(style), text: line, break: index > 0 ? 1 : 0 }));
}

function toParagraph(item, overrides = {}) {
  return new Paragraph({
    alignment: ALIGN[overrides.align ?? item.align] ?? AlignmentType.LEFT,
    spacing: {
      before: twips(item.spaceBeforePt ?? 0),
      after: twips(overrides.spaceAfterPt ?? item.spaceAfterPt ?? 0),
      // CSS line-height 는 글자 크기 기준, Word 배수는 글꼴 고유 줄 높이(맑은 고딕 약 1.3em) 기준이다.
      line: Math.max(240, Math.round((240 * (item.lineSpacing ?? 1.3)) / 1.3)),
    },
    children: textRuns(item.text, item.style),
  });
}

function toDivider(item) {
  return new Paragraph({
    spacing: { before: 0, after: twips(item.spaceAfterPt ?? 12) },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: hex(item.color), space: 1 } },
    children: [],
  });
}

function tableColumnSizes(item, total) {
  const percents = item.columnPercents?.length === item.columnCount
    ? item.columnPercents
    : Array.from({ length: item.columnCount }, () => 100 / item.columnCount);
  const sizes = percents.map((percent) => Math.floor((total * percent) / 100));
  sizes[sizes.length - 1] = total - sizes.slice(0, -1).reduce((sum, value) => sum + value, 0);
  return sizes;
}

function toTable(item) {
  if (!item.rows.length) return new Paragraph({ children: [] });
  const totalTwips = twips(item.widthPt ?? CONTENT_WIDTH_PT);
  const columnWidths = tableColumnSizes(item, totalTwips);
  const border = { style: BorderStyle.SINGLE, size: 4, color: hex(item.borderColor) };
  const borders = { top: border, bottom: border, left: border, right: border };

  return new Table({
    width: { size: totalTwips, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    rows: item.rows.map(
      (row) =>
        new TableRow({
          height: row.heightPt
            ? { value: twips(row.heightPt), rule: HeightRule.EXACT }
            : { value: twips(item.rowHeightPt), rule: HeightRule.ATLEAST },
          children: row.cells
            .map((cell, columnIndex) => {
              if (!cell) return null;
              const width = columnWidths
                .slice(columnIndex, columnIndex + cell.colspan)
                .reduce((sum, value) => sum + value, 0);
              return new TableCell({
                width: { size: width, type: WidthType.DXA },
                columnSpan: cell.colspan > 1 ? cell.colspan : undefined,
                rowSpan: cell.rowspan > 1 ? cell.rowspan : undefined,
                verticalAlign: VerticalAlign.CENTER,
                borders,
                margins: { top: 40, bottom: 40, left: 60, right: 60 },
                shading: cell.background
                  ? { type: ShadingType.CLEAR, color: "auto", fill: hex(cell.background) }
                  : undefined,
                children: [
                  new Paragraph({
                    alignment: ALIGN[cell.align] ?? AlignmentType.CENTER,
                    spacing: { before: 0, after: 0, line: 288 },
                    children: textRuns(cell.text, cell.style),
                  }),
                ],
              });
            })
            .filter(Boolean),
        }),
    ),
  });
}

// 그림은 문단 안의 인라인 이미지로 넣는다. (크기 단위: 픽셀 96dpi)
function toImage(item) {
  const image = decodeImageDataUrl(item.src);
  if (!image) return null;
  const pxPerPt = 96 / 72;
  return new Paragraph({
    alignment: ALIGN[item.align] ?? AlignmentType.CENTER,
    spacing: { before: 0, after: twips(item.spaceAfterPt ?? 6) },
    children: [
      new ImageRun({
        type: image.extension === "jpg" ? "jpg" : image.extension,
        data: image.bytes,
        transformation: {
          width: Math.max(1, Math.round(item.widthPt * pxPerPt)),
          height: Math.max(1, Math.round(item.heightPt * pxPerPt)),
        },
      }),
    ],
  });
}

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "auto" };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

// 가로로 나눈 줄: 테두리 없는 1행 표의 칸에 각 요소를 넣는다.
function toColumns(item) {
  const columnWidths = item.columns.map((column) => twips(column.widthPt));
  return new Table({
    width: { size: columnWidths.reduce((sum, value) => sum + value, 0), type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders: { ...NO_BORDERS, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
    rows: [
      new TableRow({
        children: item.columns.map((column, index) => new TableCell({
          width: { size: columnWidths[index], type: WidthType.DXA },
          borders: NO_BORDERS,
          margins: { top: 0, bottom: 0, left: 120, right: 120 },
          verticalAlign: VerticalAlign.TOP,
          children: itemsToChildren(column.items),
        })),
      }),
    ],
  });
}

function itemsToChildren(items) {
  const children = [];
  for (const item of items) {
    if (item.type === "paragraph") children.push(toParagraph(item));
    else if (item.type === "divider") children.push(toDivider(item));
    else if (item.type === "table") children.push(toTable(item));
    else if (item.type === "columns") children.push(toColumns(item));
    else if (item.type === "image") {
      const image = toImage(item);
      if (image) children.push(image);
    }
  }
  // Word 구역·표 칸은 문단으로 끝나야 하므로 표로 끝나면 빈 문단을 둔다.
  if (!children.length || children[children.length - 1] instanceof Table) {
    children.push(new Paragraph({ children: [] }));
  }
  return children;
}

// 자유 배치: 용지 기준 좌표에 떠 있는 그림 (텍스트 앞/뒤)
const EMU_PER_PT = 12700;

function toFloatingRun(item) {
  const image = decodeImageDataUrl(item.src);
  if (!image) return null;
  const pxPerPt = 96 / 72;
  return new ImageRun({
    type: image.extension === "jpg" ? "jpg" : image.extension,
    data: image.bytes,
    transformation: {
      width: Math.max(1, Math.round(item.widthPt * pxPerPt)),
      height: Math.max(1, Math.round(item.heightPt * pxPerPt)),
    },
    floating: {
      horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: Math.round(item.xPt * EMU_PER_PT) },
      verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: Math.round(item.yPt * EMU_PER_PT) },
      behindDocument: item.behind,
      allowOverlap: true,
      lockAnchor: true,
      wrap: { type: TextWrappingType.NONE },
      zIndex: 10 + (item.z ?? 0),
    },
  });
}

function pageChildren(page) {
  const children = itemsToChildren(page.items);
  const floating = (page.floating ?? []).map(toFloatingRun).filter(Boolean);
  if (floating.length) {
    // 떠 있는 그림은 페이지 첫 문단에 붙여 두되 위치는 용지 기준으로 정한다.
    children.unshift(new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: "exact" }, children: floating }));
  }
  return children;
}

// ---------- 머리글 · 바닥글 · 페이지 번호 ----------

const NUMBER_FORMAT = {
  "roman-lower": NumberFormat.LOWER_ROMAN,
  "roman-upper": NumberFormat.UPPER_ROMAN,
};

// 칸 글자를 실행(run) 목록으로: {페이지}·{전체페이지}는 Word 필드로 넣어 자동으로 바뀌게 한다.
function slotRuns(text, model, style) {
  const config = model.headerFooter;
  const format = config.pageNumber.format;
  const base = { font: fontFor({}), size: Math.round(config.fontSize * 2), color: hex(config.color) };
  const runs = [];
  const parts = String(text ?? "")
    .replaceAll("{날짜}", model.dateText)
    .replaceAll("{제목}", model.title)
    .split(/(\{페이지\}|\{전체페이지\})/);
  for (const part of parts) {
    if (!part) continue;
    if (part === "{페이지}") {
      const children = format === "dash" ? ["- ", PageNumber.CURRENT, " -"]
        : format === "page-of" ? [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES]
          : format === "korean" ? [PageNumber.CURRENT, " 페이지"]
            : [PageNumber.CURRENT];
      runs.push(new TextRun({ ...base, ...style, children }));
    } else if (part === "{전체페이지}") {
      runs.push(new TextRun({ ...base, ...style, children: [PageNumber.TOTAL_PAGES] }));
    } else {
      runs.push(new TextRun({ ...base, ...style, text: part }));
    }
  }
  return runs;
}

// 왼쪽·가운데·오른쪽 칸을 탭 정렬로 한 줄에 놓는다.
function areaParagraph(slots, model, kind) {
  const config = model.headerFooter;
  const width = twips(model.page.contentWidthPt);
  const children = [
    ...slotRuns(slots.left, model),
    new TextRun({ text: "\t" }),
    ...slotRuns(slots.center, model),
    new TextRun({ text: "\t" }),
    ...slotRuns(slots.right, model),
  ];
  // 칸이 모두 비어 있으면(예: 첫 페이지를 비워 둔 경우) 구분선도 그리지 않는다.
  const divider = (kind === "header" ? config.headerDivider : config.footerDivider) &&
    Boolean(slots.left || slots.center || slots.right);
  return new Paragraph({
    tabStops: [
      { type: TabStopType.CENTER, position: Math.round(width / 2) },
      { type: TabStopType.RIGHT, position: width },
    ],
    spacing: { before: 0, after: 0 },
    border: divider
      ? { [kind === "header" ? "bottom" : "top"]: { style: BorderStyle.SINGLE, size: 4, color: hex(config.color), space: 2 } }
      : undefined,
    children,
  });
}

function areaFor(model, kind, key) {
  const Area = kind === "header" ? Header : Footer;
  return new Area({ children: [areaParagraph(model.headerFooter[key], model, kind)] });
}

function headerFooterSection(model) {
  const config = model.headerFooter;
  if (!config) return {};
  const make = (kind) => {
    const capital = kind === "header" ? "Header" : "Footer";
    return {
      default: areaFor(model, kind, kind),
      ...(config.differentFirstPage ? { first: areaFor(model, kind, `first${capital}`) } : {}),
      ...(config.differentOddEven ? { even: areaFor(model, kind, `even${capital}`) } : {}),
    };
  };
  return { headers: make("header"), footers: make("footer") };
}

function buildDocxDocument(report, options) {
  const model = buildExportDocument(report, options);
  const config = model.headerFooter;
  const PAGE = model.page;
  // docx 는 가로 방향이면 너비·높이를 바꿔 쓰므로 세로 기준(짧은 변, 긴 변)으로 넘긴다.
  const pageSize = {
    width: twips(Math.min(PAGE.widthPt, PAGE.heightPt)),
    height: twips(Math.max(PAGE.widthPt, PAGE.heightPt)),
    orientation: PAGE.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
  };
  return new Document({
    creator: "CODVILL cod-report",
    title: model.title,
    evenAndOddHeaderAndFooters: Boolean(config?.differentOddEven),
    styles: { default: { document: { run: { font: fontFor({}), size: 20 } } } },
    // 보고서 페이지마다 구역을 나눠 항상 새 쪽에서 시작하게 한다.
    // 머리글·바닥글은 첫 구역에만 정의하면 다음 구역이 '이전과 동일'로 이어받는다.
    sections: model.pages.map((page, index) => ({
      properties: {
        ...(index === 0 && config?.differentFirstPage ? { titlePage: true } : {}),
        page: {
          size: pageSize,
          margin: {
            top: twips(PAGE.marginTopPt),
            bottom: twips(PAGE.marginBottomPt),
            left: twips(PAGE.marginSidePt),
            right: twips(PAGE.marginSidePt),
            header: twips(config?.headerDistance ?? 22),
            footer: twips(config?.footerDistance ?? 20),
          },
          ...(index === 0 && config
            ? {
                pageNumbers: {
                  start: Number(config.pageNumber.start) || 1,
                  ...(NUMBER_FORMAT[config.pageNumber.format] ? { formatType: NUMBER_FORMAT[config.pageNumber.format] } : {}),
                },
              }
            : {}),
        },
      },
      ...(index === 0 ? headerFooterSection(model) : {}),
      children: pageChildren(page),
    })),
  });
}

// options.images: 화면에서 그린 차트·도형 그림 (document-model 참고)
export async function exportReportToDocx(report, options) {
  return Packer.toBlob(buildDocxDocument(report, options));
}

// 테스트(Node)용: Blob 대신 Buffer 로 만든다.
export async function exportReportToDocxBuffer(report, options) {
  return Packer.toBuffer(buildDocxDocument(report, options));
}
