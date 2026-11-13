import test from "node:test";
import assert from "node:assert/strict";
import { exportTemplatePages, importTemplatePages, aiPagesToTemplate } from "../src/template-transfer.js";
import { convertTemplateWithAi } from "../src/server/ai-template.js";
import { buildExportDocument } from "../src/report-export/document-model.js";

test("template transfer preserves pages and strips all connection data", () => {
  const pages = [{ id: "p1", blocks: [{ id: "a", type: "text", content: "SELECT is text", dataBinding: { query: "secret", rows: ["private"] }, layout: { mode: "free", x: 10 } }] },
    { id: "p2", blocks: [{ id: "b", type: "table", gridVersion: 1, columns: [""], rows: [{ cells: ["value"] }], summaryBinding: { query: "secret" } }] }];
  const exported = exportTemplatePages(pages);
  assert.equal(JSON.stringify(exported).includes("secret"), false);
  assert.equal(JSON.stringify(exported).includes("private"), false);
  assert.equal(pages[0].blocks[0].dataBinding.query, "secret");
  assert.equal(importTemplatePages(exported).length, 2);
  assert.equal(importTemplatePages(exported)[0].blocks[0].content, "SELECT is text");
});

test("rejects malformed or unsafe template files", () => {
  assert.throws(() => importTemplatePages({ format: "cod-report-template", version: 2, pages: [] }));
  assert.throws(() => importTemplatePages({ format: "cod-report-template", version: 1, pages: [{ blocks: [{ type: "image", image: { src: "https://example.com/image.png" } }] }] }));
  assert.throws(() => importTemplatePages({ format: "cod-report-template", version: 1, pages: [{ blocks: [{ type: "table", columns: [""], rows: [{ cells: [3] }] }] }] }));
});

const aiResult = { pages: [{ elements: [
  { type: "text", content: "보고서", x: 10, y: 20, width: 200, height: 30, fontSize: 14 },
  { type: "table", rows: [["A", "B"], ["1", "2"]], cellBackgrounds: [["#D9EAF7", null], [null, "#FFFFFF"]], merges: [{ row: 0, column: 0, rowspan: 1, colspan: 2 }], x: 10, y: 70, width: 300, height: 100 },
  { type: "shape", kind: "rect", x: 10, y: 180, width: 100, height: 30 },
  { type: "chart", category: "bar", categories: ["A"], series: [{ name: "값", values: [2] }], x: 10, y: 240, width: 200, height: 180 },
] }] };

test("AI results become editable positioned elements with bounds checks", () => {
  const blocks = aiPagesToTemplate(aiResult)[0].blocks;
  assert.deepEqual(blocks.map((block) => block.type), ["text", "table", "shape", "chart"]);
  assert.equal(blocks[1].merges[0].colspan, 2);
  assert.equal(blocks[3].chartData.series[0].values[0], 2);
  assert.throws(() => aiPagesToTemplate({ pages: [{ elements: [{ ...aiResult.pages[0].elements[0], x: 590 }] }] }));
  assert.throws(() => aiPagesToTemplate({ pages: [{ elements: [] }] }));
});

test("AI table shading is preserved per cell, including merged anchors and blank cells", () => {
  const table = {
    type: "table", x: 10, y: 20, width: 300, height: 100,
    rows: [["Header", ""], ["A", "1"], ["B"]],
    merges: [{ row: 0, column: 0, rowspan: 1, colspan: 2 }],
    cellBackgrounds: [["#D9EAF7", null], ["#f0f0f0", null], [null]],
  };
  const block = aiPagesToTemplate({ pages: [{ elements: [table] }] })[0].blocks[0];
  assert.deepEqual(block.rows.map((row) => row.cellStyles), [
    [{ backgroundColor: "#D9EAF7" }, {}],
    [{ backgroundColor: "#f0f0f0" }, {}],
    [{}, {}],
  ]);
  const restored = importTemplatePages(exportTemplatePages([{ blocks: [block] }]));
  assert.deepEqual(restored[0].blocks[0].rows, block.rows);
  const model = buildExportDocument({ pages: [{ blocks: [{ ...restored[0].blocks[0], layout: undefined }] }] });
  const exportedTable = model.pages[0].items.find((item) => item.type === "table");
  assert.equal(exportedTable.rows[0].cells[0].background, "#D9EAF7");
  assert.equal(exportedTable.rows[0].cells[1], null);
  assert.equal(exportedTable.rows[1].cells[0].background, "#f0f0f0");
  const unshaded = aiPagesToTemplate({ pages: [{ elements: [{ ...table, cellBackgrounds: undefined }] }] });
  assert.deepEqual(unshaded[0].blocks[0].rows[0].cellStyles, [{}, {}]);
  for (const cellBackgrounds of [[["red"]], [["#bad", null], [null, null], [null]], [["url(x)", null], [null, null], [null]]]) {
    assert.throws(() => aiPagesToTemplate({ pages: [{ elements: [{ ...table, cellBackgrounds }] }] }), /음영/);
  }
});

test("each provider receives the correct file request and returns validated pages", async () => {
  const data = Buffer.from("%PDF-test").toString("base64");
  for (const provider of ["openai", "anthropic", "gemini"]) {
    let captured;
    const fetchImpl = async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      const text = JSON.stringify(aiResult);
      const result = provider === "openai" ? { status: "completed", output: [{ content: [{ type: "output_text", text }] }] } :
        provider === "anthropic" ? { stop_reason: "end_turn", content: [{ type: "text", text }] } :
          { candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] };
      return { ok: true, json: async () => result };
    };
    const pages = await convertTemplateWithAi({ provider, model: "test-model", apiKey: "test-key", mimeType: "application/pdf", data, consent: true }, fetchImpl);
    assert.equal(pages[0].blocks.length, 4);
    assert.equal(pages[0].blocks[1].rows[0].cellStyles[0].backgroundColor, "#D9EAF7");
    assert.equal(captured.body.model ?? "test-model", "test-model");
    assert.match(captured.url, /^https:\/\//);
    assert.match(JSON.stringify(captured.body), /cellBackgrounds/);
  }
});

test("AI refuses malformed input and surfaces provider failures", async () => {
  const pdf = { apiKey: "test-key", mimeType: "application/pdf", data: Buffer.from("%PDF-test").toString("base64"), consent: true };
  await assert.rejects(() => convertTemplateWithAi({ ...pdf, consent: false }), /동의/);
  await assert.rejects(() => convertTemplateWithAi({ ...pdf, provider: "openai", model: "x", data: "bm90IHBkZg==" }), /파일 내용/);
  await assert.rejects(() => convertTemplateWithAi({ ...pdf, provider: "openai", model: "x" }, async () => ({ ok: false, status: 401 })), /HTTP 401/);
  await assert.rejects(() => convertTemplateWithAi({ ...pdf, provider: "gemini", model: "../other" }), /모델 이름/);
  await assert.rejects(() => convertTemplateWithAi({ ...pdf, provider: "anthropic", model: "x" }, async () => ({ ok: true, json: async () => ({ stop_reason: "max_tokens" }) })), /완료되지/);
});
