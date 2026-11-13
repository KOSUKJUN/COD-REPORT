import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { convertTemplateWithOllama, getOllamaBaseUrl, listOllamaModels, ollamaElementsToBlocks } from "../src/server/ai-ollama.js";
import { createAiRouter } from "../src/server/ai-routes.js";
import { getModelDescription } from "../src/ai-model-description.js";
import { targetScale } from "../src/ai-page-images.js";

const BASE = "http://192.0.2.10:11434";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]).toString("base64");
const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

test("Ollama base URL accepts only plain http(s) origins", () => {
  assert.equal(getOllamaBaseUrl("http://192.168.0.106:11434/"), "http://192.168.0.106:11434");
  assert.equal(getOllamaBaseUrl(" https://ai.example.local/ollama// "), "https://ai.example.local/ollama");
  for (const value of [undefined, "", "ftp://host", "http://user:pass@host", "http://host/?a=1", "not a url"]) {
    assert.equal(getOllamaBaseUrl(value), null);
  }
});

test("Ollama models keep local vision models and list Qwen 3.5+ first", async () => {
  let requested;
  const models = await listOllamaModels({ baseUrl: BASE }, async (url) => {
    requested = url;
    return json({ models: [
      { name: "gemma4:31b", modified_at: "2026-09-01", capabilities: ["completion", "vision"], details: { family: "gemma4" } },
      { name: "qwen3:32b", capabilities: ["completion"], details: { family: "qwen3" } },
      { name: "qwen2.5vl:7b", modified_at: "2026-01-01", capabilities: ["completion", "vision"], details: { family: "qwen25vl" } },
      { name: "qwen3.8:27b", modified_at: "2026-08-25", capabilities: ["completion", "vision"],
        details: { family: "qwen35", parameter_size: "27.3B", quantization_level: "Q4_K_M", context_length: 262144 } },
      { name: "gemini-3-pro-preview:latest", remote_host: "https://ollama.com:443", capabilities: ["vision"] },
      { name: "bad name", capabilities: ["vision"] },
    ] });
  });
  assert.equal(requested, `${BASE}/api/tags`);
  assert.deepEqual(models.map((item) => item.id), ["qwen3.8:27b", "qwen2.5vl:7b", "gemma4:31b"]);
  assert.match(models[0].description, /qwen35 · 27\.3B · Q4_K_M · 최대 문맥 262,144/);
  await assert.rejects(() => listOllamaModels({ baseUrl: BASE }, async () => json({ models: [{ name: "qwen3:8b", capabilities: ["completion"] }] })), /비전 모델이 없습니다/);
  await assert.rejects(() => listOllamaModels({ baseUrl: BASE }, async () => { throw new TypeError("fetch failed"); }), /192\.0\.2\.10:11434.*연결하지 못했습니다/);
  await assert.rejects(() => listOllamaModels({ baseUrl: null }), /사내 AI에서 서버 주소/);
});

test("Ollama conversion sends a schema-constrained image request and rescales 0-1000 coordinates", async () => {
  let sent;
  const content = JSON.stringify({ elements: [
    { type: "title", x: 100, y: 50, width: 500, height: 40, fontSize: 22, align: "left", content: "월간 보고서", bold: true, italic: false, color: "#000000" },
    { type: "table", x: 100, y: 200, width: 950, height: 100, fontSize: 10, rows: [["구분", "값"], ["합계", 3]],
      merges: [{ row: 0, column: 0, rowspan: 1, colspan: 1 }], cellBackgrounds: [["#D9EAF7", "#FFFFFF"], [null, null]] },
    { type: "shape", x: 100, y: 990, width: 800, height: 0, kind: "line", fill: "none", stroke: "#000000" },
    { type: "chart", x: 0, y: 0, width: 100, height: 100, category: "pie", title: "", categories: ["a"], series: [{ name: "s", values: [1, 2] }] },
  ] });
  const result = await convertTemplateWithOllama({ baseUrl: BASE, model: "qwen3.8:27b", mimeType: "image/png", data: png, consent: true },
    async (url, options) => {
      sent = { url, body: JSON.parse(options.body) };
      return json({ done_reason: "stop", message: { content } });
    });
  assert.equal(sent.url, `${BASE}/api/chat`);
  assert.equal(sent.body.stream, false);
  assert.equal(sent.body.think, false);
  assert.equal(sent.body.options.temperature, 0);
  assert.ok(sent.body.options.num_ctx >= 32768);
  assert.deepEqual(sent.body.messages[0].images, [png]);
  assert.match(sent.body.messages[0].content, /0-1000/);
  assert.ok(sent.body.format.properties.elements.items.anyOf.length === 4);

  const [title, table, line] = result.pages[0].blocks;
  assert.equal(result.skipped, 1);
  assert.deepEqual([title.layout.x, title.layout.y, title.layout.w, title.layout.h], [59.5, 42.1, 297.5, 33.7]);
  assert.equal(title.fontSize, 22);
  assert.equal(title.textStyle.bold, true);
  assert.equal(table.layout.x + table.layout.w <= 595, true);
  assert.deepEqual(table.rows[1].cells, ["합계", "3"]);
  assert.deepEqual(table.rows[0].cellStyles, [{ backgroundColor: "#D9EAF7" }, {}]);
  assert.deepEqual(table.merges, []);
  assert.equal(line.layout.h, 1);
  assert.ok(line.layout.y + line.layout.h <= 842);
});

test("Ollama conversion validates input and reports incomplete or failed responses", async () => {
  const input = { baseUrl: BASE, model: "qwen3.8:27b", mimeType: "image/png", data: png, consent: true };
  await assert.rejects(() => convertTemplateWithOllama({ ...input, consent: false }), /사내 AI 서버로 파일을 전송/);
  await assert.rejects(() => convertTemplateWithOllama({ ...input, mimeType: "application/pdf" }), /페이지 이미지/);
  await assert.rejects(() => convertTemplateWithOllama({ ...input, model: "../x" }), /모델 이름/);
  await assert.rejects(() => convertTemplateWithOllama({ ...input, data: "bm90IHBuZw==" }), /파일 내용/);
  await assert.rejects(() => convertTemplateWithOllama(input, async () => json({ done_reason: "length", message: { content: "{" } })), /완료되지/);
  await assert.rejects(() => convertTemplateWithOllama(input, async () => json({ error: "model 'x' not found" }, false, 404)), /HTTP 404.*모델이 서버에 없습니다/);
  await assert.rejects(() => convertTemplateWithOllama(input, async () => json({ done_reason: "stop", message: { content: "not json" } })), /변환하지 못했습니다/);
  await assert.rejects(() => convertTemplateWithOllama(input, async () => json({ done_reason: "stop", message: { content: '{"elements":[]}' } })), /요소를 찾지 못했습니다/);
  assert.throws(() => ollamaElementsToBlocks("x"), /요소 목록/);
});

test("Ollama routes use the server-configured address instead of a stored key", async (t) => {
  const calls = [];
  const app = express();
  app.use(express.json());
  const allow = () => (_request, _response, next) => next();
  app.use("/api", createAiRouter({
    getPool: () => ({ query: async () => [[]] }), requireRoles: allow, requireSameOrigin: (_q, _s, next) => next(),
    aiSettings: async () => ({ ollamaBaseUrl: BASE, importModel: "qwen3.8:27b", assistantEnabled: true }),
    ollamaModels: async (input) => { calls.push(input); return [{ id: "qwen3.8:27b", label: "qwen3.8:27b" }]; },
    ollamaConvert: async (input) => { calls.push(input); return { pages: [{ blocks: [] }], skipped: 2 }; },
  }));
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const status = await (await fetch(`${origin}/api/ai-keys`)).json();
  assert.deepEqual(status.providers.at(-1), { provider: "ollama", configured: true, managed: "settings", host: "192.0.2.10:11434" });
  assert.equal((await post("/api/templates/ai-models", { provider: "ollama" })).status, 200);
  assert.deepEqual(calls.at(-1), { baseUrl: BASE, preferred: "qwen3.8:27b" });
  const imported = await post("/api/templates/ai-import", { provider: "ollama", model: "qwen3.8:27b", mimeType: "image/png", data: png, consent: true, baseUrl: "http://evil" });
  assert.deepEqual(await imported.json(), { pages: [{ blocks: [] }], skipped: 2 });
  assert.equal(calls.at(-1).baseUrl, BASE);
  assert.ok(calls.at(-1).signal instanceof AbortSignal);
});

test("page images target a 1200-1800px long side and Qwen gets a document hint", () => {
  assert.equal(targetScale(3600, 2000), 0.5);
  assert.equal(targetScale(600, 400), 2);
  assert.equal(targetScale(1500, 1000), 1);
  assert.match(getModelDescription("ollama", "qwen3.8:27b"), /Qwen/);
  assert.equal(getModelDescription("ollama", "llava:7b"), null);
});
