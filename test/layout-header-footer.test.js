import test from "node:test";
import assert from "node:assert/strict";
import { applySplit, getLayout, groupFlowRows, snapWidth } from "../src/layout.js";
import {
  applyGallery,
  clearArea,
  formatPageNumber,
  hasPageNumber,
  insertPageNumber,
  normalizeHeaderFooter,
  removePageNumbers,
  resolveSlots,
} from "../src/header-footer.js";

test("groups flow blocks into rows by width and skips free blocks", () => {
  const blocks = [
    { id: "a", layout: { width: 50 } },
    { id: "b", layout: { width: 50 } },
    { id: "free", layout: { mode: "free", x: 10, y: 10 } },
    { id: "c" },
    { id: "d", layout: { width: 66.67 } },
    { id: "e", layout: { width: 50 } },
  ];
  assert.deepEqual(groupFlowRows(blocks).map((row) => row.map((item) => item.block.id)), [["a", "b"], ["c"], ["d"], ["e"]]);
  assert.equal(getLayout({}).width, 100);
  assert.equal(getLayout({ layout: { width: 3 } }).width, 10);
  assert.equal(snapWidth(48.2), 50);
  assert.equal(snapWidth(41), 41);
});

test("applies split presets to the selected block and the following ones", () => {
  const blocks = [{ id: "a" }, { id: "free", layout: { mode: "free" } }, { id: "b" }, { id: "c" }];
  assert.equal(applySplit(blocks, 0, "2-left"), 2);
  assert.deepEqual(blocks.map((block) => block.layout?.width), [66.67, undefined, 33.33, undefined]);
  applySplit(blocks, 0, "1");
  assert.deepEqual([blocks[0].layout.width, blocks[2].layout.width], [100, 100]);
});

test("formats page numbers and resolves header/footer fields per page", () => {
  assert.equal(formatPageNumber(3, 9, "dash"), "- 3 -");
  assert.equal(formatPageNumber(3, 9, "page-of"), "3 / 9");
  assert.equal(formatPageNumber(14, 20, "roman-upper"), "XIV");
  assert.equal(formatPageNumber(4, 4, "roman-lower"), "iv");

  const config = normalizeHeaderFooter({
    header: { left: "{제목}", right: "{날짜}" },
    footer: { center: "{페이지} / {전체페이지}" },
    differentFirstPage: true,
    firstFooter: { center: "표지" },
    differentOddEven: true,
    evenFooter: { left: "{페이지}" },
    pageNumber: { start: 1, format: "arabic" },
  });
  const info = (pageIndex) => ({ pageIndex, pageCount: 3, title: "주간 보고", date: "2026년 11월 7일" });
  assert.deepEqual(resolveSlots(config, "footer", info(0)), { left: "", center: "표지", right: "" });
  assert.deepEqual(resolveSlots(config, "footer", info(1)), { left: "2", center: "", right: "" }, "page 2 is even");
  assert.deepEqual(resolveSlots(config, "footer", info(2)), { left: "", center: "3 / 3", right: "" });
  assert.deepEqual(resolveSlots(config, "header", info(2)), { left: "주간 보고", center: "", right: "2026년 11월 7일" });
});

test("inserts and removes page numbers like Word", () => {
  let config = insertPageNumber(null, "bottom", "right");
  assert.equal(config.footer.right, "{페이지}");
  assert.ok(hasPageNumber(config));
  config = insertPageNumber(config, "bottom", "right");
  assert.equal(config.footer.right, "{페이지}", "not inserted twice");
  config = applyGallery(config, "header", "title-date");
  config.footer.center = "Page {페이지} / {전체페이지}";
  config = removePageNumbers(config);
  assert.equal(config.footer.right, "");
  assert.equal(config.footer.center, "Page");
  assert.equal(hasPageNumber(config), false);
  assert.equal(config.header.left, "{제목}");
  config = clearArea(config, "header");
  assert.equal(config.header.left, "");
  // 시작 번호
  const started = normalizeHeaderFooter({ footer: { center: "{페이지}" }, pageNumber: { start: 5, format: "korean" } });
  assert.equal(resolveSlots(started, "footer", { pageIndex: 1, pageCount: 2 }).center, "6 페이지");
});

test("block height: clamps layout.h and stretches tables / fits images / pads text in the export model", async () => {
  const { clampHeight, heightTarget } = await import("../src/layout.js");
  const { buildExportDocument, estimateItemsHeight } = await import("../src/report-export/document-model.js");
  assert.equal(getLayout({}).h, null);
  assert.equal(clampHeight(5), 16);
  assert.equal(clampHeight("120.4"), 120);
  assert.equal(clampHeight(null), null);
  assert.equal(heightTarget({ type: "chart" }), "chart");
  assert.equal(heightTarget({ type: "divider" }), null);
  assert.equal(heightTarget({ type: "table" }), "layout");

  const table = {
    id: "t", type: "table", heading: "", columns: ["", ""], layout: { h: 200 }, merges: [],
    rows: [{ cells: ["a", "b"], cellStyles: [{}, {}] }, { cells: ["c", "d"], cellStyles: [{}, {}] }],
  };
  const text = { id: "x", type: "text", content: "짧은 글", fontSize: 10, layout: { h: 150 } };
  const image = { id: "i", type: "image", image: { src: "data:image/png;base64,AA==", widthPercent: 100, naturalWidth: 100, naturalHeight: 100 }, layout: { h: 60 } };
  const doc = buildExportDocument({ layoutType: "weekly", pages: [{ blocks: [table, text, image] }] });
  const items = doc.pages[0].items;
  const tableItem = items.find((item) => item.type === "table");
  assert.ok(tableItem.rowHeightPt > 80, `rows stretched: ${tableItem.rowHeightPt}`);
  const textItem = items.find((item) => item.type === "paragraph" && item.text === "짧은 글");
  assert.ok(Math.abs(estimateItemsHeight([textItem]) - 150) < 1, "text padded to its height");
  const imageItem = items.find((item) => item.type === "image");
  assert.ok(imageItem.heightPt <= 60 && Math.abs(imageItem.widthPt - imageItem.heightPt) < 0.01, "image fitted keeping ratio");
});
