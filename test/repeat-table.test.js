import test from "node:test";
import assert from "node:assert/strict";
import {
  expandRepeatedBlocks,
  getTableMerges,
  getTableRows,
  getTableSummary,
  materializeReport,
} from "../src/data-binding.js";
import { buildExportDocument } from "../src/report-export/document-model.js";

const records = [
  { title: "안녕", content: 3, note: 2 },
  { title: "히히", content: 3, note: 2 },
  { title: "안녕2", content: 44, note: 1 },
];

// 제목행 + 필드를 끌어다 놓은 데이터 행 + 합계 행
function fieldTable({ repeat = false, repeatTable = false, rows = records } = {}) {
  return {
    id: "t1",
    type: "table",
    heading: "현황",
    summary: "끝",
    columns: ["", "", "", ""],
    rows: [
      { isTitleRow: true, cells: ["제목", "내용", "비고", "비고2"] },
      { cells: ["", "", "", "고정"], fields: ["title", "content", "note", ""], repeat },
      { cells: ["합계", "", "", ""] },
    ],
    merges: [{ row: 2, column: 1, rowspan: 1, colspan: 3 }],
    dataBinding: { enabled: true, repeatTable, mappings: { fields: {}, columns: [] }, rows },
  };
}

const cells = (block) => getTableRows(block).map((row) => row.cells.join("|"));

test("dropped field cells take the first record when the row does not repeat", () => {
  assert.deepEqual(cells(fieldTable()), ["제목|내용|비고|비고2", "안녕|3|2|고정", "합계|||"]);
  assert.deepEqual(
    getTableRows(fieldTable(), { showMappedFieldNames: true })[1].cells,
    ["{title}", "{content}", "{note}", "고정"],
  );
});

test("a repeat row is copied once per record and rows below it move down", () => {
  const block = fieldTable({ repeat: true });
  assert.deepEqual(cells(block), [
    "제목|내용|비고|비고2",
    "안녕|3|2|고정",
    "히히|3|2|고정",
    "안녕2|44|1|고정",
    "합계|||",
  ]);
  assert.deepEqual(getTableMerges(block), [{ row: 4, column: 1, rowspan: 1, colspan: 3 }]);
  assert.deepEqual(cells(fieldTable({ repeat: true, rows: [] })), ["제목|내용|비고|비고2", "합계|||"]);
});

test("table repeat makes one table per record and ignores the row repeat", () => {
  const copies = expandRepeatedBlocks([fieldTable({ repeat: true, repeatTable: true })]);
  assert.equal(copies.length, 3);
  assert.deepEqual(cells(copies[0]), ["제목|내용|비고|비고2", "안녕|3|2|고정", "합계|||"]);
  assert.deepEqual(cells(copies[2]), ["제목|내용|비고|비고2", "안녕2|44|1|고정", "합계|||"]);
  assert.deepEqual(copies.map((copy) => copy.id), ["t1", "t1~2", "t1~3"]);
  assert.deepEqual(copies.map((copy) => copy.heading), ["현황", "", ""]);
  assert.deepEqual(copies.map((copy) => getTableSummary(copy)), ["", "", "끝"]);
  assert.equal(expandRepeatedBlocks([fieldTable({ repeatTable: true, rows: [] })]).length, 1);
});

test("a heading mapped to a field shows each record's value", () => {
  const block = fieldTable({ repeatTable: true });
  block.dataBinding.mappings.fields.heading = "title";
  const fixed = materializeReport({ type: "custom-x", date: "2026-11-08", pages: [{ id: "p", blocks: [block] }] });
  assert.deepEqual(fixed.pages[0].blocks.map((item) => item.heading), ["안녕", "히히", "안녕2"]);
});

test("materialized reports and exports keep the repeated rows, merges and tables", () => {
  const report = { type: "custom-x", date: "2026-11-08", pages: [{ id: "p", blocks: [fieldTable({ repeat: true })] }] };
  const fixed = materializeReport(report).pages[0].blocks[0];
  assert.equal(fixed.rows.length, 5);
  assert.ok(fixed.rows.every((row) => !row.fields && !row.repeat));
  assert.deepEqual(fixed.merges, [{ row: 4, column: 1, rowspan: 1, colspan: 3 }]);
  assert.deepEqual(cells(fixed), cells(fieldTable({ repeat: true })), "fixed values look the same");

  const tables = (blocks) => buildExportDocument({ ...report, pages: [{ id: "p", blocks }] }).pages[0].items.filter((item) => item.type === "table");
  assert.equal(tables([fieldTable({ repeat: true })])[0].rows.length, 5);
  assert.equal(tables([fieldTable({ repeatTable: true })]).length, 3);
});

test("old column mappings still render the way they did", () => {
  const legacy = {
    type: "table",
    columns: ["", ""],
    rows: [{ isTitleRow: true, cells: ["이름", "값"] }, { cells: ["", ""] }],
    dataBinding: { enabled: true, repeatRows: true, mappings: { fields: {}, columns: ["title", "content"] }, rows: records },
  };
  assert.deepEqual(cells(legacy), ["이름|값", "안녕|3", "히히|3", "안녕2|44"]);
});
