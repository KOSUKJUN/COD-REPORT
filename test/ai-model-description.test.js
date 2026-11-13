import test from "node:test";
import assert from "node:assert/strict";
import { getModelDescription } from "../src/ai-model-description.js";

test("known model families have a Korean explanation without misclassifying names", () => {
  const examples = [
    ["openai", "gpt-4o-mini", /mini/],
    ["openai", "gpt-5-nano-2026", /nano/],
    ["openai", "gpt-5-pro", /pro/],
    ["openai", "o3", /추론/],
    ["openai", "gpt-future", /GPT/],
    ["anthropic", "claude-opus-4-6", /Opus/],
    ["anthropic", "claude-3-7-sonnet-latest", /Sonnet/],
    ["anthropic", "claude-haiku-4-5", /Haiku/],
    ["gemini", "gemini-2.5-flash-lite", /Flash-Lite/],
    ["gemini", "gemini-2.5-flash", /Flash 계열/],
    ["gemini", "gemini-2.5-pro", /Pro/],
  ];
  for (const [provider, id, expected] of examples) assert.match(getModelDescription(provider, id), expected);
  assert.equal(getModelDescription("anthropic", "claude-unknown"), null);
  assert.equal(getModelDescription("gemini", "gemini-flashier"), null);
  assert.equal(getModelDescription("unknown", "gpt-5-mini"), null);
  assert.equal(getModelDescription("openai", null), null);
});
