import { decryptSecret, encryptSecret } from "./datasources.js";

export const AI_KEY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS report_ai_keys (
    provider VARCHAR(20) NOT NULL PRIMARY KEY,
    key_encrypted TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const providers = ["openai", "anthropic", "gemini"];

function invalid(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validateProvider(provider) {
  if (provider === "ollama") throw invalid(400, "사내 AI 서버는 API 키 없이 리포트 설정 › 사내 AI에서 설정합니다.");
  if (!providers.includes(provider)) throw invalid(400, "지원하지 않는 AI 제공자입니다.");
}

// 사내 Ollama 서버는 키 대신 리포트 설정 › 사내 AI의 주소를 쓰므로 등록 여부와 접속 호스트만 함께 알려 준다.
export async function listAiKeyStatus(pool, ollamaBaseUrl = null) {
  const [rows] = await pool.query("SELECT provider FROM report_ai_keys");
  const configured = new Set(rows.map((row) => row.provider));
  return [
    ...providers.map((provider) => ({ provider, configured: configured.has(provider) })),
    { provider: "ollama", configured: Boolean(ollamaBaseUrl), managed: "settings", ...(ollamaBaseUrl ? { host: new URL(ollamaBaseUrl).host } : {}) },
  ];
}

export async function saveAiKey(pool, provider, apiKey) {
  validateProvider(provider);
  if (typeof apiKey !== "string" || !/^[\x21-\x7e]{8,512}$/.test(apiKey)) {
    throw invalid(400, "API 키는 공백 없이 8~512자의 영문 및 기호로 입력해 주세요.");
  }
  await pool.execute(
    `INSERT INTO report_ai_keys (provider, key_encrypted) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE key_encrypted = VALUES(key_encrypted)`,
    [provider, encryptSecret(apiKey)],
  );
}

export async function deleteAiKey(pool, provider) {
  validateProvider(provider);
  await pool.execute("DELETE FROM report_ai_keys WHERE provider = ?", [provider]);
}

export async function resolveAiKey(pool, provider) {
  validateProvider(provider);
  const [rows] = await pool.execute("SELECT key_encrypted AS encrypted FROM report_ai_keys WHERE provider = ?", [provider]);
  if (!rows.length) {
    throw invalid(400, "이 AI 제공자의 API 키가 없습니다. 키를 발급받은 후 관리자에게 리포트 설정에서 등록해 달라고 요청해 주세요.");
  }
  if (!rows[0].encrypted) throw invalid(500, "저장된 AI API 키를 읽을 수 없습니다. 리포트 설정에서 다시 등록해 주세요.");
  return decryptSecret(rows[0].encrypted);
}
