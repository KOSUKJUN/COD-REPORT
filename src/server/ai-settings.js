import { getOllamaBaseUrl } from "./ai-ollama.js";

// 사내 AI(Ollama) 설정. 관리자가 리포트 설정 › 사내 AI에서 바꾸며, 한 번도 저장하지 않았으면 서버 .env 값을 쓴다.
export const AI_SETTINGS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS report_ai_settings (
    id TINYINT NOT NULL PRIMARY KEY,
    settings_json TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

export const MODEL_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/;

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function defaults() {
  return {
    ollamaBaseUrl: getOllamaBaseUrl() ?? "",
    assistantEnabled: true,
    assistantModel: "",
    assistantThink: false,
    importModel: "",
  };
}

function validModel(value) {
  return typeof value === "string" && (value === "" || (MODEL_NAME_PATTERN.test(value) && !value.includes("..")));
}

export function normalizeAiSettings(input) {
  const base = defaults();
  const value = input && typeof input === "object" ? input : {};
  return {
    ollamaBaseUrl: typeof value.ollamaBaseUrl === "string" ? (getOllamaBaseUrl(value.ollamaBaseUrl) ?? "") : base.ollamaBaseUrl,
    assistantEnabled: typeof value.assistantEnabled === "boolean" ? value.assistantEnabled : base.assistantEnabled,
    assistantModel: validModel(value.assistantModel) ? value.assistantModel : "",
    assistantThink: value.assistantThink === true,
    importModel: validModel(value.importModel) ? value.importModel : "",
  };
}

export async function getAiSettings(pool) {
  const [rows] = await pool.execute("SELECT settings_json AS settings FROM report_ai_settings WHERE id = 1");
  if (!rows.length) return defaults();
  try {
    return normalizeAiSettings(JSON.parse(rows[0].settings));
  } catch {
    return defaults();
  }
}

export function validateAiSettings(input) {
  if (!input || typeof input !== "object") throw invalid("사내 AI 설정 형식이 올바르지 않습니다.");
  const url = typeof input.ollamaBaseUrl === "string" ? input.ollamaBaseUrl.trim() : "";
  if (url && !getOllamaBaseUrl(url)) {
    throw invalid("서버 주소는 http:// 또는 https://로 시작하는 주소로 입력해 주세요. 예: http://192.168.0.106:11434");
  }
  for (const key of ["assistantModel", "importModel"]) {
    if (input[key] !== undefined && !validModel(input[key])) throw invalid("모델 이름이 올바르지 않습니다.");
  }
  return normalizeAiSettings({ ...input, ollamaBaseUrl: url });
}

export async function saveAiSettings(pool, input) {
  const settings = validateAiSettings(input);
  await pool.execute(
    `INSERT INTO report_ai_settings (id, settings_json) VALUES (1, ?)
     ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json)`,
    [JSON.stringify(settings)],
  );
  return settings;
}
