// AI 어시스턴트 대화 루프: 서버(사내 Ollama 중계)에 한 단계씩 요청하고, 모델이 도구를 호출하면
// 브라우저에서 실행한 결과를 대화에 붙여 다시 요청한다. 모델이 도구 없이 답하면 끝난다.

const MAX_HISTORY_CHARS = 90000;

export class AssistantError extends Error {}

// 서버가 보내는 NDJSON 스트림을 줄 단위로 읽는다.
export async function* readNdjson(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) yield JSON.parse(line);
    }
    if (done) break;
  }
  if (buffer.trim()) yield JSON.parse(buffer.trim());
}

export async function requestStep({ messages, tools, signal, onText, onThinking, fetchImpl = fetch }) {
  const response = await fetchImpl("/api/assistant/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ messages, tools }),
    signal,
  });
  if (!response.ok) {
    let message = `AI 어시스턴트 요청에 실패했습니다 (${response.status}).`;
    try {
      message = (await response.json()).error || message;
    } catch { /* 기본 문구를 쓴다. */ }
    throw new AssistantError(message);
  }
  const step = { content: "", thinking: "", toolCalls: [], doneReason: "" };
  for await (const chunk of readNdjson(response.body)) {
    if (chunk.error) throw new AssistantError(typeof chunk.error === "string" ? chunk.error : "AI 응답 중 오류가 발생했습니다.");
    const message = chunk.message ?? {};
    if (message.thinking) {
      step.thinking += message.thinking;
      onThinking?.(step.thinking);
    }
    if (message.content) {
      step.content += message.content;
      onText?.(step.content);
    }
    if (Array.isArray(message.tool_calls)) step.toolCalls.push(...message.tool_calls);
    if (chunk.done) step.doneReason = chunk.done_reason ?? "";
  }
  return step;
}

// 대화가 길어지면 오래된 요청부터 통째로(사용자 메시지 단위) 덜어 낸다. 마지막 요청은 항상 남긴다.
export function trimHistory(history, maxChars = MAX_HISTORY_CHARS) {
  const size = (items) => items.reduce((sum, item) => sum + item.content.length + JSON.stringify(item.tool_calls ?? "").length, 0);
  let start = 0;
  while (size(history.slice(start)) > maxChars) {
    const next = history.findIndex((item, index) => index > start && item.role === "user");
    if (next < 0) break;
    start = next;
  }
  return history.slice(start);
}

function parseArguments(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed;
    } catch { /* 아래에서 빈 인자로 처리 */ }
  }
  return {};
}

/**
 * 사용자 요청 하나를 끝까지 처리한다. history 배열에 assistant/tool 메시지를 이어 붙인다.
 * onEvent: { type: "text" | "thinking" | "tool-start" | "tool-end" | "step" , ... }
 */
export async function runAssistantTurn({ history, systemPrompt, tools, execute, signal, onEvent = () => {}, maxSteps = 16, fetchImpl }) {
  for (let step = 0; step < maxSteps; step += 1) {
    onEvent({ type: "step", step });
    const messages = [{ role: "system", content: systemPrompt() }, ...trimHistory(history)];
    const result = await requestStep({
      messages, tools, signal, fetchImpl,
      onText: (value) => onEvent({ type: "text", value }),
      onThinking: (value) => onEvent({ type: "thinking", value }),
    });
    const calls = result.toolCalls.map((call) => ({ name: call?.function?.name, arguments: parseArguments(call?.function?.arguments) }))
      .filter((call) => typeof call.name === "string" && call.name);
    history.push({
      role: "assistant", content: result.content,
      ...(calls.length ? { tool_calls: calls.map((call) => ({ function: { name: call.name, arguments: call.arguments } })) } : {}),
    });
    if (!calls.length) {
      if (result.doneReason === "length") onEvent({ type: "text", value: `${result.content}\n\n(응답이 길어 중간에 끊겼습니다. 이어서 진행하려면 "계속"이라고 입력해 주세요.)` });
      return { content: result.content };
    }
    for (const call of calls) {
      if (signal?.aborted) throw new DOMException("취소됨", "AbortError");
      const id = `${step}-${Math.random().toString(36).slice(2, 8)}`;
      onEvent({ type: "tool-start", id, name: call.name, arguments: call.arguments });
      const outcome = await execute(call.name, call.arguments);
      onEvent({ type: "tool-end", id, name: call.name, arguments: call.arguments, ok: outcome.ok, content: outcome.content });
      history.push({ role: "tool", tool_name: call.name, content: outcome.content });
    }
  }
  const note = "작업 단계가 너무 많아 여기서 멈췄습니다. 이어서 진행하려면 \"계속\"이라고 입력해 주세요.";
  history.push({ role: "assistant", content: note });
  onEvent({ type: "text", value: note });
  return { content: note };
}
