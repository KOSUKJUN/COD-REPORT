import test from "node:test";
import assert from "node:assert/strict";
import { listAiModels } from "../src/server/ai-models.js";

test("Anthropic model pages preserve provider order and exclude unsupported models", async () => {
  const calls = [];
  const models = await listAiModels({ provider: "anthropic", apiKey: "test-key" }, async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => calls.length === 1
      ? { data: [{ id: "claude-new", display_name: "New", capabilities: { image_input: { supported: true }, pdf_input: { supported: true } } }], has_more: true, last_id: "claude-new" }
      : { data: [{ id: "claude-old", display_name: "Old" }, { id: "claude-text", capabilities: { image_input: { supported: false } } }], has_more: false } };
  });
  assert.deepEqual(models.map((model) => model.id), ["claude-new", "claude-old"]);
  assert.equal(new URL(calls[1].url).searchParams.get("after_id"), "claude-new");
  assert.equal(calls[0].options.headers["x-api-key"], "test-key");
});

test("OpenAI sorts by created time and excludes unrelated models", async () => {
  const models = await listAiModels({ provider: "openai", apiKey: "test-key" }, async () => ({ ok: true, json: async () => ({
    data: [{ id: "gpt-old", created: 1 }, { id: "gpt-new", created: 3 }, { id: "gpt-audio", created: 5 }, { id: "text-embedding", created: 6 }],
  }) }));
  assert.deepEqual(models.map((model) => model.id), ["gpt-new", "gpt-old"]);
});

test("Gemini follows pagination and orders versions numerically", async () => {
  let count = 0;
  const models = await listAiModels({ provider: "gemini", apiKey: "test-key" }, async (url) => {
    count += 1;
    if (count === 2) assert.equal(new URL(url).searchParams.get("pageToken"), "next");
    return { ok: true, json: async () => count === 1
      ? { models: [{ name: "models/gemini-2.5-flash", description: "  Official model description  ", supportedGenerationMethods: ["generateContent"] }], nextPageToken: "next" }
      : { models: [{ name: "models/gemini-10-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-3-tts", supportedGenerationMethods: ["generateContent"] }] } };
  });
  assert.deepEqual(models.map((model) => model.id), ["gemini-10-flash", "gemini-2.5-flash"]);
  assert.equal(models[0].description, "");
  assert.equal(models[1].description, "Official model description");
});

test("Gemini description is bounded and ignores malformed values", async () => {
  const models = await listAiModels({ provider: "gemini", apiKey: "test-key" }, async () => ({
    ok: true, json: async () => ({ models: [
      { name: "models/gemini-a", description: "x".repeat(1500), supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-b", description: { text: "bad" }, supportedGenerationMethods: ["generateContent"] },
    ] }),
  }));
  assert.equal(models.find((item) => item.id === "gemini-a").description.length, 1000);
  assert.equal(models.find((item) => item.id === "gemini-b").description, "");
});

test("listing errors never expose API keys and incomplete pagination fails", async () => {
  await assert.rejects(() => listAiModels({ provider: "openai", apiKey: "secret-key" }, async () => ({ ok: false, status: 401 })), (error) => error.message.includes("401") && !error.message.includes("secret-key"));
  await assert.rejects(() => listAiModels({ provider: "anthropic", apiKey: "secret-key" }, async () => ({ ok: true, json: async () => ({ data: [], has_more: true }) })), /페이지 정보/);
  await assert.rejects(() => listAiModels({ provider: "gemini", apiKey: "secret-key" }, async () => ({ ok: true, json: async () => ({ models: [] }) })), /찾지 못했습니다/);
});
