import { aiPagesToTemplate } from "../template-transfer.js";

// 사내 Ollama 서버로 양식을 변환한다. 외부 제공자와 달리 키 대신 서버 주소(리포트 설정 › 사내 AI, 없으면 .env의 OLLAMA_BASE_URL)를 사용하고,
// Qwen VL 계열이 익숙한 0~1000 상대 좌표로 받은 뒤 595 x 842 페이지 좌표로 환산한다.
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MODEL_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/;

const PROMPT = `You are a document layout analyst. Recreate the attached page image as editable report elements.
Coordinates: use a 0-1000 relative grid for the whole image. x and width are thousandths of the image width; y and height are thousandths of the image height. (0,0) is the top-left corner. Every element must stay inside 0-1000.
fontSize is the approximate font size in points, assuming the page is A4 (595pt wide). align is "left", "center" or "right".
Element types:
- "title" or "text": content string (keep line breaks as \\n). Optional bold, italic (booleans) and color (#RRGGBB). Use "title" only for the main document title.
- "table": rows as arrays of cell strings (one array per visual row, every row with the same number of cells; leave covered cells of merged areas as ""). merges [{row,column,rowspan,colspan}] zero-based for merged cells. cellBackgrounds with the same shape as rows: #RRGGBB for visibly shaded cells, null otherwise; for merged cells set the color on the top-left anchor cell.
- "shape": kind ("rect","round-rect","ellipse","line","arrow-line","triangle","diamond"), fill and stroke as #RRGGBB or "none". Use "line" for horizontal rules and separators.
- "chart": category ("column","bar","line","pie","area"), title, categories string array, series [{name,values}] with numeric values matching categories.
Rules: transcribe text exactly as printed (Korean included); never invent text or chart values; if chart values cannot be read, use text elements instead. Each table must be a single table element, not separate text boxes. List elements in reading order (top to bottom, left to right). Preserve positions and proportions.`;

// 요소 종류별로 필수 필드를 고정해 소형 모델이 글자 크기·정렬을 빠뜨리거나 다른 종류의 필드를 섞지 않게 한다.
const NUMBER = { type: "number" };
const COLOR = { type: "string" };
const STRING_ARRAY = { type: "array", items: { type: "string" } };
const BOX = { x: NUMBER, y: NUMBER, width: NUMBER, height: NUMBER };
const kindOf = (...types) => ({ type: "string", enum: types });
const strict = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const OLLAMA_RESPONSE_SCHEMA = strict({
  elements: { type: "array", items: { anyOf: [
    strict({ type: kindOf("title", "text"), ...BOX, fontSize: NUMBER, align: kindOf("left", "center", "right"),
      content: { type: "string" }, bold: { type: "boolean" }, italic: { type: "boolean" }, color: COLOR }),
    strict({ type: kindOf("table"), ...BOX, fontSize: NUMBER, rows: { type: "array", items: STRING_ARRAY },
      merges: { type: "array", items: strict({ row: { type: "integer" }, column: { type: "integer" }, rowspan: { type: "integer" }, colspan: { type: "integer" } }) },
      cellBackgrounds: { type: "array", items: { type: "array", items: { type: ["string", "null"] } } } }),
    strict({ type: kindOf("shape"), ...BOX, kind: kindOf("rect", "round-rect", "ellipse", "line", "arrow-line", "triangle", "diamond"),
      fill: COLOR, stroke: COLOR }),
    strict({ type: kindOf("chart"), ...BOX, category: kindOf("column", "bar", "line", "pie", "area"), title: { type: "string" },
      categories: STRING_ARRAY, series: { type: "array", items: strict({ name: { type: "string" }, values: { type: "array", items: NUMBER } }) } }),
  ] } },
});

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function getOllamaBaseUrl(value = process.env.OLLAMA_BASE_URL) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function requireBaseUrl(baseUrl) {
  if (!baseUrl) throw invalid("사내 AI 서버 주소가 설정되지 않았습니다. 관리자에게 리포트 설정 › 사내 AI에서 서버 주소 설정을 요청해 주세요.");
  return baseUrl;
}

function connectionError(baseUrl, aborted) {
  return invalid(aborted ? "사내 AI 서버 요청이 취소되었거나 시간이 초과되었습니다." :
    `사내 AI 서버(${new URL(baseUrl).host})에 연결하지 못했습니다. 서버가 켜져 있는지, 이 서버에서 접근 가능한지 확인해 주세요.`, 502);
}

function isQwen(item) {
  return /qwen/i.test(`${item.name} ${item.details?.family ?? ""} ${(item.details?.families ?? []).join(" ")}`);
}

// Qwen 3.5 이상 계열(family qwen35, qwen35moe 등)을 가장 위에, 그 밖의 Qwen, 기타 비전 모델 순으로 정렬한다.
function rank(item) {
  const family = String(item.details?.family ?? "").toLowerCase();
  if (/^qwen3[5-9]/.test(family) || /^qwen3\.[5-9]/i.test(item.name)) return 0;
  if (isQwen(item)) return 1;
  return 2;
}

function describe(item) {
  const details = item.details ?? {};
  return [details.family && `계열 ${details.family}`, details.parameter_size, details.quantization_level,
    Number.isFinite(details.context_length) && `최대 문맥 ${details.context_length.toLocaleString("ko-KR")}`]
    .filter(Boolean).join(" · ");
}

async function getJson(baseUrl, path, fetchImpl, label) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  } catch (error) {
    throw connectionError(baseUrl, error?.name === "TimeoutError");
  }
  if (!response.ok) throw invalid(`사내 AI 서버의 ${label}을(를) 불러오지 못했습니다 (HTTP ${response.status}).`, 502);
  try {
    return await response.json();
  } catch {
    throw invalid(`사내 AI 서버의 ${label} 응답을 읽을 수 없습니다.`, 502);
  }
}

// ollama.com 등 외부로 요청을 넘기는 원격 모델은 사내 전송 원칙에 맞지 않아 항상 제외한다.
async function fetchLocalModels(baseUrl, fetchImpl) {
  requireBaseUrl(baseUrl);
  const body = await getJson(baseUrl, "/api/tags", fetchImpl, "모델 목록");
  if (!Array.isArray(body?.models)) throw invalid("사내 AI 서버의 모델 목록 응답 형식이 올바르지 않습니다.", 502);
  return body.models
    .filter((item) => typeof item?.name === "string" && MODEL_PATTERN.test(item.name) && !item.name.includes("..") &&
      Array.isArray(item.capabilities) && !item.remote_host && !item.remote_model)
    .sort((a, b) => rank(a) - rank(b) || String(b.modified_at ?? "").localeCompare(String(a.modified_at ?? "")) || a.name.localeCompare(b.name));
}

// 관리자가 지정한 모델을 맨 위로 올린다(목록에 있을 때만).
function preferFirst(models, preferred) {
  const index = preferred ? models.findIndex((item) => item.id === preferred) : -1;
  return index > 0 ? [models[index], ...models.slice(0, index), ...models.slice(index + 1)] : models;
}

export async function listOllamaModels({ baseUrl, preferred = "" } = {}, fetchImpl = fetch) {
  const models = (await fetchLocalModels(baseUrl, fetchImpl))
    .filter((item) => item.capabilities.includes("vision"))
    .map((item) => ({ id: item.name, label: item.name, description: describe(item) }));
  if (!models.length) {
    throw invalid("사내 AI 서버에 이미지를 읽을 수 있는 비전 모델이 없습니다. qwen3-vl 등 비전 모델을 설치해 주세요.", 502);
  }
  return preferFirst(models, preferred);
}

// 리포트 설정의 연결 확인: 서버 버전과 모델별 지원 기능(이미지·도구 호출·추론)을 함께 돌려준다.
// 어시스턴트는 도구 호출이 필요하므로, 같은 계열에서는 큰 모델을 먼저 보여 준다.
export async function listOllamaServerModels({ baseUrl } = {}, fetchImpl = fetch) {
  const items = await fetchLocalModels(baseUrl, fetchImpl);
  let version = "";
  try {
    const body = await getJson(baseUrl, "/api/version", fetchImpl, "버전");
    if (typeof body?.version === "string") version = body.version.slice(0, 40);
  } catch { /* 버전은 참고용이라 실패해도 목록은 보여 준다. */ }
  const models = items
    .filter((item) => item.capabilities.includes("completion"))
    .map((item) => ({
      id: item.name, description: describe(item), size: Number(item.size) || 0, rank: rank(item),
      vision: item.capabilities.includes("vision"), tools: item.capabilities.includes("tools"), thinking: item.capabilities.includes("thinking"),
    }));
  return { version, models };
}

export function pickAssistantModel(models, preferred = "") {
  const usable = models.filter((item) => item.tools);
  if (preferred && usable.some((item) => item.id === preferred)) return preferred;
  return [...usable].sort((a, b) => a.rank - b.rank || b.size - a.size)[0]?.id ?? "";
}

const ROLES = new Set(["system", "user", "assistant", "tool"]);
const TOOL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

// 브라우저가 보낸 대화·도구 정의를 그대로 넘기기 전에 모양과 크기를 확인한다.
export function validateAssistantRequest(input) {
  const { messages, tools } = input ?? {};
  if (!Array.isArray(messages) || !messages.length || messages.length > 300) throw invalid("대화 내용 형식이 올바르지 않습니다.");
  if (!Array.isArray(tools) || tools.length > 80) throw invalid("도구 정의 형식이 올바르지 않습니다.");
  const cleanMessages = messages.map((message) => {
    if (!message || !ROLES.has(message.role) || typeof message.content !== "string" || message.content.length > 200000) {
      throw invalid("대화 내용 형식이 올바르지 않습니다.");
    }
    const clean = { role: message.role, content: message.content };
    if (message.role === "tool" && typeof message.tool_name === "string" && TOOL_NAME.test(message.tool_name)) clean.tool_name = message.tool_name;
    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      clean.tool_calls = message.tool_calls.slice(0, 40).map((call) => {
        const name = call?.function?.name;
        const args = call?.function?.arguments;
        if (typeof name !== "string" || !TOOL_NAME.test(name) || !args || typeof args !== "object" || Array.isArray(args)) {
          throw invalid("도구 호출 기록 형식이 올바르지 않습니다.");
        }
        return { function: { name, arguments: args } };
      });
    }
    return clean;
  });
  const cleanTools = tools.map((tool) => {
    const fn = tool?.function;
    if (tool?.type !== "function" || !fn || typeof fn.name !== "string" || !TOOL_NAME.test(fn.name) ||
        typeof fn.description !== "string" || fn.description.length > 4000 || !fn.parameters || typeof fn.parameters !== "object") {
      throw invalid("도구 정의 형식이 올바르지 않습니다.");
    }
    return { type: "function", function: { name: fn.name, description: fn.description, parameters: fn.parameters } };
  });
  if (JSON.stringify({ cleanMessages, cleanTools }).length > 1_500_000) throw invalid("대화가 너무 깁니다. 새 대화를 시작해 주세요.");
  return { messages: cleanMessages, tools: cleanTools };
}

// 어시스턴트 대화 한 단계를 사내 서버에 요청하고, 줄 단위(NDJSON) 스트림 응답을 그대로 돌려준다.
export async function requestAssistantChat({ baseUrl, model, think = false, messages, tools, signal }, fetchImpl = fetch) {
  requireBaseUrl(baseUrl);
  if (!model) throw invalid("어시스턴트에 사용할 모델이 없습니다. 관리자에게 리포트 설정 › 사내 AI에서 도구 호출을 지원하는 모델을 지정해 달라고 요청해 주세요.");
  const body = {
    model, stream: true, think, messages, tools, keep_alive: "30m",
    // 편집 명령은 일관돼야 하므로 무작위성을 낮게 두고, 도구 정의와 양식 상태가 들어가도록 문맥을 넉넉히 잡는다.
    options: { temperature: 0.2, num_ctx: 32768, num_predict: 8192 },
  };
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.any([AbortSignal.timeout(600000), ...(signal ? [signal] : [])]),
    });
  } catch (error) {
    throw connectionError(baseUrl, ["TimeoutError", "AbortError"].includes(error?.name));
  }
  if (!response.ok) {
    let detail = "";
    try {
      const text = String((await response.json())?.error ?? "");
      if (/not found/i.test(text)) detail = " 지정한 모델이 서버에 없습니다. 리포트 설정 › 사내 AI에서 모델을 다시 선택해 주세요.";
      else if (/does not support tools/i.test(text)) detail = " 지정한 모델은 도구 호출을 지원하지 않습니다. 다른 모델을 선택해 주세요.";
      else if (/memory|resource/i.test(text)) detail = " 서버의 GPU 메모리가 부족합니다.";
    } catch { /* 상태 코드만 안내한다. */ }
    throw invalid(`사내 AI 서버가 요청을 처리하지 못했습니다 (HTTP ${response.status}).${detail}`, 502);
  }
  return response;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 10) / 10;

// 0~1000 좌표를 페이지 좌표로 바꾸고, 소형 모델에서 흔한 약간의 범위 초과는 잘라서 맞춘다.
function toPage(element) {
  const values = [element.x, element.y, element.width, element.height].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [x0, y0, w0, h0] = values.map((value) => clamp(value, 0, 1000));
  const x = round(clamp(x0 * PAGE_WIDTH / 1000, 0, PAGE_WIDTH - 10));
  const y = round(clamp(y0 * PAGE_HEIGHT / 1000, 0, PAGE_HEIGHT - 1));
  const width = round(clamp(w0 * PAGE_WIDTH / 1000, 10, PAGE_WIDTH - x));
  const height = round(clamp(h0 * PAGE_HEIGHT / 1000, 1, PAGE_HEIGHT - y));
  const result = { ...element, x, y, width, height };
  if (Array.isArray(result.rows)) {
    result.rows = result.rows.map((row) => Array.isArray(row) ? row.map((cell) => cell == null ? "" : String(cell)) : row);
  }
  // 모델이 흰 배경을 음영으로, 병합되지 않은 셀을 1x1 병합으로 표시하는 경우가 있어 정리한다.
  if (Array.isArray(result.cellBackgrounds)) {
    result.cellBackgrounds = result.cellBackgrounds.map((row) => Array.isArray(row)
      ? row.map((color) => typeof color === "string" && /^#ffffff$/i.test(color) ? null : color) : row);
  }
  if (Array.isArray(result.merges)) {
    result.merges = result.merges.filter((merge) => !(merge?.rowspan === 1 && merge?.colspan === 1));
  }
  return result;
}

function tryConvert(element) {
  try {
    return aiPagesToTemplate({ pages: [{ elements: [element] }] })[0].blocks[0];
  } catch {
    return null;
  }
}

// 요소 하나가 잘못돼도 페이지 전체를 버리지 않도록 요소별로 검증하고, 표는 음영·병합 정보만 빼고 한 번 더 시도한다.
export function ollamaElementsToBlocks(elements) {
  if (!Array.isArray(elements)) throw invalid("AI가 올바른 요소 목록을 반환하지 않았습니다.", 502);
  const blocks = [];
  let skipped = 0;
  for (const raw of elements.slice(0, 200)) {
    const element = raw && typeof raw === "object" ? toPage(raw) : null;
    let block = element && tryConvert(element);
    if (!block && element?.type === "table") {
      const { cellBackgrounds: _backgrounds, merges: _merges, ...plain } = element;
      block = tryConvert(plain);
    }
    if (block) blocks.push(block);
    else skipped += 1;
  }
  skipped += Math.max(0, elements.length - 200);
  if (!blocks.length) throw invalid("AI가 편집 가능한 요소를 찾지 못했습니다. 다른 모델을 선택하거나 더 선명한 원본으로 다시 시도해 주세요.", 502);
  return { blocks, skipped };
}

export async function convertTemplateWithOllama(input, fetchImpl = fetch) {
  const { baseUrl, model, mimeType, data, consent, signal } = input ?? {};
  requireBaseUrl(baseUrl);
  if (consent !== true) throw invalid("사내 AI 서버로 파일을 전송하는 데 동의해 주세요.");
  if (typeof model !== "string" || !MODEL_PATTERN.test(model) || model.includes("..")) throw invalid("모델 이름이 올바르지 않습니다.");
  if (mimeType === "application/pdf") throw invalid("사내 AI 서버에는 PDF를 페이지 이미지로 변환해 보내야 합니다. 화면을 새로 고친 뒤 다시 시도해 주세요.");
  if (!["image/png", "image/jpeg"].includes(mimeType) || typeof data !== "string" || data.length > 12 * 1024 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw invalid("페이지 이미지는 PNG 또는 JPG 9MB 이하여야 합니다.");
  }
  const bytes = Buffer.from(data, "base64");
  const validMagic = mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) :
    bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!validMagic) throw invalid("파일 내용이 선택한 형식과 다릅니다.");

  const body = {
    model, stream: false, think: false, keep_alive: "10m", format: OLLAMA_RESPONSE_SCHEMA,
    // 추출 작업이라 무작위성을 없애고, 긴 JSON이 잘리지 않도록 문맥과 출력 길이를 넉넉히 잡는다.
    options: { temperature: 0, num_ctx: 32768, num_predict: 16384 },
    messages: [{ role: "user", content: PROMPT, images: [data] }],
  };
  // 로컬 모델은 페이지당 수 분이 걸릴 수 있어 시간 제한을 길게 두고, 사용자가 취소하면 서버 작업도 함께 멈춘다.
  const signals = [AbortSignal.timeout(600000), ...(signal ? [signal] : [])];
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/api/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any(signals),
    });
  } catch (error) {
    throw connectionError(baseUrl, ["TimeoutError", "AbortError"].includes(error?.name));
  }
  if (!response.ok) {
    let detail = "";
    try {
      const text = String((await response.json())?.error ?? "");
      if (/not found/i.test(text)) detail = " 선택한 모델이 서버에 없습니다.";
      else if (/memory|resource/i.test(text)) detail = " 서버의 GPU 메모리가 부족합니다. 더 작은 모델을 선택해 주세요.";
    } catch { /* 본문이 없거나 JSON이 아니면 상태 코드만 안내한다. */ }
    throw invalid(`사내 AI 서버가 요청을 처리하지 못했습니다 (HTTP ${response.status}).${detail}`, 502);
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw invalid("사내 AI 서버의 응답을 읽을 수 없습니다.", 502);
  }
  if (result?.done_reason !== "stop") {
    throw invalid("AI 응답이 완료되지 않았습니다. 요소가 많은 페이지는 원본을 나누거나 더 큰 모델로 다시 시도해 주세요.", 502);
  }
  let parsed;
  try {
    const text = String(result.message?.content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    parsed = JSON.parse(text);
  } catch {
    throw invalid("AI 결과를 편집 가능한 페이지로 변환하지 못했습니다. 다시 시도하거나 다른 모델을 선택해 주세요.", 502);
  }
  const elements = Array.isArray(parsed?.elements) ? parsed.elements : parsed?.pages?.[0]?.elements;
  const { blocks, skipped } = ollamaElementsToBlocks(elements);
  return { pages: [{ blocks }], skipped };
}
