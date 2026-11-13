import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { listOllamaModels, listOllamaServerModels, pickAssistantModel, validateAssistantRequest } from "../src/server/ai-ollama.js";
import { normalizeAiSettings, validateAiSettings } from "../src/server/ai-settings.js";
import { createAiRouter } from "../src/server/ai-routes.js";

const BASE = "http://192.0.2.10:11434";
const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

test("vision model list puts the admin-preferred import model first", async () => {
  const tags = { models: [
    { name: "qwen3.8:27b", capabilities: ["completion", "vision", "tools"], details: { family: "qwen35" } },
    { name: "gemma4:31b", capabilities: ["completion", "vision"], details: { family: "gemma4" } },
  ] };
  const models = await listOllamaModels({ baseUrl: BASE, preferred: "gemma4:31b" }, async () => json(tags));
  assert.deepEqual(models.map((item) => item.id), ["gemma4:31b", "qwen3.8:27b"]);
});

test("server model listing reports capabilities and picks a tool-capable assistant model", async () => {
  const result = await listOllamaServerModels({ baseUrl: BASE }, async (url) => url.endsWith("/api/version")
    ? json({ version: "0.40.14" })
    : json({ models: [
      { name: "qwen3.5:latest", size: 7e9, capabilities: ["completion", "vision", "tools"], details: {} },
      { name: "qwen3.8:27b", size: 17e9, capabilities: ["completion", "vision", "tools", "thinking"], details: { family: "qwen35" } },
      { name: "mistral:latest", size: 4e9, capabilities: ["completion"], details: { family: "llama" } },
      { name: "bge-m3:latest", capabilities: ["embedding"] },
      { name: "cloud:latest", remote_host: "https://ollama.com:443", capabilities: ["completion", "tools"] },
    ] }));
  assert.equal(result.version, "0.40.14");
  assert.deepEqual(result.models.map((item) => item.id).sort(), ["mistral:latest", "qwen3.5:latest", "qwen3.8:27b"]);
  assert.equal(result.models.find((item) => item.id === "qwen3.8:27b").thinking, true);
  assert.equal(pickAssistantModel(result.models), "qwen3.8:27b");
  assert.equal(pickAssistantModel(result.models, "qwen3.5:latest"), "qwen3.5:latest");
  assert.equal(pickAssistantModel(result.models, "mistral:latest"), "qwen3.8:27b");
});

test("assistant requests are validated before they reach the AI server", () => {
  const tools = [{ type: "function", function: { name: "add_block", description: "Add", parameters: { type: "object", properties: {} } } }];
  const clean = validateAssistantRequest({
    messages: [
      { role: "user", content: "제목 추가", extra: "drop" },
      { role: "assistant", content: "", tool_calls: [{ id: "x", function: { name: "add_block", arguments: { type: "title" } } }] },
      { role: "tool", tool_name: "add_block", content: "{}" },
    ],
    tools,
  });
  assert.deepEqual(clean.messages[0], { role: "user", content: "제목 추가" });
  assert.deepEqual(clean.messages[1].tool_calls, [{ function: { name: "add_block", arguments: { type: "title" } } }]);
  assert.equal(clean.messages[2].tool_name, "add_block");
  assert.throws(() => validateAssistantRequest({ messages: [], tools }), /대화 내용/);
  assert.throws(() => validateAssistantRequest({ messages: [{ role: "root", content: "x" }], tools }), /대화 내용/);
  assert.throws(() => validateAssistantRequest({ messages: [{ role: "user", content: "x" }], tools: [{ type: "function", function: { name: "bad name" } }] }), /도구 정의/);
  assert.throws(() => validateAssistantRequest({ messages: [{ role: "assistant", content: "", tool_calls: [{ function: { name: "x", arguments: "str" } }] }], tools }), /도구 호출/);
});

test("AI settings fall back to the environment and validate addresses and models", () => {
  const saved = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = "http://10.0.0.5:11434/";
  try {
    assert.equal(normalizeAiSettings(null).ollamaBaseUrl, "http://10.0.0.5:11434");
    assert.equal(normalizeAiSettings({ ollamaBaseUrl: "" }).ollamaBaseUrl, "");
  } finally {
    if (saved === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = saved;
  }
  const settings = validateAiSettings({ ollamaBaseUrl: " http://192.168.0.106:11434 ", assistantModel: "qwen3.8:27b", assistantThink: "yes" });
  assert.deepEqual(settings, { ollamaBaseUrl: "http://192.168.0.106:11434", assistantEnabled: true, assistantModel: "qwen3.8:27b", assistantThink: false, importModel: "" });
  assert.throws(() => validateAiSettings({ ollamaBaseUrl: "ftp://x" }), /http/);
  assert.throws(() => validateAiSettings({ ollamaBaseUrl: "", assistantModel: "../x" }), /모델 이름/);
});

test("assistant routes stream the AI server response and respect the admin switch", async (t) => {
  let settings = { ollamaBaseUrl: BASE, assistantEnabled: true, assistantModel: "", assistantThink: true };
  const chats = [];
  const app = express();
  app.use(express.json());
  const roleCheck = (...roles) => (request, response, next) => roles.includes(request.get("x-role")) ? next() : response.sendStatus(403);
  app.use("/api", createAiRouter({
    getPool: () => ({}), requireRoles: roleCheck, requireSameOrigin: (_q, _s, next) => next(),
    aiSettings: async () => settings,
    storeAiSettings: async (input) => { settings = validateAiSettings(input); return settings; },
    ollamaServerModels: async () => ({ version: "1", models: [{ id: "qwen3.8:27b", tools: true, rank: 0, size: 1 }] }),
    assistantChat: async (input) => {
      chats.push(input);
      const lines = [
        { message: { role: "assistant", content: "", tool_calls: [{ function: { name: "add_page", arguments: {} } }] }, done: false },
        { message: { content: "" }, done: true, done_reason: "stop" },
      ];
      return new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
    },
  }));
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { role = "EDITOR", method = "GET", body } = {}) => fetch(`${origin}${path}`, {
    method, headers: { "x-role": role, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  });

  assert.equal((await call("/api/ai-settings")).status, 403);
  assert.equal((await call("/api/ai-settings", { role: "ADMIN", method: "PUT", body: { ollamaBaseUrl: "x" } })).status, 400);
  assert.deepEqual(await (await call("/api/assistant/status")).json(), { enabled: true, configured: true, model: "", host: "192.0.2.10:11434" });
  const checked = await (await call("/api/ai-settings/test", { role: "ADMIN", method: "POST", body: {} })).json();
  assert.equal(checked.recommendedAssistantModel, "qwen3.8:27b");

  const response = await call("/api/assistant/chat", { method: "POST", body: { messages: [{ role: "user", content: "페이지 추가" }], tools: [] } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /ndjson/);
  const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines[0].message.tool_calls[0].function.name, "add_page");
  assert.equal(chats[0].model, "qwen3.8:27b");
  assert.equal(chats[0].think, true);
  assert.equal(chats[0].baseUrl, BASE);

  settings = { ...settings, assistantEnabled: false };
  const disabled = await call("/api/assistant/chat", { method: "POST", body: { messages: [{ role: "user", content: "x" }], tools: [] } });
  assert.equal(disabled.status, 400);
  assert.match((await disabled.json()).error, /꺼져 있거나/);
  assert.equal((await call("/api/assistant/chat", { role: "VIEWER", method: "POST", body: {} })).status, 403);
});
