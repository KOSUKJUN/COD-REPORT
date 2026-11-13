// 문서 모델 → 한글(.hwpx, OWPML). 한글 2014 이상에서 편집 가능한 문서로 연다.
// 단위: HWPUNIT = 1/7200 inch = 1/100 pt
import JSZip from "jszip";
import {
  CONTENT_WIDTH_PT,
  DEFAULT_HANGUL_FONT,
  DEFAULT_LATIN_FONT,
  buildExportDocument,
  decodeImageDataUrl,
} from "./document-model.js";

const hu = (pt) => Math.round(pt * 100);

const NS = [
  'xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"',
  'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"',
  'xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph"',
  'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section"',
  'xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core"',
  'xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"',
  'xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history"',
  'xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page"',
  'xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:opf="http://www.idpf.org/2007/opf/"',
  'xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart"',
  'xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar"',
  'xmlns:epub="http://www.idpf.org/2007/ops"',
  'xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"',
].join(" ");

const LANGS = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"];
const LANG_ATTRS = ["hangul", "latin", "hanja", "japanese", "other", "symbol", "user"];

const ALIGN = { left: "LEFT", center: "CENTER", right: "RIGHT", justify: "JUSTIFY" };
const UNDERLINE_SHAPE = {
  solid: "SOLID",
  double: "DOUBLE_SLIM",
  dotted: "DOT",
  dashed: "DASH",
  wavy: "WAVE",
};

function escapeXml(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function color(value, fallback = "#000000") {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value.toUpperCase() : fallback;
}

const allLangs = (value) => LANG_ATTRS.map((lang) => `${lang}="${value}"`).join(" ");

// 같은 속성은 한 번만 정의하고 ID로 참조한다.
class Registry {
  constructor() {
    this.items = [];
    this.index = new Map();
  }

  add(key, value) {
    if (!this.index.has(key)) {
      this.index.set(key, this.items.length);
      this.items.push(value);
    }
    return this.index.get(key);
  }
}

function createContext() {
  const fonts = new Registry();
  fonts.add(DEFAULT_HANGUL_FONT, DEFAULT_HANGUL_FONT);
  fonts.add(DEFAULT_LATIN_FONT, DEFAULT_LATIN_FONT);

  const borderFills = new Registry();
  // 1: 쪽 테두리용(없음), 2: 글자 기본(없음)
  borderFills.add("page", { borders: null, fill: null });
  borderFills.add("none", { borders: null, fill: null });

  const charPrs = new Registry();
  const paraPrs = new Registry();
  // 문서에 넣을 그림 파일(BinData/imageN.확장자)
  const binItems = [];
  const context = { fonts, borderFills, charPrs, paraPrs, binItems };
  // 0번 글자·문단 모양은 '바탕글' 스타일 기본값
  charPrId(context, { size: 10, color: "#000000" });
  paraPrId(context, { align: "left", lineSpacing: 1.6, spaceBeforePt: 0, spaceAfterPt: 0 });
  return context;
}

function borderFillId(context, { borders, fill }) {
  const key = JSON.stringify({ borders, fill });
  return context.borderFills.add(key, { borders, fill }) + 1;
}

function charPrId(context, style) {
  const hangulFont = context.fonts.add(style.fontFamily || DEFAULT_HANGUL_FONT, style.fontFamily || DEFAULT_HANGUL_FONT);
  const latinFont = context.fonts.add(style.fontFamily || DEFAULT_LATIN_FONT, style.fontFamily || DEFAULT_LATIN_FONT);
  const value = {
    height: hu(style.size || 10),
    textColor: style.effect === "outline" ? "#FFFFFF" : color(style.color),
    shadeColor: style.highlight ? color(style.highlight) : style.shading ? "#D9D9D9" : "none",
    borderFillIDRef: style.border
      ? borderFillId(context, { borders: { width: "0.12 mm", color: color(style.color) }, fill: null })
      : 2,
    hangulFont,
    latinFont,
    bold: Boolean(style.bold),
    italic: Boolean(style.italic),
    underline: style.underline
      ? { shape: UNDERLINE_SHAPE[style.underlineStyle] ?? "SOLID", color: color(style.underlineColor || style.color) }
      : null,
    strike: Boolean(style.strike),
    outline: style.effect === "outline",
    shadow: style.effect === "shadow",
    script: style.script || "",
  };
  return context.charPrs.add(JSON.stringify(value), value);
}

function paraPrId(context, options) {
  const value = {
    align: ALIGN[options.align] ?? "LEFT",
    lineSpacing: Math.round((options.lineSpacing ?? 1.6) * 100),
    prev: hu(options.spaceBeforePt ?? 0),
    next: hu(options.spaceAfterPt ?? 0),
    borderFillIDRef: options.bottomBorderColor
      ? borderFillId(context, { borders: { bottomOnly: true, width: "0.12 mm", color: color(options.bottomBorderColor) }, fill: null })
      : 2,
  };
  return context.paraPrs.add(JSON.stringify(value), value);
}

// ---------- header.xml ----------

function borderFillXml(id, { borders, fill }) {
  const line = (side) => {
    const visible = borders && (!borders.bottomOnly || side === "bottom");
    return `<hh:${side}Border type="${visible ? "SOLID" : "NONE"}" width="${visible ? borders.width : "0.1 mm"}" color="${visible ? borders.color : "#000000"}"/>`;
  };
  const fillXml = fill
    ? `<hc:fillBrush><hc:winBrush faceColor="${fill}" hatchColor="#999999" alpha="0"/></hc:fillBrush>`
    : "";
  return `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
    '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>' +
    `${line("left")}${line("right")}${line("top")}${line("bottom")}` +
    '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>' +
    `${fillXml}</hh:borderFill>`;
}

function charPrXml(id, c) {
  const fontRef = LANG_ATTRS.map((lang) => `${lang}="${lang === "hangul" || lang === "hanja" || lang === "japanese" ? c.hangulFont : c.latinFont}"`).join(" ");
  // useFontSpace=1: 한글 고정 빈칸 대신 글꼴의 빈칸 너비를 써서 화면과 같은 단어 간격을 유지한다.
  return `<hh:charPr id="${id}" height="${c.height}" textColor="${c.textColor}" shadeColor="${c.shadeColor}" useFontSpace="1" useKerning="0" symMark="NONE" borderFillIDRef="${c.borderFillIDRef}">` +
    `<hh:fontRef ${fontRef}/>` +
    `<hh:ratio ${allLangs(100)}/>` +
    `<hh:spacing ${allLangs(0)}/>` +
    `<hh:relSz ${allLangs(100)}/>` +
    `<hh:offset ${allLangs(0)}/>` +
    (c.bold ? "<hh:bold/>" : "") +
    (c.italic ? "<hh:italic/>" : "") +
    (c.underline
      ? `<hh:underline type="BOTTOM" shape="${c.underline.shape}" color="${c.underline.color}"/>`
      : '<hh:underline type="NONE" shape="SOLID" color="#000000"/>') +
    `<hh:strikeout shape="${c.strike ? "SOLID" : "NONE"}" color="${c.textColor}"/>` +
    `<hh:outline type="${c.outline ? "SOLID" : "NONE"}"/>` +
    `<hh:shadow type="${c.shadow ? "DROP" : "NONE"}" color="#B2B2B2" offsetX="10" offsetY="10"/>` +
    (c.script === "super" ? "<hh:supscript/>" : c.script === "sub" ? "<hh:subscript/>" : "") +
    "</hh:charPr>";
}

function paraPrXml(id, p) {
  return `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">` +
    `<hh:align horizontal="${p.align}" vertical="BASELINE"/>` +
    '<hh:heading type="NONE" idRef="0" level="0"/>' +
    '<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>' +
    '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>' +
    "<hh:margin>" +
    '<hc:intent value="0" unit="HWPUNIT"/><hc:left value="0" unit="HWPUNIT"/><hc:right value="0" unit="HWPUNIT"/>' +
    `<hc:prev value="${p.prev}" unit="HWPUNIT"/><hc:next value="${p.next}" unit="HWPUNIT"/>` +
    "</hh:margin>" +
    `<hh:lineSpacing type="PERCENT" value="${p.lineSpacing}" unit="HWPUNIT"/>` +
    `<hh:border borderFillIDRef="${p.borderFillIDRef}" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="${p.borderFillIDRef === 2 ? 0 : 200}" connect="0" ignoreMargin="0"/>` +
    "</hh:paraPr>";
}

function headerXml(context) {
  const fontfaces = LANGS.map(
    (lang) =>
      `<hh:fontface lang="${lang}" fontCnt="${context.fonts.items.length}">` +
      context.fonts.items
        .map((face, id) => `<hh:font id="${id}" face="${escapeXml(face)}" type="TTF" isEmbedded="0"/>`)
        .join("") +
      "</hh:fontface>",
  ).join("");
  const borderFills = context.borderFills.items.map((item, index) => borderFillXml(index + 1, item)).join("");
  const charPrs = context.charPrs.items.map((item, id) => charPrXml(id, item)).join("");
  const paraPrs = context.paraPrs.items.map((item, id) => paraPrXml(id, item)).join("");

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
    `<hh:head ${NS} version="1.4" secCnt="1">` +
    '<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>' +
    "<hh:refList>" +
    `<hh:fontfaces itemCnt="${LANGS.length}">${fontfaces}</hh:fontfaces>` +
    `<hh:borderFills itemCnt="${context.borderFills.items.length}">${borderFills}</hh:borderFills>` +
    `<hh:charProperties itemCnt="${context.charPrs.items.length}">${charPrs}</hh:charProperties>` +
    '<hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties>' +
    `<hh:paraProperties itemCnt="${context.paraPrs.items.length}">${paraPrs}</hh:paraProperties>` +
    '<hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles>' +
    "</hh:refList>" +
    '<hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>' +
    '<hh:docOption><hh:linkinfo path="" pageInherit="0" footnoteInherit="0"/></hh:docOption>' +
    '<hh:trackchageConfig flags="56"/>' +
    "</hh:head>";
}

// ---------- section0.xml ----------

// 머리말·꼬리말이 있으면 용지 위·아래 여백을 '여백까지의 거리 + 머리말 영역'으로 나눠 본문 위치는 그대로 둔다.
function secPrXml(model) {
  const config = model.headerFooter;
  const PAGE = model.page;
  const pageBorder = (type) =>
    `<hp:pageBorderFill type="${type}" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER"><hp:offset left="1417" right="1417" top="1417" bottom="1417"/></hp:pageBorderFill>`;
  // 한글은 용지 크기를 세로 기준(짧은 변 = width)으로 적고 방향은 landscape 로 정한다(WIDELY = 세로, NARROWLY = 가로).
  const paperWidth = Math.min(PAGE.widthPt, PAGE.heightPt);
  const paperHeight = Math.max(PAGE.widthPt, PAGE.heightPt);
  const headerDistance = config ? Math.min(PAGE.marginTopPt - 8, Number(config.headerDistance) || 22) : PAGE.marginTopPt;
  const footerDistance = config ? Math.min(PAGE.marginBottomPt - 8, Number(config.footerDistance) || 20) : PAGE.marginBottomPt;
  const hideFirst = config?.differentFirstPage ? 1 : 0;
  return '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="0" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">' +
    '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>' +
    `<hp:startNum pageStartsOn="BOTH" page="${config ? Number(config.pageNumber.start) || 1 : 0}" pic="0" tbl="0" equation="0"/>` +
    `<hp:visibility hideFirstHeader="${hideFirst}" hideFirstFooter="${hideFirst}" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>` +
    '<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>' +
    `<hp:pagePr landscape="${PAGE.landscape ? "NARROWLY" : "WIDELY"}" width="${hu(paperWidth)}" height="${hu(paperHeight)}" gutterType="LEFT_ONLY">` +
    `<hp:margin header="${hu(PAGE.marginTopPt - headerDistance)}" footer="${hu(PAGE.marginBottomPt - footerDistance)}" gutter="0" left="${hu(PAGE.marginSidePt)}" right="${hu(PAGE.marginSidePt)}" top="${hu(headerDistance)}" bottom="${hu(footerDistance)}"/>` +
    "</hp:pagePr>" +
    '<hp:footNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="EACH_COLUMN" beneathText="0"/></hp:footNotePr>' +
    '<hp:endNotePr><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/><hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/><hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/><hp:numbering type="CONTINUOUS" newNum="1"/><hp:placement place="END_OF_DOCUMENT" beneathText="0"/></hp:endNotePr>' +
    pageBorder("BOTH") + pageBorder("EVEN") + pageBorder("ODD") +
    "</hp:secPr>";
}

function runsXml(context, textValue, style) {
  const id = charPrId(context, style);
  return `<hp:run charPrIDRef="${id}"><hp:t>${escapeXml(textValue)}</hp:t></hp:run>`;
}

function paragraphXml({ paraPr, runs, pageBreak = false }) {
  return `<hp:p id="0" paraPrIDRef="${paraPr}" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0">${runs}</hp:p>`;
}

function textParagraphs(context, item, state) {
  const paraPr = paraPrId(context, item);
  // 여러 줄 텍스트는 줄마다 문단으로 나누고, 마지막 줄에만 문단 뒤 간격을 둔다.
  const lines = item.text.split("\n");
  return lines.map((line, index) => {
    const isLast = index === lines.length - 1;
    const pr = isLast ? paraPr : paraPrId(context, { ...item, spaceAfterPt: 0 });
    return paragraphXml({ paraPr: pr, runs: runsXml(context, line, item.style), pageBreak: state.takePageBreak() });
  }).join("");
}

function tableColumnSizes(item, total) {
  const percents = item.columnPercents?.length === item.columnCount
    ? item.columnPercents
    : Array.from({ length: item.columnCount }, () => 100 / item.columnCount);
  const sizes = percents.map((percent) => Math.floor((total * percent) / 100));
  sizes[sizes.length - 1] = total - sizes.slice(0, -1).reduce((sum, value) => sum + value, 0);
  return sizes;
}

function tableXml(context, item, state) {
  if (!item.rows.length) {
    return paragraphXml({ paraPr: 0, runs: runsXml(context, "", {}), pageBreak: state.takePageBreak() });
  }
  const totalWidth = hu(item.widthPt ?? CONTENT_WIDTH_PT);
  const widths = tableColumnSizes(item, totalWidth);
  const rowHeights = item.rows.map((row) => hu(row.heightPt ?? item.rowHeightPt));
  const tableHeight = rowHeights.reduce((sum, value) => sum + value, 0);
  const tableBorder = borderFillId(context, { borders: { width: "0.12 mm", color: color(item.borderColor) }, fill: null });

  const rowsXml = item.rows.map((row, rowIndex) => {
    const cells = row.cells.map((cell, columnIndex) => {
      if (!cell) return "";
      const width = widths.slice(columnIndex, columnIndex + cell.colspan).reduce((sum, value) => sum + value, 0);
      const cellBorder = borderFillId(context, {
        borders: { width: "0.12 mm", color: color(item.borderColor) },
        fill: cell.background ? color(cell.background, "") || null : null,
      });
      const paraPr = paraPrId(context, { align: cell.align, lineSpacing: 1.2, spaceBeforePt: 0, spaceAfterPt: 0 });
      const paragraphs = cell.text.split("\n")
        .map((line) => paragraphXml({ paraPr, runs: runsXml(context, line, cell.style) }))
        .join("");
      return `<hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${cellBorder}">` +
        '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' +
        paragraphs +
        "</hp:subList>" +
        `<hp:cellAddr colAddr="${columnIndex}" rowAddr="${rowIndex}"/>` +
        `<hp:cellSpan colSpan="${cell.colspan}" rowSpan="${cell.rowspan}"/>` +
        `<hp:cellSz width="${width}" height="${rowHeights.slice(rowIndex, rowIndex + cell.rowspan).reduce((sum, value) => sum + value, 0)}"/>` +
        '<hp:cellMargin left="300" right="300" top="200" bottom="200"/>' +
        "</hp:tc>";
    }).join("");
    return `<hp:tr>${cells}</hp:tr>`;
  }).join("");

  const tableId = state.nextTableId();
  const tbl = `<hp:tbl id="${tableId}" zOrder="${tableId}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${item.rows.length}" colCnt="${item.columnCount}" cellSpacing="0" borderFillIDRef="${tableBorder}" noAdjust="0">` +
    `<hp:sz width="${totalWidth}" widthRelTo="ABSOLUTE" height="${tableHeight}" heightRelTo="ABSOLUTE" protect="0"/>` +
    '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
    '<hp:outMargin left="0" right="0" top="0" bottom="0"/>' +
    '<hp:inMargin left="300" right="300" top="200" bottom="200"/>' +
    rowsXml +
    "</hp:tbl>";
  const paraPr = paraPrId(context, { align: "left", lineSpacing: 1, spaceBeforePt: 0, spaceAfterPt: 2 });
  return paragraphXml({ paraPr, runs: `<hp:run charPrIDRef="0">${tbl}<hp:t/></hp:run>`, pageBreak: state.takePageBreak() });
}

// 그림 요소(hp:pic). floating 이 있으면 용지 기준 좌표에 떠 있는 그림(텍스트 앞/뒤)으로 만든다.
function picElement(context, item, state, floating = null) {
  const image = decodeImageDataUrl(item.src);
  if (!image) return "";
  const binId = `image${context.binItems.length + 1}`;
  context.binItems.push({ id: binId, path: `BinData/${binId}.${image.extension}`, bytes: image.bytes, mediaType: image.mediaType });
  const width = Math.max(100, hu(item.widthPt));
  const height = Math.max(100, hu(item.heightPt));
  const picId = state.nextTableId();
  const identity = 'e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"';
  const wrap = floating ? (floating.behind ? "BEHIND_TEXT" : "IN_FRONT_OF_TEXT") : "TOP_AND_BOTTOM";
  const pos = floating
    ? `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PAPER" horzRelTo="PAPER" vertAlign="TOP" horzAlign="LEFT" vertOffset="${hu(floating.yPt)}" horzOffset="${hu(floating.xPt)}"/>`
    : '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>';
  return `<hp:pic id="${picId}" zOrder="${floating ? 1000 + (floating.z ?? 0) : picId}" numberingType="PICTURE" textWrap="${wrap}" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${picId}" reverse="0">` +
    '<hp:offset x="0" y="0"/>' +
    `<hp:orgSz width="${width}" height="${height}"/>` +
    `<hp:curSz width="${width}" height="${height}"/>` +
    '<hp:flip horizontal="0" vertical="0"/>' +
    `<hp:rotationInfo angle="0" centerX="${Math.round(width / 2)}" centerY="${Math.round(height / 2)}" rotateimage="1"/>` +
    `<hp:renderingInfo><hc:transMatrix ${identity}/><hc:scaMatrix ${identity}/><hc:rotMatrix ${identity}/></hp:renderingInfo>` +
    `<hc:img binaryItemIDRef="${binId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>` +
    `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${width}" y="0"/><hc:pt2 x="${width}" y="${height}"/><hc:pt3 x="0" y="${height}"/></hp:imgRect>` +
    `<hp:imgClip left="0" right="${width}" top="0" bottom="${height}"/>` +
    '<hp:inMargin left="0" right="0" top="0" bottom="0"/>' +
    `<hp:imgDim dimwidth="${width}" dimheight="${height}"/>` +
    "<hp:effects/>" +
    `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>` +
    pos +
    '<hp:outMargin left="0" right="0" top="0" bottom="0"/>' +
    "</hp:pic>";
}

// 그림: 글자처럼 취급하는(treatAsChar) 인라인 그림으로 넣고 문단 정렬로 위치를 맞춘다.
function pictureXml(context, item, state) {
  const pic = picElement(context, item, state);
  if (!pic) return "";
  const paraPr = paraPrId(context, { align: item.align || "center", lineSpacing: 1, spaceBeforePt: 0, spaceAfterPt: item.spaceAfterPt ?? 6 });
  return paragraphXml({ paraPr, runs: `<hp:run charPrIDRef="0">${pic}<hp:t/></hp:run>`, pageBreak: state.takePageBreak() });
}

function dividerXml(context, item, state) {
  // 한글은 문단 아래 여백까지 테두리 안에 넣으므로, 선 문단은 여백 없이 두고 간격은 별도 빈 문단으로 준다.
  const lineParaPr = paraPrId(context, { align: "left", lineSpacing: 1, spaceAfterPt: 0, bottomBorderColor: item.color });
  const spacerParaPr = paraPrId(context, { align: "left", lineSpacing: 1, spaceAfterPt: item.spaceAfterPt });
  return paragraphXml({ paraPr: lineParaPr, runs: runsXml(context, "", { size: 2 }), pageBreak: state.takePageBreak() }) +
    paragraphXml({ paraPr: spacerParaPr, runs: runsXml(context, "", { size: 2 }) });
}

// 칸 안처럼 쪽 나눔을 가져가면 안 되는 곳에서 쓰는 상태
function nestedState(state) {
  return { takePageBreak: () => false, nextTableId: () => state.nextTableId() };
}

// 테두리 없는 1행 표. cells: [{ widthHu, content(XML), align? }]
function layoutTableXml(context, cells, state, { margin = 0 } = {}) {
  const none = borderFillId(context, { borders: null, fill: null });
  const totalWidth = cells.reduce((sum, cell) => sum + cell.widthHu, 0);
  const tableId = state.nextTableId();
  const cellsXml = cells.map((cell, index) =>
    `<hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${none}">` +
    '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' +
    cell.content +
    "</hp:subList>" +
    `<hp:cellAddr colAddr="${index}" rowAddr="0"/>` +
    '<hp:cellSpan colSpan="1" rowSpan="1"/>' +
    `<hp:cellSz width="${cell.widthHu}" height="${cell.heightHu ?? 1000}"/>` +
    `<hp:cellMargin left="${margin}" right="${margin}" top="0" bottom="0"/>` +
    "</hp:tc>").join("");
  return `<hp:tbl id="${tableId}" zOrder="${tableId}" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="1" colCnt="${cells.length}" cellSpacing="0" borderFillIDRef="${none}" noAdjust="0">` +
    `<hp:sz width="${totalWidth}" widthRelTo="ABSOLUTE" height="${cells[0]?.heightHu ?? 1000}" heightRelTo="ABSOLUTE" protect="0"/>` +
    '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
    '<hp:outMargin left="0" right="0" top="0" bottom="0"/>' +
    `<hp:inMargin left="${margin}" right="${margin}" top="0" bottom="0"/>` +
    `<hp:tr>${cellsXml}</hp:tr>` +
    "</hp:tbl>";
}

// 가로로 나눈 줄: 테두리 없는 표의 칸마다 요소를 넣는다.
function columnsXml(context, item, state) {
  const inner = nestedState(state);
  const cells = item.columns.map((column) => ({
    widthHu: hu(column.widthPt),
    content: column.items.map((child) => itemXml(context, child, inner)).join("") ||
      paragraphXml({ paraPr: 0, runs: runsXml(context, "", {}) }),
  }));
  const tbl = layoutTableXml(context, cells, state, { margin: 600 });
  const paraPr = paraPrId(context, { align: "left", lineSpacing: 1, spaceBeforePt: 0, spaceAfterPt: 4 });
  return paragraphXml({ paraPr, runs: `<hp:run charPrIDRef="0">${tbl}<hp:t/></hp:run>`, pageBreak: state.takePageBreak() });
}

function itemXml(context, item, state) {
  if (item.type === "paragraph") return textParagraphs(context, item, state);
  if (item.type === "divider") return dividerXml(context, item, state);
  if (item.type === "table") return tableXml(context, item, state);
  if (item.type === "image") return pictureXml(context, item, state);
  if (item.type === "columns") return columnsXml(context, item, state);
  return "";
}

// ---------- 머리말 · 꼬리말 · 쪽 번호 ----------

const AUTO_NUM_TYPE = { "roman-lower": "ROMAN_SMALL", "roman-upper": "ROMAN_CAPITAL" };

function autoNumXml(context, numType, config, style) {
  const id = charPrId(context, style);
  const format = AUTO_NUM_TYPE[config.pageNumber.format] ?? "DIGIT";
  return `<hp:run charPrIDRef="${id}"><hp:ctrl><hp:autoNum num="1" numType="${numType}">` +
    `<hp:autoNumFormat type="${numType === "PAGE" ? format : "DIGIT"}" userChar="" prefixChar="" suffixChar="" supscript="0"/>` +
    "</hp:autoNum></hp:ctrl><hp:t/></hp:run>";
}

// 칸 글자 → 실행 목록. {페이지}·{전체페이지}는 한글 쪽 번호 필드로 넣는다.
function slotRunsXml(context, text, model) {
  const config = model.headerFooter;
  const style = { size: config.fontSize, color: config.color };
  const format = config.pageNumber.format;
  const parts = String(text ?? "")
    .replaceAll("{날짜}", model.dateText)
    .replaceAll("{제목}", model.title)
    .split(/(\{페이지\}|\{전체페이지\})/);
  return parts.map((part) => {
    if (!part) return "";
    if (part === "{페이지}") {
      const page = autoNumXml(context, "PAGE", config, style);
      if (format === "dash") return runsXml(context, "- ", style) + page + runsXml(context, " -", style);
      if (format === "page-of") return page + runsXml(context, " / ", style) + autoNumXml(context, "TOTAL_PAGE", config, style);
      if (format === "korean") return page + runsXml(context, " 페이지", style);
      return page;
    }
    if (part === "{전체페이지}") return autoNumXml(context, "TOTAL_PAGE", config, style);
    return runsXml(context, part, style);
  }).join("") || runsXml(context, "", style);
}

// 왼쪽·가운데·오른쪽 칸을 테두리 없는 1×3 표로 놓는다.
function areaXml(context, model, kind, key, applyPageType, state) {
  const config = model.headerFooter;
  const PAGE = model.page;
  const slots = config[key];
  const third = Math.floor(hu(PAGE.contentWidthPt) / 3);
  const cells = ["left", "center", "right"].map((align, index) => ({
    widthHu: index === 2 ? hu(PAGE.contentWidthPt) - third * 2 : third,
    heightHu: hu(config.fontSize * 1.6),
    content: paragraphXml({ paraPr: paraPrId(context, { align, lineSpacing: 1.2 }), runs: slotRunsXml(context, slots[align], model) }),
  }));
  const divider = (kind === "header" ? config.headerDivider : config.footerDivider) &&
    Boolean(slots.left || slots.center || slots.right);
  // 한글은 문단 테두리를 '문단 아래 여백 + 2pt' 위치에 그린다. 그래서 구분선 문단은 여백 없이 두고,
  // 꼬리말에서는 구분선 다음에 오는 글자 줄(표) 문단에 위쪽 여백을 줘서 선과 글자가 겹치지 않게 한다.
  const tableParaPr = paraPrId(context, { align: "left", lineSpacing: 1, spaceBeforePt: divider && kind === "footer" ? 5 : 0 });
  let content = paragraphXml({ paraPr: tableParaPr, runs: `<hp:run charPrIDRef="0">${layoutTableXml(context, cells, state)}<hp:t/></hp:run>` });
  if (divider) {
    const line = paragraphXml({
      paraPr: paraPrId(context, { align: "left", lineSpacing: 1, spaceBeforePt: 0, spaceAfterPt: 0, bottomBorderColor: config.color }),
      runs: runsXml(context, "", { size: 1 }),
    });
    content = kind === "header" ? content + line : line + content;
  }
  const tag = kind === "header" ? "hp:header" : "hp:footer";
  // Word 와 같은 위치: 머리말은 위쪽 여백 바로 아래, 꼬리말은 아래쪽 여백 바로 위
  return `<hp:ctrl><${tag} id="${state.nextTableId()}" applyPageType="${applyPageType}">` +
    `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${kind === "header" ? "TOP" : "BOTTOM"}" linkListIDRef="0" linkListNextIDRef="0" textWidth="${hu(PAGE.contentWidthPt)}" textHeight="${hu(kind === "header" ? PAGE.marginTopPt - config.headerDistance : PAGE.marginBottomPt - config.footerDistance)}" hasTextRef="0" hasNumRef="0">` +
    content +
    `</hp:subList></${tag}></hp:ctrl>`;
}

function headerFooterCtrls(context, model, state) {
  const config = model.headerFooter;
  if (!config) return "";
  return ["header", "footer"].map((kind) => {
    const capital = kind === "header" ? "Header" : "Footer";
    if (config.differentOddEven) {
      return areaXml(context, model, kind, kind, "ODD", state) + areaXml(context, model, kind, `even${capital}`, "EVEN", state);
    }
    return areaXml(context, model, kind, kind, "BOTH", state);
  }).join("");
}

// 자유 배치 그림은 각 쪽 첫 문단에 붙여 두되 위치는 용지 기준으로 정한다.
function floatingXml(context, page, state) {
  const pics = (page.floating ?? []).map((item) => picElement(context, item, state, item)).filter(Boolean);
  if (!pics.length) return "";
  const paraPr = paraPrId(context, { align: "left", lineSpacing: 1, spaceBeforePt: 0, spaceAfterPt: 0 });
  return paragraphXml({ paraPr, runs: `<hp:run charPrIDRef="0">${pics.join("")}<hp:t/></hp:run>`, pageBreak: state.takePageBreak() });
}

function sectionXml(context, model) {
  let pendingPageBreak = false;
  let tableCounter = 0;
  const state = {
    takePageBreak() {
      const value = pendingPageBreak;
      pendingPageBreak = false;
      return value;
    },
    nextTableId() {
      tableCounter += 1;
      return tableCounter;
    },
  };

  // 첫 문단에는 구역(용지) 설정과 머리말·꼬리말이 들어간다.
  const first = paragraphXml({
    paraPr: 0,
    runs: `<hp:run charPrIDRef="0">${secPrXml(model)}<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>${headerFooterCtrls(context, model, state)}</hp:run><hp:run charPrIDRef="0"><hp:t/></hp:run>`,
  });

  const body = model.pages.map((page, pageIndex) => {
    if (pageIndex > 0) pendingPageBreak = true;
    const content = floatingXml(context, page, state) + page.items.map((item) => itemXml(context, item, state)).join("");
    // 빈 페이지도 쪽이 유지되도록 빈 문단을 넣는다.
    return content || paragraphXml({ paraPr: 0, runs: runsXml(context, "", {}), pageBreak: state.takePageBreak() });
  }).join("");

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
    `<hs:sec ${NS}>${first}${body}</hs:sec>`;
}

// ---------- 패키지 ----------

function contentHpf(title, binItems = []) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
    `<opf:package ${NS} version="" unique-identifier="" id="">` +
    `<opf:metadata><opf:title>${escapeXml(title)}</opf:title><opf:language>ko</opf:language>` +
    '<opf:meta name="creator" content="text">CODVILL cod-report</opf:meta></opf:metadata>' +
    "<opf:manifest>" +
    '<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>' +
    binItems.map((item) => `<opf:item id="${item.id}" href="${item.path}" media-type="${item.mediaType}" isEmbeded="1"/>`).join("") +
    '<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>' +
    '<opf:item id="settings" href="settings.xml" media-type="application/xml"/>' +
    "</opf:manifest>" +
    '<opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine>' +
    "</opf:package>";
}

const VERSION_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
  '<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.4" application="Hancom Office Hangul" appVersion="11, 0, 0, 0"/>';

const SETTINGS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
  '<ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"><ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/></ha:HWPApplicationSetting>';

const CONTAINER_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
  '<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf">' +
  '<ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles>' +
  "</ocf:container>";

const MANIFEST_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' +
  '<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>';

// 반환값: { 경로: 문자열 또는 Uint8Array(그림) }
export function buildHwpxFiles(report, options) {
  const model = buildExportDocument(report, options);
  const context = createContext();
  // 본문을 먼저 만들어야 사용된 글자·문단 모양·그림이 모두 등록된다.
  const section = sectionXml(context, model);
  const files = {
    mimetype: "application/hwp+zip",
    "version.xml": VERSION_XML,
    "settings.xml": SETTINGS_XML,
    "META-INF/container.xml": CONTAINER_XML,
    "META-INF/manifest.xml": MANIFEST_XML,
    "Contents/content.hpf": contentHpf(model.title, context.binItems),
    "Contents/header.xml": headerXml(context),
    "Contents/section0.xml": section,
  };
  for (const item of context.binItems) {
    files[item.path] = item.bytes;
  }
  return files;
}

async function buildZip(report, options) {
  const files = buildHwpxFiles(report, options);
  const zip = new JSZip();
  // mimetype 은 압축하지 않은 첫 항목이어야 한다.
  zip.file("mimetype", files.mimetype, { compression: "STORE" });
  for (const [path, content] of Object.entries(files)) {
    if (path !== "mimetype") zip.file(path, content);
  }
  return zip;
}

export async function exportReportToHwpx(report, options) {
  const zip = await buildZip(report, options);
  return zip.generateAsync({ type: "blob", mimeType: "application/hwp+zip", compression: "DEFLATE" });
}

export async function exportReportToHwpxBuffer(report, options) {
  const zip = await buildZip(report, options);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
