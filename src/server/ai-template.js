import { aiPagesToTemplate } from "../template-transfer.js";

const PROMPT = `Recreate every page of the attached document as editable report elements.
Return ONLY JSON: {"pages":[{"elements":[...]}]}. Page coordinates use a 595 x 842 canvas.
Each element includes type, x, y, width, height, fontSize and align ("left", "center" or "right"). For text you may include bold, italic (booleans) and color (#RRGGBB).
Types: "title" or "text" with content string; "table" with rows array of string arrays and optional merges [{row,column,rowspan,colspan}] (zero-based); "shape" with kind ("rect","round-rect","ellipse","line","arrow-line","triangle","diamond"), fill and stroke as #RRGGBB or "none"; "chart" with category ("column","bar","line","pie","area"), title, categories string array, and series [{name,values}] with numeric values.
For each table, include cellBackgrounds, an array of arrays matching rows by zero-based row and column. Use a #RRGGBB string for each visibly shaded cell, and null for unshaded cells. For merged cells, set the color at the top-left anchor cell. Example: {"rows":[["Header","Value"],["A","1"]],"cellBackgrounds":[["#D9EAF7","#D9EAF7"],[null,null]]}. Preserve header, alternating row, and individual cell shading when present.
Preserve text, reading order, positions, proportions and page breaks. Do not invent text or chart values. If chart values cannot be read, use text instead. Coordinates must fit the page. Return no markdown.`;

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function convertTemplateWithAi(input, fetchImpl = fetch) {
  const { provider, model, apiKey, mimeType, data, consent } = input ?? {};
  if (consent !== true) throw invalid("외부 AI 제공자에게 파일을 전송하는 데 동의해 주세요.");
  if (!["openai", "anthropic", "gemini"].includes(provider)) throw invalid("지원하지 않는 AI 제공자입니다.");
  if (typeof model !== "string" || !/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw invalid("모델 이름이 올바르지 않습니다.");
  if (typeof apiKey !== "string" || !/^[\x21-\x7e]{8,512}$/.test(apiKey)) throw invalid("API 키를 확인해 주세요.");
  if (!["application/pdf", "image/png", "image/jpeg"].includes(mimeType) ||
      typeof data !== "string" || data.length > 12 * 1024 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw invalid("PDF, PNG 또는 JPG 파일을 9MB 이하로 선택해 주세요.");
  }
  const bytes = Buffer.from(data, "base64");
  const validMagic = mimeType === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-" :
    mimeType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
      bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!validMagic) throw invalid("파일 내용이 선택한 형식과 다릅니다.");

  const dataUrl = `data:${mimeType};base64,${data}`;
  let url;
  let headers = { "Content-Type": "application/json" };
  let body;
  if (provider === "openai") {
    url = "https://api.openai.com/v1/responses";
    headers.Authorization = `Bearer ${apiKey}`;
    body = { model, max_output_tokens: 16000, input: [{ role: "user", content: [
      { type: "input_text", text: PROMPT },
      mimeType === "application/pdf"
        ? { type: "input_file", filename: "document.pdf", file_data: dataUrl }
        : { type: "input_image", image_url: dataUrl },
    ] }] };
  } else if (provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers = { ...headers, "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
    body = { model, max_tokens: 16000, messages: [{ role: "user", content: [
      { type: mimeType === "application/pdf" ? "document" : "image", source: { type: "base64", media_type: mimeType, data } },
      { type: "text", text: PROMPT },
    ] }] };
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    headers["x-goog-api-key"] = apiKey;
    body = { contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data } }] }],
      generationConfig: { maxOutputTokens: 16000, responseMimeType: "application/json" } };
  }

  let response;
  try {
    response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  } catch {
    throw invalid("AI 제공자에 연결하지 못했거나 요청 시간이 초과되었습니다.", 502);
  }
  if (!response.ok) throw invalid(`AI 제공자가 요청을 거부했습니다 (HTTP ${response.status}). API 키, 모델 및 사용량을 확인해 주세요.`, 502);
  let result;
  try {
    result = await response.json();
  } catch {
    throw invalid("AI 제공자의 응답을 읽을 수 없습니다.", 502);
  }
  if ((provider === "openai" && result.status !== "completed") ||
      (provider === "anthropic" && result.stop_reason !== "end_turn") ||
      (provider === "gemini" && result.candidates?.[0]?.finishReason !== "STOP")) {
    throw invalid("AI 응답이 완료되지 않았습니다. 더 작은 파일로 다시 시도해 주세요.", 502);
  }
  const text = provider === "openai"
    ? result.output?.flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text).join("")
    : provider === "anthropic"
      ? result.content?.filter((item) => item.type === "text").map((item) => item.text).join("")
      : result.candidates?.[0]?.content?.parts?.map((item) => item.text ?? "").join("");
  try {
    const json = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return aiPagesToTemplate(JSON.parse(json));
  } catch {
    throw invalid("AI 결과를 편집 가능한 페이지로 변환하지 못했습니다. 다시 시도하거나 원본을 나눠 주세요.", 502);
  }
}
