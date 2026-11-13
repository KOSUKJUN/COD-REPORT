function error(message, status = 400) {
  const result = new Error(message);
  result.status = status;
  return result;
}

export async function listAiModels({ provider, apiKey } = {}, fetchImpl = fetch) {
  if (!["openai", "anthropic", "gemini"].includes(provider)) throw error("지원하지 않는 AI 제공자입니다.");
  if (typeof apiKey !== "string" || !/^[\x21-\x7e]{8,512}$/.test(apiKey)) throw error("API 키를 확인해 주세요.");

  const headers = {};
  let url;
  if (provider === "openai") {
    url = new URL("https://api.openai.com/v1/models");
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (provider === "anthropic") {
    url = new URL("https://api.anthropic.com/v1/models");
    url.searchParams.set("limit", "100");
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("pageSize", "100");
    headers["x-goog-api-key"] = apiKey;
  }

  const items = [];
  const cursors = new Set();
  for (let page = 0; page < 20; page += 1) {
    let response;
    try {
      response = await fetchImpl(url.toString(), { headers, signal: AbortSignal.timeout(30000) });
    } catch {
      throw error("AI 제공자에 연결하지 못했거나 모델 목록 요청 시간이 초과되었습니다.", 502);
    }
    if (!response.ok) {
      throw error(`AI 모델 목록을 불러오지 못했습니다 (HTTP ${response.status}). API 키와 제공자 설정을 확인해 주세요.`, 502);
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw error("AI 모델 목록 응답을 읽을 수 없습니다.", 502);
    }
    const data = provider === "gemini" ? body.models : body.data;
    if (!Array.isArray(data)) throw error("AI 모델 목록 응답 형식이 올바르지 않습니다.", 502);
    items.push(...data);
    const cursor = provider === "anthropic" && body.has_more ? body.last_id :
      provider === "gemini" ? body.nextPageToken : null;
    if (!cursor) {
      if (provider === "anthropic" && body.has_more) throw error("AI 모델 목록 페이지 정보가 올바르지 않습니다.", 502);
      break;
    }
    if (typeof cursor !== "string" || cursors.has(cursor) || page === 19) {
      throw error("AI 모델 목록 페이지 정보를 처리하지 못했습니다.", 502);
    }
    cursors.add(cursor);
    url.searchParams.set(provider === "anthropic" ? "after_id" : "pageToken", cursor);
  }

  let models;
  if (provider === "anthropic") {
    models = items.filter((item) => item?.lifecycle !== "retired" &&
      item?.capabilities?.image_input?.supported !== false && item?.capabilities?.pdf_input?.supported !== false)
      .map((item) => ({ id: item.id, label: item.display_name || item.id }));
  } else if (provider === "openai") {
    models = items.filter((item) => /^(gpt-|o[0-9])/.test(item?.id || "") &&
      !/(audio|realtime|transcribe|tts|instruct|search|embedding|moderation|codex)/i.test(item.id) &&
      (!item.shutdown_date || item.shutdown_date >= new Date().toISOString().slice(0, 10)))
      .sort((a, b) => (Number(b.created) || 0) - (Number(a.created) || 0) || a.id.localeCompare(b.id))
      .map((item) => ({ id: item.id, label: item.id }));
  } else {
    models = items.filter((item) => /^models\/gemini-/i.test(item?.name || "") &&
      item.supportedGenerationMethods?.includes("generateContent") &&
      !/(embedding|audio|tts|realtime|live|robotics|image-generation)/i.test(item.name))
      .map((item) => ({ id: item.name.slice(7), label: item.displayName || item.name.slice(7),
        description: typeof item.description === "string" ? item.description.trim().slice(0, 1000) : "" }))
      .sort((a, b) => b.id.localeCompare(a.id, "en", { numeric: true, sensitivity: "base" }));
  }
  const seen = new Set();
  models = models.filter((item) => typeof item.id === "string" && /^[a-zA-Z0-9._-]{1,100}$/.test(item.id) &&
    typeof item.label === "string" && !seen.has(item.id) && seen.add(item.id));
  if (!models.length) throw error("사용 가능한 문서 분석 모델을 찾지 못했습니다. 제공자 계정의 모델 접근 권한을 확인해 주세요.", 502);
  return models;
}
