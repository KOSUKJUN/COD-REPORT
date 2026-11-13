import test from "node:test";
import assert from "node:assert/strict";
import {
  clampRowHeight,
  getColumnWidths,
  moveColumnBoundary,
  normalizeColumnWidths,
  resolvedColumnWidths,
} from "../src/table-size.js";
import { buildExportDocument } from "../src/report-export/document-model.js";
import { buildHwpxFiles } from "../src/report-export/hwpx-export.js";

test("column widths are ignored unless they match the column count", () => {
  assert.equal(getColumnWidths({ columns: ["", ""], columnWidths: [50] }), null);
  assert.equal(getColumnWidths({ columns: ["", ""] }), null);
  assert.deepEqual(getColumnWidths({ columns: ["", ""], columnWidths: [1, 3] }), [25, 75]);
  assert.deepEqual(resolvedColumnWidths({ columns: ["", "", "", ""] }), [25, 25, 25, 25]);
});

test("moving a boundary only trades width between the two neighbours", () => {
  const widths = moveColumnBoundary([25, 25, 50], 0, 10);
  assert.deepEqual(widths, [35, 15, 50]);
  const clamped = moveColumnBoundary([25, 25, 50], 1, -100);
  assert.deepEqual(clamped, [25, 3, 72]);
  assert.deepEqual(normalizeColumnWidths([50, 50, 50]), [33.33, 33.33, 33.33]);
  assert.equal(clampRowHeight(2), 14);
  assert.equal(clampRowHeight(10000), 400);
});

const report = {
  type: "custom-00000000-0000-0000-0000-000000000000",
  layoutType: "daily",
  date: "2026-11-09",
  pages: [{
    blocks: [{
      id: "t",
      type: "table",
      gridVersion: 1,
      columns: ["", ""],
      columnWidths: [30, 70],
      rows: [{ cells: ["a", "b"], height: 40 }, { cells: ["c", "d"] }],
      merges: [],
    }],
  }],
};

test("export model carries column percents and row heights", async () => {
  const table = buildExportDocument(report).pages[0].items.find((item) => item.type === "table");
  assert.deepEqual(table.columnPercents, [30, 70]);
  assert.equal(table.rows[0].heightPt, 40);
  assert.equal(table.rows[1].heightPt, undefined);

  const files = await buildHwpxFiles(report);
  const section = Object.entries(files).find(([name]) => name.includes("section0"))?.[1];
  const xml = typeof section === "string" ? section : new TextDecoder().decode(section);
  const widths = [...xml.matchAll(/<hp:cellSz width="(\d+)" height="(\d+)"/g)].map((match) => [Number(match[1]), Number(match[2])]);
  assert.ok(widths[1][0] > widths[0][0] * 2, "second column is wider");
  assert.ok(widths[0][1] > widths[2][1], "first row is taller");
});
