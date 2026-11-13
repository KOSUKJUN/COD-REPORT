// 문서 모델 → Excel(.xlsx, SpreadsheetML). 보고서 페이지마다 시트 하나를 만든다.
// - 표: 실제 셀(병합·배경색·테두리·정렬·글자 서식). 숫자처럼 보이는 값은 숫자 셀로 넣어 바로 계산할 수 있게 한다.
// - 글: 한 줄에 한 행. 가운데·오른쪽 정렬은 시트 너비만큼 셀을 병합해 정렬한다.
// - 차트·도형·그림: 그려진 모습(PNG)을 그 자리에 그림으로 띄운다.
// - 가로로 나눈 칸은 위에서 아래로 차례대로 놓는다(엑셀에서 데이터를 다루기 쉽게).
import JSZip from "jszip";
import {
  DEFAULT_HANGUL_FONT,
  buildExportDocument,
  decodeImageDataUrl,
} from "./document-model.js";
import { xlsxPaperSize } from "../page-setup.js";

const EMU_PER_PT = 12700;
const DEFAULT_ROW_HEIGHT_PT = 16.5;
const MIN_SHEET_COLUMNS = 6;
const DEFAULT_COLUMN_WIDTH = 12;

function escapeXml(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// #rrggbb → FFRRGGBB (없거나 잘못된 값이면 null)
function argb(value) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? `FF${value.slice(1).toUpperCase()}` : null;
}

export function columnName(index) {
  let name = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

const cellRef = (row, column) => `${columnName(column)}${row + 1}`;

// "1,234" "-12.5" "35%" 처럼 숫자로 쓸 수 있는 글자는 { value, format } 으로 바꾼다.
// 앞자리 0("007")·기호가 붙은 값("▲3")은 글자 그대로 둔다.
export function parseNumericCell(text) {
  const trimmed = String(text ?? "").trim();
  const match = /^([+-]?)((?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.(\d+))?(%?)$/.exec(trimmed);
  if (!match) return null;
  const [, sign, integer, decimals = "", percent] = match;
  if (integer.length > 1 && integer.startsWith("0") && !integer.includes(",")) return null;
  const digits = integer.replace(/,/g, "");
  if (digits.length + decimals.length > 15) return null;
  let value = Number(`${sign}${digits}${decimals ? `.${decimals}` : ""}`);
  if (!Number.isFinite(value)) return null;
  const fraction = decimals ? `.${"0".repeat(decimals.length)}` : "";
  let format = integer.includes(",") ? `#,##0${fraction}` : fraction ? `0${fraction}` : "";
  if (percent) {
    value /= 100;
    format = `0${fraction}%`;
  }
  return { value, format };
}

// 한글·한자 등은 영문보다 두 배 정도 넓다.
function displayLength(text) {
  let length = 0;
  for (const char of String(text ?? "")) length += char.codePointAt(0) >= 0x2e80 ? 2 : 1;
  return length;
}

// ---------- 서식(styles.xml) ----------

class Registry {
  constructor(initial = []) {
    this.items = [];
    this.index = new Map();
    for (const item of initial) this.add(item);
  }

  add(value) {
    const key = JSON.stringify(value);
    if (!this.index.has(key)) {
      this.index.set(key, this.items.length);
      this.items.push(value);
    }
    return this.index.get(key);
  }
}

function createStyles() {
  const styles = {
    fonts: new Registry([{ name: DEFAULT_HANGUL_FONT, size: 10 }]),
    // 0·1번 채우기는 엑셀 예약값(none, gray125)
    fills: new Registry([{ pattern: "none" }, { pattern: "gray125" }]),
    borders: new Registry([{}]),
    numFmts: new Registry(),
    xfs: new Registry([{ font: 0, fill: 0, border: 0, numFmt: 0 }]),
  };
  return styles;
}

function fontId(styles, style = {}) {
  return styles.fonts.add({
    name: style.fontFamily || DEFAULT_HANGUL_FONT,
    size: Math.max(1, Math.round((Number(style.size) || 10) * 2) / 2),
    bold: Boolean(style.bold),
    italic: Boolean(style.italic),
    underline: Boolean(style.underline),
    strike: Boolean(style.strike),
    color: argb(style.color),
    script: style.script || "",
  });
}

function numFmtId(styles, format) {
  if (!format) return 0;
  // 사용자 지정 서식 번호는 164부터
  return 164 + styles.numFmts.add(format);
}

// options: { style, align, background, border: { color } | { bottom: color }, wrap, numFmt, vertical }
function xfId(styles, options = {}) {
  const fill = argb(options.background);
  let border = 0;
  if (options.border?.color) {
    const color = argb(options.border.color);
    border = styles.borders.add({ left: color, right: color, top: color, bottom: color });
  } else if (options.border?.bottom) {
    border = styles.borders.add({ bottom: argb(options.border.bottom) });
  }
  return styles.xfs.add({
    font: fontId(styles, options.style),
    fill: fill ? styles.fills.add({ pattern: "solid", color: fill }) : 0,
    border,
    numFmt: numFmtId(styles, options.numFmt),
    horizontal: options.align && options.align !== "left" ? options.align : "",
    vertical: options.vertical || "",
    wrap: Boolean(options.wrap),
  });
}

function stylesXml(styles) {
  const colorXml = (color) => (color ? `<color rgb="${color}"/>` : "");
  const fonts = styles.fonts.items.map((font) =>
    "<font>" +
    (font.bold ? "<b/>" : "") +
    (font.italic ? "<i/>" : "") +
    (font.strike ? "<strike/>" : "") +
    (font.underline ? "<u/>" : "") +
    (font.script === "super" ? '<vertAlign val="superscript"/>' : font.script === "sub" ? '<vertAlign val="subscript"/>' : "") +
    `<sz val="${font.size}"/>` +
    colorXml(font.color) +
    `<name val="${escapeXml(font.name)}"/><family val="2"/><charset val="129"/>` +
    "</font>").join("");
  const fills = styles.fills.items.map((fill) =>
    fill.pattern === "solid"
      ? `<fill><patternFill patternType="solid"><fgColor rgb="${fill.color}"/><bgColor indexed="64"/></patternFill></fill>`
      : `<fill><patternFill patternType="${fill.pattern}"/></fill>`).join("");
  const side = (name, color) => (color ? `<${name} style="thin"><color rgb="${color}"/></${name}>` : `<${name}/>`);
  const borders = styles.borders.items.map((border) =>
    `<border>${side("left", border.left)}${side("right", border.right)}${side("top", border.top)}${side("bottom", border.bottom)}<diagonal/></border>`).join("");
  const numFmts = styles.numFmts.items.length
    ? `<numFmts count="${styles.numFmts.items.length}">` +
      styles.numFmts.items.map((format, index) => `<numFmt numFmtId="${164 + index}" formatCode="${escapeXml(format)}"/>`).join("") +
      "</numFmts>"
    : "";
  const xfs = styles.xfs.items.map((xf) => {
    const alignment = xf.horizontal || xf.vertical || xf.wrap
      ? `<alignment${xf.horizontal ? ` horizontal="${xf.horizontal}"` : ""}${xf.vertical ? ` vertical="${xf.vertical}"` : ""}${xf.wrap ? ' wrapText="1"' : ""}/>`
      : "";
    return `<xf numFmtId="${xf.numFmt}" fontId="${xf.font}" fillId="${xf.fill}" borderId="${xf.border}" xfId="0"` +
      `${xf.numFmt ? ' applyNumberFormat="1"' : ""}${xf.font ? ' applyFont="1"' : ""}${xf.fill ? ' applyFill="1"' : ""}${xf.border ? ' applyBorder="1"' : ""}` +
      (alignment ? ` applyAlignment="1">${alignment}</xf>` : "/>");
  }).join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    numFmts +
    `<fonts count="${styles.fonts.items.length}">${fonts}</fonts>` +
    `<fills count="${styles.fills.items.length}">${fills}</fills>` +
    `<borders count="${styles.borders.items.length}">${borders}</borders>` +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${styles.xfs.items.length}">${xfs}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>";
}

// ---------- 시트 배치 ----------

// 가로 칸은 차례대로 펼치고, 떠 있는 그림은 본문 뒤에 이어 붙인다.
function flattenItems(items) {
  return items.flatMap((item) =>
    item.type === "columns" ? item.columns.flatMap((column) => flattenItems(column.items)) : [item]);
}

function layoutSheet(page, styles, media) {
  const items = flattenItems(page.items);
  for (const floating of page.floating ?? []) {
    items.push({ type: "image", src: floating.src, widthPt: floating.widthPt, heightPt: floating.heightPt, spaceAfterPt: 8 });
  }
  const sheetColumns = Math.max(
    MIN_SHEET_COLUMNS,
    ...items.filter((item) => item.type === "table").map((item) => item.columnCount),
  );
  const rows = new Map(); // rowIndex → { height, cells: Map(column → xml) }
  const merges = [];
  const images = [];
  const columnWidths = Array.from({ length: sheetColumns }, () => 0);
  let cursor = 0;

  const rowAt = (index) => {
    if (!rows.has(index)) rows.set(index, { height: 0, cells: new Map() });
    return rows.get(index);
  };
  const setHeight = (index, height) => {
    const row = rowAt(index);
    row.height = Math.max(row.height, height);
  };
  const putCell = (row, column, { text = "", number = null, style }) => {
    const ref = cellRef(row, column);
    const s = style ? ` s="${style}"` : "";
    let xml;
    if (number !== null) xml = `<c r="${ref}"${s}><v>${number}</v></c>`;
    else if (text === "") xml = `<c r="${ref}"${s}/>`;
    else xml = `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
    rowAt(row).cells.set(column, xml);
  };
  const gapRows = (spacePt) => {
    if (spacePt >= 10) cursor += 1;
  };

  for (const item of items) {
    if (item.type === "paragraph") {
      const lines = item.text.split("\n");
      if (lines.length === 1 && lines[0] === "") {
        gapRows(item.spaceAfterPt);
        continue;
      }
      const align = item.align === "center" || item.align === "right" ? item.align : "";
      const style = xfId(styles, { style: item.style, align, vertical: "center" });
      const size = Number(item.style?.size) || 10;
      for (const line of lines) {
        putCell(cursor, 0, { text: line, style });
        if (align) merges.push(`${cellRef(cursor, 0)}:${cellRef(cursor, sheetColumns - 1)}`);
        setHeight(cursor, Math.max(DEFAULT_ROW_HEIGHT_PT, size * 1.45));
        cursor += 1;
      }
      gapRows(item.spaceAfterPt);
      continue;
    }

    if (item.type === "divider") {
      const style = xfId(styles, { border: { bottom: item.color || "#d0d5de" } });
      for (let column = 0; column < sheetColumns; column += 1) putCell(cursor, column, { style });
      setHeight(cursor, 6);
      cursor += 1;
      gapRows(item.spaceAfterPt);
      continue;
    }

    if (item.type === "image") {
      const image = decodeImageDataUrl(item.src);
      if (!image) continue;
      const id = media.length + 1;
      media.push({ ...image, name: `image${id}.${image.extension}` });
      images.push({ row: cursor, mediaName: `image${id}.${image.extension}`, widthPt: item.widthPt, heightPt: item.heightPt });
      cursor += Math.max(1, Math.ceil(item.heightPt / DEFAULT_ROW_HEIGHT_PT));
      gapRows(item.spaceAfterPt ?? 8);
      continue;
    }

    if (item.type === "table") {
      item.rows.forEach((row, rowIndex) => {
        let rowLines = 1;
        let rowSize = 10;
        row.cells.forEach((cell, columnIndex) => {
          if (!cell) {
            // 병합에 가려진 칸에도 테두리를 그려야 병합 영역 둘레가 끊기지 않는다.
            putCell(cursor + rowIndex, columnIndex, { style: xfId(styles, { border: { color: item.borderColor } }) });
            return;
          }
          const lines = cell.text.split("\n");
          const numeric = lines.length === 1 ? parseNumericCell(cell.text) : null;
          const style = xfId(styles, {
            style: cell.style,
            align: cell.align || "center",
            vertical: "center",
            background: cell.background,
            border: { color: item.borderColor },
            wrap: lines.length > 1,
            numFmt: numeric?.format,
          });
          putCell(cursor + rowIndex, columnIndex, numeric ? { number: numeric.value, style } : { text: cell.text, style });
          if (cell.rowspan > 1 || cell.colspan > 1) {
            merges.push(`${cellRef(cursor + rowIndex, columnIndex)}:${cellRef(cursor + rowIndex + cell.rowspan - 1, columnIndex + cell.colspan - 1)}`);
          }
          if (cell.rowspan === 1) rowLines = Math.max(rowLines, lines.length);
          rowSize = Math.max(rowSize, Number(cell.style?.size) || 10);
          if (cell.colspan === 1) {
            const longest = Math.max(...lines.map(displayLength));
            columnWidths[columnIndex] = Math.max(columnWidths[columnIndex], longest * (rowSize / 10) + 2);
          }
        });
        setHeight(cursor + rowIndex, row.heightPt || Math.max(DEFAULT_ROW_HEIGHT_PT, item.rowHeightPt, rowLines * rowSize * 1.35 + 4));
      });
      cursor += item.rows.length;
      gapRows(item.spaceAfterPt ?? 4);
    }
  }

  return { rows, merges, images, columnWidths, sheetColumns };
}

function drawingXml(images) {
  const anchors = images.map((image, index) =>
    "<xdr:oneCellAnchor>" +
    `<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${image.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${Math.round(image.widthPt * EMU_PER_PT)}" cy="${Math.round(image.heightPt * EMU_PER_PT)}"/>` +
    "<xdr:pic>" +
    `<xdr:nvPicPr><xdr:cNvPr id="${index + 2}" name="그림 ${index + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip r:embed="rId${index + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(image.widthPt * EMU_PER_PT)}" cy="${Math.round(image.heightPt * EMU_PER_PT)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
    "</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>").join("");
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    anchors +
    "</xdr:wsDr>";
}

function relationshipsXml(relationships) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    relationships.map(({ id, type, target }) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("") +
    "</Relationships>";
}

// ---------- 머리말·꼬리말 ----------

function headerFooterText(slots, model) {
  const convert = (value) => {
    const format = model.headerFooter.pageNumber?.format;
    const page = format === "dash" ? "- &P -" : format === "page-of" ? "&P / &N" : format === "korean" ? "&P 페이지" : "&P";
    return String(value ?? "")
      .replaceAll("&", "&&")
      .replaceAll("{날짜}", model.dateText)
      .replaceAll("{제목}", model.title.replaceAll("&", "&&"))
      .replaceAll("{페이지}", page)
      .replaceAll("{전체페이지}", "&N");
  };
  return ["left", "center", "right"]
    .map((side, index) => (slots?.[side] ? `&${"LCR"[index]}${convert(slots[side])}` : ""))
    .join("");
}

function headerFooterXml(model) {
  const config = model.headerFooter;
  if (!config) return "";
  const header = headerFooterText(config.header, model);
  const footer = headerFooterText(config.footer, model);
  if (!header && !footer) return "";
  return `<headerFooter${config.differentFirstPage ? ' differentFirst="1"' : ""}>` +
    (header ? `<oddHeader>${escapeXml(header)}</oddHeader>` : "") +
    (footer ? `<oddFooter>${escapeXml(footer)}</oddFooter>` : "") +
    "</headerFooter>";
}

function sheetXml(layout, model, hasDrawing) {
  const cols = layout.columnWidths
    .map((width, index) => {
      const value = width ? Math.min(50, Math.max(8, width)) : DEFAULT_COLUMN_WIDTH;
      return `<col min="${index + 1}" max="${index + 1}" width="${value.toFixed(2)}" customWidth="1"/>`;
    })
    .join("");
  const rowsXml = [...layout.rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, row]) => {
      const cells = [...row.cells.entries()].sort(([a], [b]) => a - b).map(([, xml]) => xml).join("");
      const height = row.height && Math.abs(row.height - DEFAULT_ROW_HEIGHT_PT) > 0.01
        ? ` ht="${row.height.toFixed(2)}" customHeight="1"`
        : "";
      return `<row r="${index + 1}"${height}>${cells}</row>`;
    })
    .join("");
  const merges = layout.merges.length
    ? `<mergeCells count="${layout.merges.length}">${layout.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`
    : "";
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
    '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>' +
    `<sheetFormatPr defaultRowHeight="${DEFAULT_ROW_HEIGHT_PT}" customHeight="1"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${rowsXml}</sheetData>` +
    merges +
    '<printOptions horizontalCentered="1"/>' +
    '<pageMargins left="0.8" right="0.8" top="0.86" bottom="0.7" header="0.3" footer="0.3"/>' +
    // 보고서 용지 크기·방향, 너비를 한 장에 맞춤(높이는 자동). 목록에 없는 크기는 프린터 기본 용지
    `<pageSetup${xlsxPaperSize(model.pageSetup) ? ` paperSize="${xlsxPaperSize(model.pageSetup)}"` : ""} orientation="${model.page.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>` +
    headerFooterXml(model) +
    (hasDrawing ? '<drawing r:id="rId1"/>' : "") +
    "</worksheet>";
}

// 시트 이름: 31자 이하, []:*?/\ 사용 불가, 중복 불가
function sheetNames(model) {
  if (model.pages.length === 1) {
    const name = model.title.replace(/[[\]:*?/\\]/g, "_").replace(/^'+|'+$/g, "").trim().slice(0, 31);
    return [name || "보고서"];
  }
  return model.pages.map((_, index) => `${index + 1}페이지`);
}

// 반환값: { 경로: 문자열 또는 Uint8Array(그림) }
export function buildXlsxFiles(report, options) {
  const model = buildExportDocument(report, options);
  const styles = createStyles();
  const media = [];
  const names = sheetNames(model);
  const files = {};
  const contentOverrides = [];
  let drawingCount = 0;

  model.pages.forEach((page, index) => {
    const sheetNumber = index + 1;
    const layout = layoutSheet(page, styles, media);
    const hasDrawing = layout.images.length > 0;
    files[`xl/worksheets/sheet${sheetNumber}.xml`] = sheetXml(layout, model, hasDrawing);
    contentOverrides.push([`/xl/worksheets/sheet${sheetNumber}.xml`, "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"]);
    if (hasDrawing) {
      drawingCount += 1;
      files[`xl/worksheets/_rels/sheet${sheetNumber}.xml.rels`] = relationshipsXml([{
        id: "rId1",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
        target: `../drawings/drawing${drawingCount}.xml`,
      }]);
      files[`xl/drawings/drawing${drawingCount}.xml`] = drawingXml(layout.images);
      files[`xl/drawings/_rels/drawing${drawingCount}.xml.rels`] = relationshipsXml(layout.images.map((image, imageIndex) => ({
        id: `rId${imageIndex + 1}`,
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
        target: `../media/${image.mediaName}`,
      })));
      contentOverrides.push([`/xl/drawings/drawing${drawingCount}.xml`, "application/vnd.openxmlformats-officedocument.drawing+xml"]);
    }
  });

  for (const item of media) files[`xl/media/${item.name}`] = item.bytes;

  const extensions = [...new Set(media.map((item) => item.extension))];
  files["[Content_Types].xml"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    extensions.map((extension) => `<Default Extension="${extension}" ContentType="image/${extension === "jpg" ? "jpeg" : extension}"/>`).join("") +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    contentOverrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join("") +
    "</Types>";

  files["_rels/.rels"] = relationshipsXml([
    { id: "rId1", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", target: "xl/workbook.xml" },
    { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" },
    { id: "rId3", type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties", target: "docProps/app.xml" },
  ]);

  files["docProps/core.xml"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeXml(model.title)}</dc:title><dc:creator>CODVILL cod-report</dc:creator>` +
    "</cp:coreProperties>";
  files["docProps/app.xml"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>CODVILL cod-report</Application></Properties>';

  files["xl/workbook.xml"] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<bookViews><workbookView/></bookViews>' +
    `<sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>` +
    "</workbook>";
  files["xl/_rels/workbook.xml.rels"] = relationshipsXml([
    ...names.map((_, index) => ({
      id: `rId${index + 1}`,
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
      target: `worksheets/sheet${index + 1}.xml`,
    })),
    { id: `rId${names.length + 1}`, type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", target: "styles.xml" },
  ]);
  // 본문을 모두 만든 뒤에 서식 목록이 완성된다.
  files["xl/styles.xml"] = stylesXml(styles);
  return files;
}

function buildZip(report, options) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(buildXlsxFiles(report, options))) zip.file(path, content);
  return zip;
}

export async function exportReportToXlsx(report, options) {
  return buildZip(report, options).generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    compression: "DEFLATE",
  });
}

export async function exportReportToXlsxBuffer(report, options) {
  return buildZip(report, options).generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
