import test from "node:test";
import { fillSummaryTemplate, getTableSummary, materializeReport } from "../src/data-binding.js";

test("materializes bound values so a report can be edited without changing what it shows", () => {
  const sharedStyle = { bold: true };
  const report = {
    date: "2026-11-07",
    pages: [{
      blocks: [
        {
          id: "t", type: "title", content: "직접 입력",
          dataBinding: { enabled: true, mappings: { fields: { content: "name" } }, rows: [{ name: "DB 제목" }] },
        },
        {
          id: "tb", type: "table", columns: ["", ""], summary: "",
          rows: [
            { isTitleRow: true, cells: ["기관", "건수"], cellStyles: [{}, {}] },
            { cells: ["", ""], cellStyles: [sharedStyle, {}] },
          ],
          merges: [],
          dataBinding: { enabled: true, repeatRows: true, mappings: { fields: {}, columns: ["org", "cnt"] }, rows: [{ org: "A", cnt: 1 }, { org: "B", cnt: 2 }] },
          summaryBinding: { enabled: true, template: "합계 {total}건", rows: [{ total: 3 }] },
        },
      ],
    }],
  };
  const before = getTableRows(report.pages[0].blocks[1]).map((row) => row.cells);
  const result = materializeReport(report);
  const [title, table] = result.pages[0].blocks;

  assertStrict.equal(title.content, "DB 제목");
  assertStrict.equal(title.dataBinding.enabled, false);
  assertStrict.equal(title.valuesMaterialized, true);
  assertStrict.deepEqual(table.rows.map((row) => row.cells), before);
  assertStrict.deepEqual(table.rows.map((row) => row.cells), [["기관", "건수"], ["A", 1].map(String), ["B", 2].map(String)]);
  assertStrict.equal(table.summary, "합계 3건");
  assertStrict.equal(table.summaryBinding.enabled, false);
  assertStrict.equal(table.dataBinding.query, undefined, "binding settings are kept, only disabled");
  // 반복 행의 셀 서식은 서로 다른 객체여야 한 행의 서식만 바꿀 수 있다.
  table.rows[1].cellStyles[0].bold = false;
  assertStrict.equal(table.rows[2].cellStyles[0].bold, true);
  assertStrict.equal(report.pages[0].blocks[0].content, "직접 입력", "the original report is not modified");
});

test("materializes reports held in Vue reactive proxies", async () => {
  const { reactive } = await import("vue");
  const proxy = reactive({ date: "2026-11-07", blocks: [{ id: "a", type: "text", content: "x" }] });
  const result = materializeReport(proxy);
  assertStrict.equal(result.blocks[0].content, "x");
  result.blocks[0].content = "y";
  assertStrict.equal(proxy.blocks[0].content, "x");
});
import assertStrict from "node:assert/strict";

test("fills table summaries from a separate summary query", () => {
  const block = {
    type: "table",
    summary: "(1) 회신 대기: 0건",
    summaryBinding: {
      enabled: true,
      template: "(1) 회신 대기: {wait_cnt}건\n(2) 회신 종결: {done_cnt}건",
      rows: [{ wait_cnt: 3, done_cnt: 12 }],
    },
    dataBinding: { enabled: true, mappings: { fields: { summary: "ignored" } }, rows: [{ ignored: "x" }] },
  };
  assertStrict.equal(getTableSummary(block), "(1) 회신 대기: 3건\n(2) 회신 종결: 12건");

  block.summaryBinding.rows = [];
  assertStrict.equal(getTableSummary(block), "(1) 회신 대기: -건\n(2) 회신 종결: -건");
  assertStrict.equal(getTableSummary(block, { showFieldNames: true }), block.summaryBinding.template);

  assertStrict.equal(fillSummaryTemplate("{ a } / {missing}", { a: null }), " / -");
  // 요약 바인딩이 꺼져 있으면 예전 방식(표 쿼리의 필드 연결)을 그대로 따른다.
  block.summaryBinding.enabled = false;
  assertStrict.equal(getTableSummary(block), "x");
});
import assert from "node:assert/strict";
import {
  getBoundFieldValue,
  getTableRows,
} from "../src/data-binding.js";
import { normalizeTableBlock } from "../src/reports-api.js";

test("keeps directly entered values when a field is not mapped", () => {
  const block = {
    content: "직접 입력",
    dataBinding: {
      enabled: true,
      mappings: { fields: { content: "" } },
      rows: [{ content: "DB 값" }],
    },
  };
  assert.equal(getBoundFieldValue(block, "content", block.content), "직접 입력");
});

test("uses a mapped field from the query result", () => {
  const block = {
    content: "직접 입력",
    dataBinding: {
      enabled: true,
      mappings: { fields: { content: "report_title" } },
      rows: [{ report_title: "DB 보고서 제목" }],
    },
  };
  assert.equal(getBoundFieldValue(block, "content", block.content), "DB 보고서 제목");
});

test("repeats table rows and maps each configured query column", () => {
  const block = {
    columns: ["", ""],
    rows: [{ cells: ["수동 값", ""] }],
    dataBinding: {
      enabled: true,
      repeatRows: true,
      mappings: { columns: ["name", "count"] },
      rows: [
        { name: "첫째", count: 2 },
        { name: "둘째", count: 4 },
      ],
    },
  };
  assert.deepEqual(getTableRows(block).map((row) => row.cells), [
    ["첫째", "2"],
    ["둘째", "4"],
  ]);
});

test("keeps title rows editable and inserts each bound result after them", () => {
  const block = {
    columns: ["", ""],
    rows: [
      { isTitleRow: true, cells: ["기관명", "상태"] },
      { cells: ["직접 입력", ""] },
    ],
    dataBinding: {
      enabled: true,
      repeatRows: true,
      mappings: { columns: ["institution_name", "response_status"] },
      rows: [
        { institution_name: "가천대길병원", response_status: "완료" },
        { institution_name: "인천의료원", response_status: "대기" },
      ],
    },
  };

  assert.deepEqual(getTableRows(block).map((row) => row.cells), [
    ["기관명", "상태"],
    ["가천대길병원", "완료"],
    ["인천의료원", "대기"],
  ]);
});

test("shows mapped field names in the editor without exposing bound values", () => {
  const block = {
    columns: ["", ""],
    rows: [
      { isTitleRow: true, cells: ["기관명", "상태"] },
      { cells: ["직접 입력", ""] },
    ],
    dataBinding: {
      enabled: true,
      repeatRows: true,
      mappings: { columns: ["institution_name", "response_status"] },
      rows: [
        { institution_name: "비공개 기관명", response_status: "비공개 상태" },
        { institution_name: "다른 기관", response_status: "다른 상태" },
      ],
    },
  };

  assert.deepEqual(
    getTableRows(block, { showMappedFieldNames: true }).map((row) => row.cells),
    [
      ["기관명", "상태"],
      ["institution_name", "response_status"],
    ],
  );
});

test("maps query fields into the existing row count when repetition is off", () => {
  const block = {
    columns: ["", ""],
    rows: [
      { cells: ["수동1", ""] },
      { cells: ["수동2", ""] },
    ],
    dataBinding: {
      enabled: true,
      repeatRows: false,
      mappings: { columns: ["name", "count"] },
      rows: [{ name: "DB1", count: 2 }],
    },
  };
  assert.deepEqual(getTableRows(block).map((row) => row.cells), [
    ["DB1", "2"],
    ["수동2", ""],
  ]);
});

test("keeps title rows out of fixed-row DB mapping", () => {
  const block = {
    columns: ["", ""],
    rows: [
      { isTitleRow: true, cells: ["업무", "담당"] },
      { cells: ["기존 업무", "기존 담당"] },
    ],
    dataBinding: {
      enabled: true,
      repeatRows: false,
      mappings: { columns: ["task_title", "owner_name"] },
      rows: [{ task_title: "DB 업무", owner_name: "DB 담당" }],
    },
  };

  assert.deepEqual(getTableRows(block).map((row) => row.cells), [
    ["업무", "담당"],
    ["DB 업무", "DB 담당"],
  ]);
});

test("converts existing table headers and labels into ordinary cells", () => {
  const table = normalizeTableBlock({
    type: "table",
    columns: ["이름", "수량"],
    rows: [{ label: "합계", cells: ["항목", "3"] }],
  });
  assert.deepEqual(table.rows.map((row) => row.cells), [
    ["구분", "이름", "수량"],
    ["합계", "항목", "3"],
  ]);
  assert.equal(table.rows.every((row) => row.cells.length === table.columns.length), true);
});
