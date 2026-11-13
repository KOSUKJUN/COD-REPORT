import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  describePageSetup,
  getPageDimensions,
  isDefaultPageSetup,
  normalizePageSetup,
  xlsxPaperSize,
} from "../src/page-setup.js";
import { buildExportDocument } from "../src/report-export/document-model.js";
import { exportReportToDocxBuffer } from "../src/report-export/docx-export.js";
import { buildHwpxFiles } from "../src/report-export/hwpx-export.js";
import { buildXlsxFiles } from "../src/report-export/xlsx-export.js";

test("A4 portrait is the default and matches the 595 × 842 canvas", () => {
  const page = getPageDimensions(null);
  assert.equal(page.widthPt, 595);
  assert.equal(page.heightPt, 842);
  assert.equal(page.contentWidthPt, 595 - 58 * 2);
  assert.equal(page.landscape, false);
  assert.equal(isDefaultPageSetup(undefined), true);
  assert.equal(describePageSetup(null), "A4 · 세로 (210 × 297mm)");
});

test("orientation swaps width and height", () => {
  const page = getPageDimensions({ size: "A4", orientation: "landscape" });
  assert.equal(page.widthPt, 842);
  assert.equal(page.heightPt, 595);
  assert.equal(page.landscape, true);
  assert.equal(describePageSetup({ size: "Letter", orientation: "landscape" }), "Letter · 가로 (279.4 × 215.9mm)");
});

test("unknown sizes fall back to A4 and custom sizes are clamped and stored portrait-first", () => {
  assert.deepEqual(normalizePageSetup({ size: "nope" }), { size: "A4", orientation: "portrait" });
  const custom = normalizePageSetup({ size: "custom", orientation: "landscape", widthMm: 900, heightMm: 50 });
  assert.deepEqual(custom, { size: "custom", orientation: "landscape", widthMm: 100, heightMm: 600 });
  const page = getPageDimensions(custom);
  assert.ok(page.widthPt > page.heightPt, "landscape custom paper is wider than tall");
});

test("Excel paper numbers follow SpreadsheetML", () => {
  assert.equal(xlsxPaperSize(null), 9);
  assert.equal(xlsxPaperSize({ size: "Letter" }), 1);
  assert.equal(xlsxPaperSize({ size: "custom", widthMm: 200, heightMm: 300 }), 0);
});

const landscapeReport = {
  type: "custom-x",
  layoutType: "weekly",
  date: "2026-11-07",
  reportTitle: "가로 보고서",
  pageSetup: { size: "A4", orientation: "landscape" },
  blocks: [{ id: "a", type: "text", content: "본문" }],
};

test("export model uses the report's paper size for the content width", () => {
  const model = buildExportDocument(landscapeReport);
  assert.equal(model.page.widthPt, 842);
  assert.equal(model.page.contentWidthPt, 842 - 58 * 2);
  assert.equal(model.pageSetup.orientation, "landscape");
});

test("Word, Hangul and Excel files carry the paper size and orientation", async () => {
  const docx = await JSZip.loadAsync(await exportReportToDocxBuffer(landscapeReport));
  const documentXml = await docx.file("word/document.xml").async("string");
  assert.match(documentXml, /<w:pgSz w:w="16840" w:h="11900" w:orient="landscape"\/>/);

  const section = buildHwpxFiles(landscapeReport)["Contents/section0.xml"];
  assert.match(section, /<hp:pagePr landscape="NARROWLY" width="59500" height="84200"/);
  const portrait = buildHwpxFiles({ ...landscapeReport, pageSetup: null })["Contents/section0.xml"];
  assert.match(portrait, /<hp:pagePr landscape="WIDELY" width="59500" height="84200"/);

  const sheet = buildXlsxFiles({ ...landscapeReport, pageSetup: { size: "B5", orientation: "landscape" } })["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<pageSetup paperSize="13" orientation="landscape"/);
});
test("daily reports use the same margins as the viewer", () => {
  const page = getPageDimensions(null, "daily");
  assert.equal(page.marginTopPt, 42);
  assert.equal(page.marginBottomPt, 34);
  assert.equal(page.marginSidePt, 38);
  assert.equal(page.contentWidthPt, page.widthPt - 76);
});
