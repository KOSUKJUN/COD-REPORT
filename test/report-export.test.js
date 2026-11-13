import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildExportDocument, exportFileName } from "../src/report-export/document-model.js";
import { exportReportToDocxBuffer } from "../src/report-export/docx-export.js";
import { buildHwpxFiles, exportReportToHwpxBuffer } from "../src/report-export/hwpx-export.js";

const report = {
  type: "custom-00000000-0000-0000-0000-000000000000",
  layoutType: "daily",
  date: "2026-11-07",
  reportTitle: "보안 관제 <일일> 보고",
  pages: [
    {
      blocks: [
        { id: "a", type: "title", content: "제목 & 테스트", fontSize: 18, align: "center", textStyle: { color: "#c00000", bold: false } },
        { id: "b", type: "text", content: "첫 줄\n둘째 줄", fontSize: 12, textStyle: { highlight: "#ffff00", enclosed: true } },
        {
          id: "c",
          type: "table",
          heading: "표",
          fontSize: 9,
          gridVersion: 1,
          columns: ["", "", ""],
          rows: [
            { cells: ["병합", "", "C"], cellStyles: [{ backgroundColor: "#eeeeee" }, {}, { textAlign: "right" }] },
            { cells: ["", "", "▼3"], cellStyles: [{}, {}, {}] },
          ],
          merges: [{ row: 0, column: 0, rowspan: 2, colspan: 2 }],
        },
      ],
    },
    { blocks: [{ id: "d", type: "divider" }] },
  ],
};

test("builds a format-neutral document model from report blocks", () => {
  const model = buildExportDocument(report);
  assert.equal(model.title, "보안 관제 <일일> 보고");
  assert.equal(model.pages.length, 2);

  const [title, body] = model.pages[0].items;
  assert.equal(title.text, "제목 & 테스트");
  assert.equal(title.align, "center");
  assert.equal(title.style.bold, false, "explicit bold:false overrides the title default");
  assert.equal(title.style.color, "#c00000");
  assert.equal(body.style.border, true, "enclosed characters fall back to a character border");

  const table = model.pages[0].items.find((item) => item.type === "table");
  assert.equal(table.columnCount, 3);
  assert.deepEqual(table.rows[0].cells.map((cell) => cell && [cell.rowspan, cell.colspan]), [[2, 2], null, [1, 1]]);
  assert.deepEqual(table.rows[1].cells.map(Boolean), [false, false, true]);
  assert.equal(table.rows[0].cells[0].background, "#eeeeee");
  assert.equal(table.rows[0].cells[2].align, "right");
  assert.equal(table.rows[1].cells[2].style.bold, true, "trend cells are bold");
  assert.equal(model.pages[1].items[0].type, "divider");
});

test("creates safe export file names", () => {
  assert.equal(exportFileName({ reportTitle: 'a/b:c*?"<>|d' }, "pdf"), "a_b_c_d.pdf");
  assert.equal(exportFileName({ reportTitle: "  " , date: "2026-11-07" }, "docx"), "보고서-2026-11-07.docx");
});

test("writes a Word package with one section per report page and merged cells", async () => {
  const zip = await JSZip.loadAsync(await exportReportToDocxBuffer(report));
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /제목 &amp; 테스트/);
  assert.equal((xml.match(/<w:sectPr/g) ?? []).length, 2);
  assert.match(xml, /<w:gridSpan w:val="2"\/>/);
  assert.match(xml, /<w:vMerge w:val="restart"\/>/);
  assert.match(xml, /<w:highlight w:val="yellow"\/>/);
});

// 1×1 투명 PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const illustrated = {
  type: "custom-x",
  layoutType: "weekly",
  date: "2026-11-07",
  reportTitle: "그림",
  blocks: [
    { id: "img", type: "image", align: "right", content: "캡션", image: { src: PNG, widthPercent: 50, naturalWidth: 200, naturalHeight: 100 } },
    { id: "chart", type: "chart", chart: { title: "매출", height: 240 } },
    { id: "chart-missing", type: "chart", chart: { title: "그림 없음", height: 240 } },
    { id: "shape", type: "shape", content: "", shape: { kind: "rect", width: 120, height: 60 } },
  ],
};
const rasters = { chart: { src: PNG, width: 479, height: 240 }, shape: { src: PNG, width: 120, height: 60 } };

test("places images, charts and shapes as pictures in the export model", () => {
  const items = buildExportDocument(illustrated, { images: rasters }).pages[0].items;
  assert.deepEqual(items.map((item) => item.type), ["image", "paragraph", "image", "paragraph", "image"]);
  assert.equal(items[0].align, "right");
  assert.equal(items[0].widthPt, 479 / 2);
  assert.equal(items[0].heightPt, 479 / 4, "keeps the picture aspect ratio");
  assert.equal(items[1].text, "캡션");
  assert.equal(items[2].heightPt, 240);
  assert.match(items[3].text, /\[차트: 그림 없음\]/, "chart without a rendered picture gets a placeholder");
  assert.deepEqual([items[4].widthPt, items[4].heightPt], [120, 60]);
});

test("embeds pictures in Word and HWPX packages", async () => {
  const docx = await JSZip.loadAsync(await exportReportToDocxBuffer(illustrated, { images: rasters }));
  // 같은 그림은 Word 패키지 안에서 파일 하나로 합쳐지므로 문서 안의 그림 개수를 센다.
  assert.ok(Object.keys(docx.files).some((name) => name.startsWith("word/media/")));
  assert.equal(((await docx.file("word/document.xml").async("string")).match(/<wp:inline/g) ?? []).length, 3);

  const files = buildHwpxFiles(illustrated, { images: rasters });
  assert.deepEqual(Object.keys(files).filter((name) => name.startsWith("BinData/")), ["BinData/image1.png", "BinData/image2.png", "BinData/image3.png"]);
  assert.ok(files["BinData/image1.png"] instanceof Uint8Array);
  assert.equal((files["Contents/section0.xml"].match(/<hp:pic /g) ?? []).length, 3);
  assert.match(files["Contents/content.hpf"], /<opf:item id="image1" href="BinData\/image1.png" media-type="image\/png" isEmbeded="1"\/>/);
  for (const [, ref] of files["Contents/section0.xml"].matchAll(/binaryItemIDRef="(\w+)"/g)) {
    assert.match(files["Contents/content.hpf"], new RegExp(`id="${ref}"`));
  }
});

const laidOut = {
  type: "custom-x",
  layoutType: "weekly",
  date: "2026-11-07",
  reportTitle: "배치",
  pages: [
    {
      blocks: [
        { id: "a", type: "text", content: "왼쪽", layout: { width: 50 } },
        { id: "b", type: "text", content: "오른쪽", layout: { width: 50 } },
        { id: "c", type: "text", content: "전체" },
        { id: "f", type: "text", content: "떠 있음", layout: { mode: "free", x: 300, y: 400, w: 120, wrap: "behind" } },
      ],
    },
    { blocks: [{ id: "d", type: "text", content: "2쪽" }] },
  ],
  headerFooter: {
    header: { left: "{제목}", center: "", right: "{날짜}" },
    footer: { left: "", center: "{페이지} / {전체페이지}", right: "" },
    differentFirstPage: true,
    pageNumber: { format: "roman-upper", start: 3 },
  },
};

test("lays out split rows and free blocks in the export model", () => {
  const model = buildExportDocument(laidOut, { images: { f: { src: PNG, width: 120, height: 30 } } });
  const [columns, full] = model.pages[0].items;
  assert.equal(columns.type, "columns");
  assert.deepEqual(columns.columns.map((column) => column.widthPt), [479 / 2, 479 / 2]);
  assert.equal(columns.columns[1].items[0].text, "오른쪽");
  assert.equal(full.text, "전체");
  assert.deepEqual(model.pages[0].floating, [{ src: PNG, xPt: 300, yPt: 400, widthPt: 120, heightPt: 30, behind: true, z: 0 }]);
  assert.equal(model.headerFooter.pageNumber.start, 3);

  // 그림이 없는 자유 배치 요소는 본문 끝에 이어서 넣는다.
  const fallback = buildExportDocument(laidOut).pages[0];
  assert.equal(fallback.floating.length, 0);
  assert.equal(fallback.items.at(-1).text, "떠 있음");
});

test("writes Word headers/footers with page-number fields, split tables and floating pictures", async () => {
  const zip = await JSZip.loadAsync(await exportReportToDocxBuffer(laidOut, { images: { f: { src: PNG, width: 120, height: 30 } } }));
  const documentXml = await zip.file("word/document.xml").async("string");
  const headerFiles = Object.keys(zip.files).filter((name) => /word\/header\d+\.xml/.test(name));
  const footerFiles = Object.keys(zip.files).filter((name) => /word\/footer\d+\.xml/.test(name));
  assert.equal(headerFiles.length, 2, "default + first page header");
  assert.equal(footerFiles.length, 2);
  const footers = (await Promise.all(footerFiles.map((name) => zip.file(name).async("string")))).join("");
  assert.match(footers, /PAGE/);
  assert.match(footers, /NUMPAGES/);
  const headers = (await Promise.all(headerFiles.map((name) => zip.file(name).async("string")))).join("");
  assert.match(headers, /배치/);
  assert.match(headers, /2026년 11월 7일/);
  assert.match(documentXml, /<w:titlePg\/>/);
  assert.match(documentXml, /w:pgNumType[^>]*w:start="3"/);
  assert.match(documentXml, /w:fmt="upperRoman"/);
  assert.match(documentXml, /<wp:anchor[^>]*behindDoc="1"/);
});

test("writes HWPX headers/footers, split tables and floating pictures", () => {
  const files = buildHwpxFiles(laidOut, { images: { f: { src: PNG, width: 120, height: 30 } } });
  const section = files["Contents/section0.xml"];
  assert.match(section, /<hp:header [^>]*applyPageType="BOTH"/);
  assert.match(section, /<hp:footer [^>]*applyPageType="BOTH"/);
  assert.match(section, /numType="PAGE"><hp:autoNumFormat type="ROMAN_CAPITAL"/);
  assert.match(section, /numType="TOTAL_PAGE"/);
  assert.match(section, /<hp:startNum pageStartsOn="BOTH" page="3"/);
  assert.match(section, /hideFirstHeader="1" hideFirstFooter="1"/);
  assert.match(section, /<hp:tbl [^>]*rowCnt="1" colCnt="2"/, "split row becomes a 2-column table");
  assert.match(section, /textWrap="BEHIND_TEXT"[\s\S]*?<hp:pos treatAsChar="0"[^>]*vertRelTo="PAPER" horzRelTo="PAPER"[^>]*vertOffset="40000" horzOffset="30000"/);
});

test("writes a HWPX package Hangul can open", async () => {
  const files = buildHwpxFiles(report);
  assert.equal(files.mimetype, "application/hwp+zip");
  const section = files["Contents/section0.xml"];
  const header = files["Contents/header.xml"];

  assert.match(section, /제목 &amp; 테스트/);
  assert.match(section, /<hp:t>첫 줄<\/hp:t>/);
  assert.match(section, /<hp:t>둘째 줄<\/hp:t>/);
  assert.match(section, /<hp:cellSpan colSpan="2" rowSpan="2"\/>/);
  // 2×3 표에서 2×2 병합 → 실제 셀은 병합 셀 1개 + 오른쪽 열 2개
  assert.equal((section.match(/<hp:tc /g) ?? []).length, 3, "covered merged cells are omitted");
  assert.equal((section.match(/pageBreak="1"/g) ?? []).length, 1);
  assert.match(header, /shadeColor="#FFFF00"/);

  // 모든 charPr/paraPr/borderFill 참조가 header 에 정의되어 있어야 한다.
  const defined = (tag) => new Set([...header.matchAll(new RegExp(`<hh:${tag} id="(\\d+)"`, "g"))].map((m) => m[1]));
  const charIds = defined("charPr");
  const paraIds = defined("paraPr");
  const fillIds = defined("borderFill");
  for (const [, id] of section.matchAll(/charPrIDRef="(\d+)"/g)) assert.ok(charIds.has(id), `charPr ${id}`);
  for (const [, id] of section.matchAll(/paraPrIDRef="(\d+)"/g)) assert.ok(paraIds.has(id), `paraPr ${id}`);
  for (const [, id] of (section + header).matchAll(/borderFillIDRef="(\d+)"/g)) assert.ok(fillIds.has(id), `borderFill ${id}`);
  assert.match(header, new RegExp(`<hh:charProperties itemCnt="${charIds.size}">`));

  const zip = await JSZip.loadAsync(await exportReportToHwpxBuffer(report));
  assert.equal(Object.keys(zip.files)[0], "mimetype", "mimetype must be the first entry");
});

test("HWPX empty tables do not create invalid zero-row tables or lose page breaks", async () => {
  const emptyTable = { id: "empty", type: "table", gridVersion: 1, heading: "빈 표 제목", columns: ["A", "B"], rows: [] };
  const input = {
    type: "custom-x", layoutType: "daily", date: "2026-11-08",
    pages: [
      { blocks: [{ id: "text", type: "text", content: "첫 페이지" }] },
      { blocks: [emptyTable, { id: "filled", type: "table", gridVersion: 1, columns: ["A"], rows: [{ cells: ["내용"] }] }] },
    ],
  };
  const files = buildHwpxFiles(input);
  const xml = files["Contents/section0.xml"];
  assert.match(xml, /빈 표 제목/);
  assert.doesNotMatch(xml, /<hp:tbl\b[^>]*rowCnt="0"/);
  assert.match(xml, /<hp:tbl\b[^>]*rowCnt="1"/);
  assert.equal((xml.match(/pageBreak="1"/g) ?? []).length, 1);
  const withoutHeading = { ...input, pages: [input.pages[0], { blocks: [{ ...emptyTable, heading: "" }] }] };
  const emptyPage = buildHwpxFiles(withoutHeading)["Contents/section0.xml"];
  assert.equal((emptyPage.match(/pageBreak="1"/g) ?? []).length, 1);
  assert.doesNotMatch(emptyPage, /<hp:tbl\b[^>]*rowCnt="0"/);
});

test("daily Word and HWPX use the viewer's page margins and table width", async () => {
  const daily = { ...report, layoutType: "daily" };
  const model = buildExportDocument(daily);
  assert.equal(model.page.contentWidthPt, 519);
  assert.equal(model.pages[0].items.find((item) => item.type === "table").widthPt, 517);
  const zip = await JSZip.loadAsync(await exportReportToDocxBuffer(daily));
  const document = await zip.file("word/document.xml").async("string");
  assert.match(document, /<w:pgMar[^>]*w:top="840"[^>]*w:right="760"[^>]*w:bottom="680"[^>]*w:left="760"/);
  assert.match(document, /<w:tblW w:type="dxa" w:w="10340"/);
  assert.match(document, /<w:spacing[^>]*w:line="288"/);
  const section = buildHwpxFiles(daily)["Contents/section0.xml"];
  assert.match(section, /<hp:margin header="0" footer="0" gutter="0" left="3800" right="3800" top="4200" bottom="3400"/);
  assert.match(section, /<hp:sz width="51700"/);
  assert.match(section, /<hp:cellMargin left="300" right="300" top="200" bottom="200"/);
});

test("Word does not emit a zero-row table for an empty table", async () => {
  const input = {
    type: "custom-x", layoutType: "daily", date: "2026-11-08",
    blocks: [{ id: "empty", type: "table", gridVersion: 1, heading: "빈 표 제목", columns: ["A"], rows: [] }],
  };
  const zip = await JSZip.loadAsync(await exportReportToDocxBuffer(input));
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /빈 표 제목/);
  assert.doesNotMatch(xml, /<w:tbl>/);
});

test("split tables account for the viewer's column padding and element borders", () => {
  const table = { type: "table", gridVersion: 1, columns: ["A"], rows: [{ cells: ["내용"] }], layout: { width: 50 } };
  const input = {
    type: "custom-x", layoutType: "daily", date: "2026-11-08",
    blocks: [{ ...table, id: "left" }, { ...table, id: "right" }],
  };
  const columns = buildExportDocument(input).pages[0].items[0].columns;
  assert.deepEqual(columns.map((column) => column.items.find((item) => item.type === "table").widthPt), [245.5, 245.5]);
});
