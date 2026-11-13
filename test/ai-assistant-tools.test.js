import test from "node:test";
import assert from "node:assert/strict";
import { ASSISTANT_TOOLS, buildSystemPrompt, createToolExecutor } from "../src/assistant/editor-tools.js";
import { readNdjson, runAssistantTurn, trimHistory } from "../src/assistant/assistant-client.js";

let seq = 0;
// EditorView의 assistantContext와 같은 모양의 가짜 에디터
function fakeEditor() {
  const editor = {
    pages: [{ id: "p1", blocks: [{ id: "b-title", type: "title", content: "기존 제목", fontSize: 27, align: "left" }] }],
    current: 0, selected: "", pageSetup: null, headerFooter: null, templateId: "", unsaved: false,
    templates: [{ id: "custom-1", label: "주간 보고", group: "양식", layoutType: "weekly" }],
    schedules: [], mail: { enabled: false, recipients: [], users: ["u1"], subject: "", body: "" }, confirms: [], queries: [],
  };
  const ctx = {
    state: () => ({ templateId: editor.templateId, templateLabel: "새 양식", templateGroup: "양식", layoutType: "daily", unsaved: editor.unsaved,
      currentPage: editor.current, selectedId: editor.selected, pageSetup: editor.pageSetup, headerFooter: editor.headerFooter }),
    pages: () => editor.pages,
    pageBlocks: (index) => editor.pages[index].blocks,
    showPage: (index) => { editor.current = index; },
    addPage: () => { editor.pages.push({ id: `p${editor.pages.length + 1}`, blocks: [] }); editor.current = editor.pages.length - 1; },
    deletePage: (index) => { editor.pages.splice(index, 1); editor.current = 0; },
    createBlock: (type) => ({ id: `b${++seq}`, type, heading: "", content: "", fontSize: 14, align: "left",
      ...(type === "table" ? { gridVersion: 1, columns: ["", ""], rows: [{ cells: ["", ""] }], columnStyles: [{}, {}], merges: [] } : {}) }),
    selectBlock: (id) => { editor.selected = id; },
    blockLabel: (block) => block.content || block.heading || block.type,
    ensureBinding: (block) => {
      block.dataBinding ??= { enabled: false, query: "", parametersText: "[]", parameters: [], mappings: { fields: {}, columns: [] }, columns: [], rows: [] };
      return block.dataBinding;
    },
    setPageSetup: (value) => { editor.pageSetup = value; },
    setHeaderFooter: (value) => { editor.headerFooter = value; },
    templates: () => editor.templates,
    schedules: () => editor.schedules,
    openTemplate: async (id) => { editor.templateId = id; },
    createTemplate: async ({ label }) => { editor.templateId = "custom-new"; return { id: "custom-new", label }; },
    saveTemplate: async () => {},
    deleteTemplate: async (id) => { editor.templates = editor.templates.filter((item) => item.id !== id); },
    saveSchedule: async (id, schedule) => ({ templateId: id, ...schedule }),
    getMailSettings: async () => ({ ...editor.mail }),
    saveMailSettings: async (_id, settings) => { editor.mail = settings; return settings; },
    datasources: () => [{ id: "ds1", name: "영업 DB", type: "mysql" }],
    executeQuery: async (sql, parameters, datasourceId) => {
      editor.queries.push({ sql, parameters, datasourceId });
      return { columns: ["region", "amount"], rows: [{ region: "서울", amount: 10 }] };
    },
    setPreview: () => {},
    print: () => {},
    confirm: async (message) => { editor.confirms.push(message); return editor.confirmAnswer ?? true; },
  };
  return { editor, execute: createToolExecutor(ctx) };
}

const parse = (result) => JSON.parse(result.content);

test("tool definitions are valid function schemas with unique names", () => {
  const names = ASSISTANT_TOOLS.map((tool) => tool.function.name);
  assert.equal(new Set(names).size, names.length);
  for (const tool of ASSISTANT_TOOLS) {
    assert.equal(tool.type, "function");
    assert.match(tool.function.name, /^[a-z_]+$/);
    assert.equal(tool.function.parameters.type, "object");
    for (const key of tool.function.parameters.required ?? []) assert.ok(tool.function.parameters.properties[key], `${tool.function.name}.${key}`);
  }
  assert.ok(JSON.stringify(ASSISTANT_TOOLS).length < 40000);
});

test("add_block builds text, tables and charts and reports errors the model can fix", async () => {
  const { editor, execute } = fakeEditor();
  const title = parse(await execute("add_block", { type: "subheading", content: "1. 요약", bold: true, color: "#1f4e79", after_block_id: "b-title" }));
  assert.equal(editor.pages[0].blocks[1].id, title.block_id);
  assert.deepEqual(editor.pages[0].blocks[1].textStyle, { bold: true, color: "#1F4E79" });

  const table = parse(await execute("add_block", {
    type: "table", heading: "지역별 실적", rows: [["지역", "목표", "실적"], ["서울", "", ""], ["합계", "", ""]],
    merges: [{ row: 2, column: 0, rowspan: 1, colspan: 1 }, { row: 0, column: 5, rowspan: 1, colspan: 2 }], column_widths: [2, 1, 1], unit: "단위: 백만원",
  }));
  const tableBlock = editor.pages[0].blocks.find((block) => block.id === table.block_id);
  assert.equal(tableBlock.columns.length, 3);
  assert.equal(tableBlock.rows[0].isTitleRow, true);
  assert.equal(tableBlock.rows[0].cellStyles[0].backgroundColor, "#DCE6F2");
  assert.deepEqual(tableBlock.rows[1].cellStyles[0], {});
  assert.deepEqual(tableBlock.merges, []);
  assert.deepEqual(tableBlock.columnWidths, [50, 25, 25]);
  assert.equal(tableBlock.unit, "단위: 백만원");
  assert.equal(editor.selected, table.block_id);

  const chart = parse(await execute("add_block", { type: "chart", chart_type: "line", chart_variant: "markers", chart_title: "월별 추이", categories: ["1월", "2월"], series: [{ name: "매출", values: [1, 2] }], width_percent: 50 }));
  const chartBlock = editor.pages[0].blocks.find((block) => block.id === chart.block_id);
  assert.equal(chartBlock.chart.category, "line");
  assert.equal(chartBlock.chart.variant, "markers");
  assert.equal(chartBlock.layout.width, 50);

  const bad = await execute("add_block", { type: "chart", chart_type: "line", categories: ["1월", "2월"], series: [{ name: "매출", values: [1] }] });
  assert.equal(bad.ok, false);
  assert.match(parse(bad).error, /값 개수/);
  assert.match(parse(await execute("add_block", { type: "image" })).error, /그림/);
  assert.match(parse(await execute("add_block", { type: "text", color: "red" })).error, /#RRGGBB/);
  assert.match(parse(await execute("nope", {})).error, /알 수 없는 도구/);
});

test("update_block changes only given properties and leaves the block intact on errors", async () => {
  const { editor, execute } = fakeEditor();
  const { block_id: id } = parse(await execute("add_block", { type: "table", rows: [["a", "b"], ["1", "2"]], column_widths: [1, 3] }));
  const block = editor.pages[0].blocks.find((item) => item.id === id);
  assert.equal(parse(await execute("update_block", { block_id: id, rows: [["x", "y", "z"]], header_rows: 1 })).ok, true);
  assert.equal(block.columns.length, 3);
  assert.equal(block.columnWidths, undefined);
  const before = JSON.stringify(block);
  assert.equal((await execute("update_block", { block_id: id, heading: "제목", column_widths: [1] })).ok, false);
  assert.equal(JSON.stringify(block), before);
  assert.equal((await execute("set_table_cells", { block_id: id, cells: [{ row: 0, column: 2, text: "합계", background: "#ffeeaa", align: "center" }] })).ok, true);
  assert.equal(block.rows[0].cells[2], "합계");
  assert.deepEqual(block.rows[0].cellStyles[2], { backgroundColor: "#FFEEAA", textAlign: "center" });
  assert.match(parse(await execute("set_table_cells", { block_id: id, cells: [{ row: 9, column: 0, text: "x" }] })).error, /범위/);
  assert.match(parse(await execute("update_block", { block_id: "missing", content: "x" })).error, /찾을 수 없습니다/);
});

test("page, move, delete and output settings tools", async () => {
  const { editor, execute } = fakeEditor();
  assert.equal(parse(await execute("add_page", {})).page, 2);
  assert.equal(parse(await execute("move_block", { block_id: "b-title", page: 2 })).page, 2);
  assert.equal(editor.pages[0].blocks.length, 0);
  assert.equal(editor.pages[1].blocks[0].id, "b-title");
  assert.match(parse(await execute("move_block", { block_id: "b-title", before_block_id: "zzz" })).error, /기준 요소/);
  assert.equal(editor.pages[1].blocks[0].id, "b-title");
  assert.equal(parse(await execute("delete_page", { page: 1 })).page_count, 1);
  assert.match(parse(await execute("delete_page", { page: 1 })).error, /하나 이상/);

  assert.equal(parse(await execute("set_page_setup", { size: "A3", orientation: "landscape" })).ok, true);
  assert.deepEqual(editor.pageSetup, { size: "A3", orientation: "landscape" });
  await execute("set_header_footer", { header_preset: "title-date", page_number: { position: "bottom", align: "center" }, page_number_format: "page-of", footer_divider: true });
  assert.equal(editor.headerFooter.header.left, "{제목}");
  assert.equal(editor.headerFooter.footer.center, "{페이지}");
  assert.equal(editor.headerFooter.pageNumber.format, "page-of");
  assert.equal(editor.headerFooter.footerDivider, true);
  await execute("set_header_footer", { remove_page_numbers: true });
  assert.equal(editor.headerFooter.footer.center, "");
  assert.equal(parse(await execute("delete_block", { block_id: "b-title" })).ok, true);
  assert.equal(editor.pages[0].blocks.length, 0);
});

test("bind_data checks query columns and wires table rows or text content", async () => {
  const { editor, execute } = fakeEditor();
  const { block_id: id } = parse(await execute("add_block", { type: "table", rows: [["지역", "금액"]] }));
  const missing = parse(await execute("bind_data", { block_id: id, sql: "SELECT region, amount FROM sales", fields: ["region", "price"] }));
  assert.match(missing.error, /price/);
  const bound = parse(await execute("bind_data", { block_id: id, sql: "SELECT region, amount FROM sales WHERE d = ?", parameters: ["{{reportDate}}"], datasource_id: "ds1", fields: ["region", "amount"] }));
  assert.deepEqual(bound.columns, ["region", "amount"]);
  const table = editor.pages[0].blocks.find((block) => block.id === id);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[1].fields, ["region", "amount"]);
  assert.equal(table.rows[1].repeat, true);
  assert.equal(table.dataBinding.enabled, true);
  assert.equal(table.dataBinding.datasourceId, "ds1");
  assert.equal(table.dataBinding.parametersText, '["{{reportDate}}"]');
  assert.deepEqual(editor.queries.at(-1).parameters, ["{{reportDate}}"]);

  const text = parse(await execute("bind_data", { block_id: "b-title", sql: "SELECT region FROM x", content_field: "region" }));
  assert.equal(text.ok, true);
  assert.equal(editor.pages[0].blocks[0].dataBinding.mappings.fields.content, "region");
  await execute("unbind_data", { block_id: id });
  assert.equal(table.dataBinding.enabled, false);
  assert.equal(table.rows[1].fields, undefined);
});

test("template, schedule and mail tools guard unsaved work and confirm deletion", async () => {
  const { editor, execute } = fakeEditor();
  assert.match(parse(await execute("set_schedule", { enabled: true })).error, /저장되지 않았습니다/);
  assert.match(parse(await execute("save_template", {})).error, /이름/);
  assert.equal(parse(await execute("save_template", { name: "월간 영업 보고", period: "monthly" })).template_id, "custom-new");

  editor.unsaved = true;
  assert.match(parse(await execute("open_template", { template_id: "custom-1" })).error, /저장하지 않은 변경/);
  assert.equal(parse(await execute("open_template", { template_id: "custom-1", discard_unsaved: true })).ok, true);
  editor.unsaved = false;

  const schedule = parse(await execute("set_schedule", { frequency: "weekly", weekday: 1, time: "09:00" }));
  assert.deepEqual(schedule.schedule, { templateId: "custom-1", enabled: true, frequency: "weekly", time: "09:00", weekday: 1, dayOfMonth: 1 });
  assert.match(parse(await execute("set_schedule", { time: "25:00" })).error, /HH:MM/);

  const mail = parse(await execute("set_mail_settings", { enabled: true, recipients: [" a@example.com ", ""], subject: "주간 보고" }));
  assert.deepEqual(mail.settings, { enabled: true, recipients: ["a@example.com"], users: ["u1"], subject: "주간 보고", body: "" });

  editor.confirmAnswer = false;
  assert.equal(parse(await execute("delete_template", { template_id: "custom-1" })).cancelled, true);
  assert.equal(editor.templates.length, 1);
  editor.confirmAnswer = true;
  assert.equal(parse(await execute("delete_template", { template_id: "custom-1" })).ok, true);
  assert.equal(editor.templates.length, 0);
  assert.equal(editor.confirms.length, 2);
});

test("editor state summary and system prompt include block ids", async () => {
  const { execute } = fakeEditor();
  await execute("add_block", { type: "table", rows: [["항목", "값"]] });
  const state = execute.editorState();
  assert.equal(state.pages[0].blocks[0].id, "b-title");
  assert.equal(state.pages[0].blocks[1].size, "1x2");
  const prompt = buildSystemPrompt({ state, userName: "홍길동", today: "2026-11-09 (월)" });
  assert.match(prompt, /b-title/);
  assert.match(prompt, /Korean/);
});

test("assistant turn loop executes tool calls and stops when the model answers", async () => {
  const replies = [
    [{ message: { content: "", tool_calls: [{ function: { name: "add_page", arguments: {} } }, { function: { name: "show_page", arguments: '{"page":1}' } }] }, done: true, done_reason: "stop" }],
    [{ message: { content: "페이지를 " } }, { message: { content: "추가했습니다." }, done: true, done_reason: "stop" }],
  ];
  const sent = [];
  const fetchImpl = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    const lines = replies.shift();
    return new Response(lines.map((line) => JSON.stringify(line)).join("\n"));
  };
  const executed = [];
  const events = [];
  const history = [{ role: "user", content: "페이지 추가해줘" }];
  const result = await runAssistantTurn({
    history, tools: ASSISTANT_TOOLS, systemPrompt: () => "SYSTEM", fetchImpl,
    execute: async (name, args) => { executed.push([name, args]); return { ok: true, content: '{"ok":true}' }; },
    onEvent: (event) => events.push(event.type),
  });
  assert.equal(result.content, "페이지를 추가했습니다.");
  assert.deepEqual(executed, [["add_page", {}], ["show_page", { page: 1 }]]);
  assert.equal(sent[0].messages[0].content, "SYSTEM");
  assert.deepEqual(sent[1].messages.slice(-2).map((item) => item.role), ["tool", "tool"]);
  assert.deepEqual(history.map((item) => item.role), ["user", "assistant", "tool", "tool", "assistant"]);
  assert.ok(events.includes("tool-end"));

  await assert.rejects(() => runAssistantTurn({
    history: [{ role: "user", content: "x" }], tools: [], systemPrompt: () => "S", execute: async () => ({}),
    fetchImpl: async () => new Response(JSON.stringify({ error: "모델 없음" }), { status: 400 }),
  }), /모델 없음/);
});

test("NDJSON reader handles split chunks and history trimming keeps the latest request", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"a":1}\n{"b":'));
      controller.enqueue(encoder.encode('2}\n{"c":3}'));
      controller.close();
    },
  });
  const values = [];
  for await (const item of readNdjson(stream)) values.push(item);
  assert.deepEqual(values, [{ a: 1 }, { b: 2 }, { c: 3 }]);

  const history = [
    { role: "user", content: "x".repeat(50) }, { role: "assistant", content: "y".repeat(50) },
    { role: "user", content: "z".repeat(10) }, { role: "assistant", content: "w" },
  ];
  assert.deepEqual(trimHistory(history, 40).map((item) => item.content[0]), ["z", "w"]);
  assert.equal(trimHistory(history, 1000).length, 4);
});

test("add_blocks inserts in order, is all-or-nothing, and repeated anchors keep call order", async () => {
  const { editor, execute } = fakeEditor();
  const failed = parse(await execute("add_blocks", { blocks: [{ type: "text", content: "a" }, { type: "chart", chart_type: "nope" }] }));
  assert.match(failed.error, /blocks\[1\]/);
  assert.equal(editor.pages[0].blocks.length, 1);

  const added = parse(await execute("add_blocks", { after_block_id: "b-title", blocks: [{ type: "subheading", content: "요약" }, { type: "text", content: "본문" }] }));
  assert.equal(added.block_ids.length, 2);
  assert.deepEqual(editor.pages[0].blocks.map((block) => block.content), ["기존 제목", "요약", "본문"]);

  // 같은 기준 뒤에 따로 두 번 넣어도 호출 순서가 유지된다.
  execute.beginTurn();
  await execute("add_block", { type: "text", content: "첫째", after_block_id: "b-title" });
  await execute("add_block", { type: "text", content: "둘째", after_block_id: "b-title" });
  assert.deepEqual(editor.pages[0].blocks.slice(0, 3).map((block) => block.content), ["기존 제목", "첫째", "둘째"]);
  // 새 요청에서는 다시 기준 바로 뒤에 넣는다.
  execute.beginTurn();
  await execute("add_block", { type: "text", content: "새 요청", after_block_id: "b-title" });
  assert.equal(editor.pages[0].blocks[1].content, "새 요청");
});

test("bind_data maps chart categories and series to query columns", async () => {
  const { editor, execute } = fakeEditor();
  const { block_id: id } = parse(await execute("add_block", { type: "chart", chart_type: "column", categories: ["a"], series: [{ name: "s", values: [1] }] }));
  assert.match(parse(await execute("bind_data", { block_id: id, sql: "SELECT region, amount FROM t" })).error, /series_fields/);
  assert.match(parse(await execute("bind_data", { block_id: id, sql: "SELECT region, amount FROM t", category_field: "area", series_fields: [{ field: "amount" }] })).error, /area/);
  assert.equal(parse(await execute("bind_data", { block_id: id, sql: "SELECT region, amount FROM t", category_field: "region", series_fields: [{ field: "amount", name: "매출" }] })).ok, true);
  const chart = editor.pages[0].blocks.find((block) => block.id === id);
  assert.deepEqual(chart.dataBinding.chartMapping, { categoryField: "region", series: [{ field: "amount", name: "매출" }] });
  assert.equal(chart.dataBinding.enabled, true);
});
