import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAiRouter } from "../src/server/ai-routes.js";

test("shared AI keys are encrypted, write-only and used for models and import", async (t) => {
  const savedSecret = process.env.DATASOURCE_SECRET;
  process.env.DATASOURCE_SECRET = "unit-test-encryption-secret";
  t.after(() => {
    if (savedSecret === undefined) delete process.env.DATASOURCE_SECRET;
    else process.env.DATASOURCE_SECRET = savedSecret;
  });
  const stored = new Map();
  const pool = {
    async query(sql) {
      assert.match(sql, /SELECT provider FROM report_ai_keys/);
      return [[...stored.keys()].map((provider) => ({ provider }))];
    },
    async execute(sql, params) {
      if (sql.startsWith("INSERT")) stored.set(params[0], params[1]);
      else if (sql.startsWith("DELETE")) stored.delete(params[0]);
      else if (sql.startsWith("SELECT")) return [stored.has(params[0]) ? [{ encrypted: stored.get(params[0]) }] : []];
      else throw new Error("Unexpected SQL");
      return [{}];
    },
  };
  const calls = [];
  const app = express();
  app.use(express.json());
  const requireRoles = (...roles) => (request, response, next) => {
    if (!roles.includes(request.get("x-test-role"))) return response.sendStatus(403);
    next();
  };
  const requireSameOrigin = (request, response, next) => {
    if (request.get("origin") !== `${request.protocol}://${request.get("host")}`) return response.sendStatus(403);
    next();
  };
  app.use("/api", createAiRouter({
    getPool: () => pool, requireRoles, requireSameOrigin, aiSettings: async () => ({ ollamaBaseUrl: "" }),
    models: async (input) => { calls.push(input); return [{ id: "model", label: "Model" }]; },
    convert: async (input) => { calls.push(input); return [{ blocks: [] }]; },
  }));
  app.use((error, _request, response, _next) => response.status(error.status || 500).json({ error: error.message }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { role = "ADMIN", method = "GET", body, sameOrigin = true } = {}) => fetch(`${origin}${path}`, {
    method,
    headers: { "x-test-role": role, ...(sameOrigin ? { Origin: origin } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const save = (role, key, sameOrigin = true) => request("/api/ai-keys/openai", { role, method: "PUT", body: { apiKey: key }, sameOrigin });
  assert.equal((await save("EDITOR", "test-secret-one")).status, 403);
  assert.equal((await save("ADMIN", "test-secret-one", false)).status, 403);
  assert.equal((await save("ADMIN", "short")).status, 400);
  assert.equal((await request("/api/ai-keys/unknown", { method: "PUT", body: { apiKey: "test-secret-one" } })).status, 400);
  const missing = await request("/api/templates/ai-models", { role: "EDITOR", method: "POST", body: { provider: "openai", apiKey: "caller-key" } });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /발급.*리포트 설정/);
  assert.equal(calls.length, 0);
  assert.equal((await save("ADMIN", "test-secret-one")).status, 204);
  assert.ok(stored.get("openai").startsWith("v1:"));
  assert.ok(!stored.get("openai").includes("test-secret-one"));
  const status = await request("/api/ai-keys", { role: "EDITOR" });
  const statusText = await status.text();
  assert.ok(!statusText.includes("test-secret-one"));
  assert.deepEqual(JSON.parse(statusText).providers, [
    { provider: "openai", configured: true }, { provider: "anthropic", configured: false }, { provider: "gemini", configured: false },
    { provider: "ollama", configured: false, managed: "settings" },
  ]);
  assert.equal((await request("/api/ai-keys/ollama", { method: "PUT", body: { apiKey: "test-secret-one" } })).status, 400);
  assert.equal((await request("/api/ai-keys", { role: "VIEWER" })).status, 403);
  assert.equal((await request("/api/templates/ai-models", { role: "EDITOR", method: "POST", body: { provider: "openai", apiKey: "caller-key" } })).status, 200);
  assert.equal(calls.at(-1).apiKey, "test-secret-one");
  assert.equal((await request("/api/templates/ai-import", { role: "EDITOR", method: "POST", body: { provider: "openai", apiKey: "caller-key" } })).status, 200);
  assert.equal(calls.at(-1).apiKey, "test-secret-one");
  assert.equal((await save("ADMIN", "test-secret-two")).status, 204);
  await request("/api/templates/ai-models", { method: "POST", body: { provider: "openai" } });
  assert.equal(calls.at(-1).apiKey, "test-secret-two");
  assert.equal((await request("/api/ai-keys/openai", { method: "DELETE", role: "EDITOR" })).status, 403);
  assert.equal((await request("/api/ai-keys/openai", { method: "DELETE" })).status, 204);
  assert.equal((await request("/api/templates/ai-import", { method: "POST", body: { provider: "openai" } })).status, 400);
});
