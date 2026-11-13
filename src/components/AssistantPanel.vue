<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ASSISTANT_TOOLS, MUTATING_TOOLS, TOOL_LABELS, buildSystemPrompt, createToolExecutor } from "../assistant/editor-tools.js";
import { runAssistantTurn } from "../assistant/assistant-client.js";

const props = defineProps({
  open: { type: Boolean, default: false },
  context: { type: Object, required: true },
  authUser: { type: Object, required: true },
});
const emit = defineEmits(["close"]);

const SUGGESTIONS = [
  "월간 영업 실적 보고서 양식을 만들어줘. 요약, 지역별 실적 표, 월별 추이 차트를 넣어줘",
  "용지를 A4 가로로 바꾸고 바닥글 가운데에 페이지 번호를 넣어줘",
  "현재 양식에 어떤 요소가 있는지 정리해줘",
  "이 양식을 매주 월요일 오전 9시에 자동 생성되게 설정해줘",
];

const status = ref(null); // { enabled, configured, model, host }
const statusError = ref("");
const items = ref([]); // 화면에 보이는 대화
const input = ref("");
const busy = ref(false);
const pendingConfirm = ref(null); // { message, resolve }
const listRef = ref(null);
const inputRef = ref(null);
let history = []; // 모델에 보내는 대화 기록
let controller = null;

const isAdmin = computed(() => props.authUser?.role === "ADMIN");
const ready = computed(() => Boolean(status.value?.enabled));
const lastUndoIndex = computed(() => {
  for (let index = items.value.length - 1; index >= 0; index -= 1) {
    if (items.value[index].undo && !items.value[index].undone) return index;
  }
  return -1;
});

const execute = createToolExecutor({
  ...props.context,
  confirm: (message) => new Promise((resolve) => {
    pendingConfirm.value = { message, resolve };
    scrollToBottom();
  }),
});

async function loadStatus() {
  statusError.value = "";
  try {
    const response = await fetch("/api/assistant/status", { headers: { Accept: "application/json" } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "AI 어시스턴트 상태를 확인하지 못했습니다.");
    status.value = result;
  } catch (error) {
    statusError.value = error.message || "AI 어시스턴트 상태를 확인하지 못했습니다.";
  }
}

watch(() => props.open, (open) => {
  if (!open) return;
  if (!status.value) loadStatus();
  nextTick(() => inputRef.value?.focus());
}, { immediate: true });

function scrollToBottom() {
  nextTick(() => {
    const list = listRef.value;
    if (list) list.scrollTop = list.scrollHeight;
  });
}

function today() {
  const parts = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} (${get("weekday")})`;
}

function describeCall(name, args = {}) {
  const label = TOOL_LABELS[name] ?? name;
  if (name === "add_blocks" && Array.isArray(args.blocks)) return `${label}: ${args.blocks.length}개`;
  const detail = name !== "update_block" && args.type ?`${args.type}${args.content ? ` · ${args.content}` : args.heading ? ` · ${args.heading}` : ""}` :
    args.name ?? args.chart_title ?? args.size ?? (args.page ? `${args.page}페이지` : "");
  return detail ? `${label}: ${String(detail).replace(/\s+/g, " ").slice(0, 40)}` : label;
}

function resultError(content) {
  try {
    return JSON.parse(content)?.error ?? "";
  } catch {
    return "";
  }
}

async function send(text = input.value) {
  const message = text.trim();
  if (!message || busy.value || !ready.value) return;
  input.value = "";
  busy.value = true;
  controller = new AbortController();
  items.value.push({ role: "user", text: message });
  const reply = { role: "assistant", text: "", thinking: "", steps: [], streaming: true, error: "", undo: null, undone: false };
  items.value.push(reply);
  const view = items.value[items.value.length - 1]; // 반응형 프록시로 갱신해야 화면에 바로 반영된다.
  scrollToBottom();
  const snapshot = props.context.snapshot();
  let changed = false;
  history.push({ role: "user", content: message });
  execute.beginTurn();
  try {
    await runAssistantTurn({
      history,
      tools: ASSISTANT_TOOLS,
      execute,
      signal: controller.signal,
      systemPrompt: () => buildSystemPrompt({ state: execute.editorState(), userName: props.authUser?.name, today: today() }),
      onEvent(event) {
        if (event.type === "step") view.text = "";
        else if (event.type === "text") view.text = event.value;
        else if (event.type === "thinking") view.thinking = event.value;
        else if (event.type === "tool-start") view.steps.push({ id: event.id, label: describeCall(event.name, event.arguments), status: "running", error: "" });
        else if (event.type === "tool-end") {
          const step = view.steps.find((item) => item.id === event.id);
          if (step) {
            step.status = event.ok ? "ok" : "error";
            step.error = event.ok ? "" : resultError(event.content);
          }
          if (event.ok && MUTATING_TOOLS.has(event.name)) changed = true;
        }
        scrollToBottom();
      },
    });
  } catch (error) {
    if (error?.name === "AbortError") view.error = "요청을 중지했습니다.";
    else view.error = error?.message || "AI 어시스턴트 요청 중 오류가 발생했습니다.";
    // 중단된 요청이 남긴 도구 호출 기록은 다음 요청을 헷갈리게 하므로 사용자 메시지까지 함께 정리한다.
    const lastUser = history.map((item) => item.role).lastIndexOf("user");
    if (lastUser >= 0 && history.slice(lastUser + 1).every((item) => item.role !== "assistant" || item.tool_calls)) {
      history.push({ role: "assistant", content: `(요청이 완료되지 않았습니다: ${view.error})` });
    }
  } finally {
    view.streaming = false;
    view.thinking = "";
    if (changed) view.undo = snapshot;
    busy.value = false;
    controller = null;
    if (pendingConfirm.value) {
      pendingConfirm.value.resolve(false);
      pendingConfirm.value = null;
    }
    scrollToBottom();
    nextTick(() => inputRef.value?.focus());
  }
}

function stop() {
  controller?.abort();
  if (pendingConfirm.value) {
    pendingConfirm.value.resolve(false);
    pendingConfirm.value = null;
  }
}

function answerConfirm(value) {
  pendingConfirm.value?.resolve(value);
  pendingConfirm.value = null;
}

function undo(item) {
  const result = props.context.restore(item.undo);
  if (!result.ok) {
    item.error = result.message;
    return;
  }
  item.undone = true;
  history.push({ role: "user", content: "(사용자가 방금 요청으로 바뀐 편집 내용을 되돌렸습니다. 이전 상태 기준으로 계속하세요.)" });
  history.push({ role: "assistant", content: "알겠습니다. 되돌린 상태를 기준으로 작업하겠습니다." });
}

function resetConversation() {
  if (busy.value) return;
  history = [];
  items.value = [];
  nextTick(() => inputRef.value?.focus());
}

function handleKeydown(event) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}

// 모델이 쓴 간단한 마크다운(굵게, 코드, 목록)만 안전하게 표시한다. 먼저 HTML을 이스케이프한다.
function inline(text) {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");
}

// 줄 단위로 문단·글머리 목록·번호 목록을 나눠 읽기 쉽게 만든다.
function renderText(value) {
  const escaped = String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const html = [];
  let list = null; // { tag, items }
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) html.push(`<${list.tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (const raw of escaped.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^(?:[-*•])\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (!line) {
      flushParagraph();
      flushList();
    } else if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? "ul" : "ol";
      if (list?.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((bullet ?? numbered)[1]);
    } else if (heading) {
      flushParagraph();
      flushList();
      html.push(`<p class="assistant-heading">${inline(heading[1])}</p>`);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return html.join("");
}

function stepSummary(item) {
  const failed = item.steps.filter((step) => step.status === "error").length;
  const running = item.steps.some((step) => step.status === "running");
  if (running) return `작업 중 · ${item.steps.length}개`;
  return `작업 ${item.steps.length - failed}개 완료${failed ? ` · 실패 ${failed}개` : ""}`;
}

function handleEscape(event) {
  if (event.key === "Escape" && props.open && !pendingConfirm.value) {
    if (busy.value) stop();
    else emit("close");
  }
}
onMounted(() => window.addEventListener("keydown", handleEscape));
onUnmounted(() => {
  window.removeEventListener("keydown", handleEscape);
  controller?.abort();
});
</script>

<template>
  <aside v-show="open" class="assistant-panel" role="complementary" aria-label="AI 어시스턴트">
    <header class="assistant-header">
      <div class="assistant-title">
        <span class="assistant-mark" aria-hidden="true">✦</span>
        <div>
          <strong>AI 어시스턴트</strong>
          <small v-if="status?.enabled">사내 AI{{ status.model ? ` · ${status.model}` : "" }}</small>
        </div>
      </div>
      <div class="assistant-header-actions">
        <button type="button" title="새 대화" aria-label="새 대화" :disabled="busy || !items.length" @click="resetConversation">새 대화</button>
        <button type="button" class="assistant-close" title="닫기 (Esc)" aria-label="AI 어시스턴트 닫기" @click="emit('close')">×</button>
      </div>
    </header>

    <div ref="listRef" class="assistant-body" aria-live="polite">
      <div v-if="statusError" class="assistant-notice error">
        {{ statusError }}
        <button type="button" @click="loadStatus">다시 확인</button>
      </div>
      <div v-else-if="status && !status.enabled" class="assistant-notice">
        <strong>AI 어시스턴트를 사용할 수 없습니다.</strong>
        <p v-if="!status.configured">사내 AI 서버가 설정되지 않았습니다.</p>
        <p v-else>관리자가 AI 어시스턴트를 꺼 두었습니다.</p>
        <p>{{ isAdmin ? "상단의 리포트 설정 › 사내 AI에서 설정해 주세요." : "관리자에게 리포트 설정 › 사내 AI 설정을 요청해 주세요." }}</p>
      </div>

      <div v-if="ready && !items.length" class="assistant-welcome">
        <p><strong>{{ authUser.name }}님, 무엇을 도와드릴까요?</strong></p>
        <p>양식 만들기, 요소 편집, 표·차트 구성, DB 데이터 연결, 용지·머리글·바닥글, 자동 생성 일정과 메일 설정까지 말로 요청할 수 있습니다.</p>
        <div class="assistant-suggestions">
          <button v-for="suggestion in SUGGESTIONS" :key="suggestion" type="button" @click="send(suggestion)">{{ suggestion }}</button>
        </div>
      </div>

      <template v-for="(item, index) in items" :key="index">
        <div v-if="item.role === 'user'" class="assistant-message user">{{ item.text }}</div>
        <div v-else class="assistant-message bot">
          <div class="assistant-bot-label"><span aria-hidden="true">✦</span>AI 어시스턴트</div>
          <!-- 작업 중에는 펼쳐 진행을 보여 주고, 끝나면 접어 답변을 먼저 읽게 한다 -->
          <details v-if="item.steps.length" class="assistant-steps" :class="{ failed: item.steps.some((step) => step.status === 'error') }" :open="item.streaming">
            <summary>{{ stepSummary(item) }}</summary>
            <ul>
              <li v-for="step in item.steps" :key="step.id" :class="step.status">
                <span class="assistant-step-icon" aria-hidden="true">{{ step.status === "ok" ? "✓" : step.status === "error" ? "!" : "…" }}</span>
                <span>{{ step.label }}<small v-if="step.error">{{ step.error }}</small></span>
              </li>
            </ul>
          </details>
          <!-- eslint-disable-next-line vue/no-v-html -- renderText가 HTML을 먼저 이스케이프한다 -->
          <div v-if="item.text" class="assistant-text" v-html="renderText(item.text)"></div>
          <p v-if="item.streaming && !item.text" class="assistant-typing">
            <span class="assistant-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            {{ item.thinking ? "생각하는 중" : item.steps.some((step) => step.status === "running") ? "작업하는 중" : "응답을 준비하는 중" }}
          </p>
          <p v-if="item.error" class="assistant-error" role="alert">{{ item.error }}</p>
          <div v-if="index === lastUndoIndex && !busy" class="assistant-undo">
            <button type="button" title="양식 저장·일정·메일처럼 서버에 저장된 변경은 되돌리지 않습니다." @click="undo(item)">↶ 이 요청 전 상태로 되돌리기</button>
          </div>
          <p v-else-if="item.undone" class="assistant-undone">편집 내용을 되돌렸습니다.</p>
        </div>
      </template>

      <div v-if="pendingConfirm" class="assistant-confirm" role="alertdialog" aria-label="작업 확인">
        <p>{{ pendingConfirm.message }}</p>
        <div>
          <button type="button" class="danger" @click="answerConfirm(true)">진행</button>
          <button type="button" @click="answerConfirm(false)">취소</button>
        </div>
      </div>
    </div>

    <form class="assistant-input" @submit.prevent="send()">
      <textarea
        ref="inputRef"
        v-model="input"
        rows="2"
        maxlength="4000"
        :disabled="!ready"
        :placeholder="ready ? '요청을 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)' : '사용할 수 없습니다'"
        @keydown="handleKeydown"
      ></textarea>
      <button v-if="busy" type="button" class="assistant-stop" @click="stop">중지</button>
      <button v-else type="submit" class="assistant-send" :disabled="!ready || !input.trim()">보내기</button>
    </form>
    <p class="assistant-footnote">AI가 바꾼 내용은 양식을 저장해야 반영됩니다. 결과를 꼭 확인해 주세요.</p>
  </aside>
</template>

<style scoped>
.assistant-panel {
  position: fixed;
  top: 70px;
  right: 16px;
  bottom: 16px;
  z-index: 15;
  display: flex;
  width: min(460px, calc(100vw - 32px));
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #d5dbe6;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 20px 56px #0b162b3d;
  color: #1f2633;
  font-size: 13px;
}

/* ---------- 머리글 ---------- */

.assistant-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  background: #142b49;
  color: #fff;
}

.assistant-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.assistant-title div {
  display: grid;
  gap: 1px;
  min-width: 0;
}

.assistant-title strong {
  font-size: 14px;
}

.assistant-title small {
  overflow: hidden;
  color: #b8c7dd;
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-mark {
  display: grid;
  width: 32px;
  height: 32px;
  flex: none;
  place-items: center;
  border-radius: 9px;
  background: linear-gradient(135deg, #4f8cff, #8a5cff);
  font-size: 16px;
}

.assistant-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.assistant-header-actions button {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #34557f;
  border-radius: 6px;
  background: transparent;
  color: #d6e2f3;
  cursor: pointer;
  font-size: 12px;
}

.assistant-header-actions button:hover:not(:disabled) {
  background: #1d3a60;
}

.assistant-header-actions button:disabled {
  opacity: 0.45;
  cursor: default;
}

.assistant-header-actions .assistant-close {
  width: 28px;
  padding: 0;
  font-size: 18px;
  line-height: 1;
}

/* ---------- 대화 영역 ---------- */

.assistant-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  padding: 18px 16px;
  background: #f3f5f9;
}

.assistant-notice {
  padding: 12px 14px;
  border: 1px solid #f0d9a8;
  border-radius: 10px;
  background: #fff8e8;
  color: #6b4e12;
  line-height: 1.6;
}

.assistant-notice.error {
  border-color: #f3c2bd;
  background: #fff1f0;
  color: #9b2c22;
}

.assistant-notice p {
  margin: 4px 0 0;
}

.assistant-notice button {
  margin-left: 6px;
}

.assistant-welcome {
  color: #3d4659;
  line-height: 1.65;
}

.assistant-welcome p {
  margin: 0 0 10px;
}

.assistant-welcome p:first-child {
  color: #1f2633;
  font-size: 14px;
}

.assistant-suggestions {
  display: grid;
  gap: 8px;
  margin-top: 4px;
}

.assistant-suggestions button {
  padding: 10px 12px;
  border: 1px solid #d5dbe6;
  border-radius: 10px;
  background: #fff;
  color: #24324a;
  cursor: pointer;
  font-size: 12.5px;
  line-height: 1.5;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}

.assistant-suggestions button:hover {
  border-color: #4f8cff;
  background: #f1f6ff;
}

/* ---------- 말풍선 ---------- */

.assistant-message {
  line-height: 1.65;
  word-break: keep-all;
  overflow-wrap: anywhere;
}

.assistant-message.user {
  align-self: flex-end;
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 16px 16px 4px 16px;
  background: #2f6fe4;
  color: #fff;
  white-space: pre-wrap;
}

.assistant-message.bot {
  align-self: stretch;
  padding: 12px 14px 14px;
  border: 1px solid #e3e8f0;
  border-radius: 4px 16px 16px 16px;
  background: #fff;
  box-shadow: 0 1px 2px #0b162b0d;
}

.assistant-bot-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  color: #5b6475;
  font-size: 11.5px;
  font-weight: 600;
}

.assistant-bot-label span {
  color: #6a5cff;
}

.assistant-text :deep(p) {
  margin: 0 0 10px;
}

.assistant-text :deep(p:last-child),
.assistant-text :deep(ul:last-child),
.assistant-text :deep(ol:last-child) {
  margin-bottom: 0;
}

.assistant-text :deep(.assistant-heading) {
  margin-top: 4px;
  font-weight: 700;
}

.assistant-text :deep(ul),
.assistant-text :deep(ol) {
  display: grid;
  gap: 4px;
  margin: 0 0 10px;
  padding-left: 20px;
}

.assistant-text :deep(li::marker) {
  color: #6a7a96;
}

.assistant-text :deep(strong) {
  color: #13203a;
}

.assistant-text :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: #eef1f6;
  font-size: 11.5px;
}

/* 작업 단계: 끝나면 한 줄로 접힌다 */
.assistant-steps {
  margin: 0 0 10px;
  border: 1px solid #e3e8f0;
  border-radius: 8px;
  background: #f8fafc;
  font-size: 12px;
}

.assistant-steps summary {
  padding: 7px 10px;
  color: #3d6b4f;
  cursor: pointer;
  font-weight: 600;
  list-style-position: inside;
}

.assistant-steps.failed summary {
  color: #b42318;
}

.assistant-steps ul {
  display: grid;
  gap: 5px;
  margin: 0;
  padding: 2px 10px 9px;
  list-style: none;
}

.assistant-steps li {
  display: flex;
  gap: 7px;
  color: #4a5368;
  line-height: 1.5;
}

.assistant-steps li > span:last-child {
  display: grid;
}

.assistant-steps li small {
  color: #b42318;
}

.assistant-step-icon {
  display: inline-grid;
  width: 16px;
  height: 16px;
  flex: none;
  place-items: center;
  margin-top: 1px;
  border-radius: 50%;
  background: #e7ecf4;
  font-size: 10px;
  font-weight: 700;
}

.assistant-steps li.ok .assistant-step-icon {
  background: #dff3e6;
  color: #1c7a43;
}

.assistant-steps li.error .assistant-step-icon {
  background: #fde3e1;
  color: #b42318;
}

.assistant-typing {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: #6b7385;
  font-size: 12px;
}

.assistant-dots {
  display: inline-flex;
  gap: 3px;
}

.assistant-dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8a95a8;
  animation: assistant-blink 1.2s infinite ease-in-out;
}

.assistant-dots i:nth-child(2) {
  animation-delay: 0.15s;
}

.assistant-dots i:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes assistant-blink {
  0%, 80%, 100% { opacity: 0.25; }
  40% { opacity: 1; }
}

.assistant-error {
  margin: 8px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fff1f0;
  color: #b42318;
  font-size: 12px;
}

.assistant-undo {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #eef1f6;
}

.assistant-undo button {
  padding: 5px 11px;
  border: 1px solid #d5dbe6;
  border-radius: 8px;
  background: #fff;
  color: #2f3a52;
  cursor: pointer;
  font-size: 12px;
}

.assistant-undo button:hover {
  border-color: #9aa8bf;
  background: #f6f8fb;
}

.assistant-undone {
  margin: 10px 0 0;
  color: #6b7385;
  font-size: 12px;
}

.assistant-confirm {
  padding: 12px 14px;
  border: 1px solid #f3c2bd;
  border-radius: 12px;
  background: #fff;
  line-height: 1.6;
}

.assistant-confirm p {
  margin: 0 0 10px;
}

.assistant-confirm div {
  display: flex;
  gap: 8px;
}

.assistant-confirm button {
  padding: 6px 14px;
  border: 1px solid #c9d0dc;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
}

.assistant-confirm button.danger {
  border-color: #b42318;
  background: #b42318;
  color: #fff;
}

/* ---------- 입력 ---------- */

.assistant-input {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 14px 6px;
  border-top: 1px solid #e3e7ef;
  background: #fff;
}

.assistant-input textarea {
  flex: 1;
  min-height: 46px;
  max-height: 160px;
  padding: 10px 12px;
  border: 1px solid #c9d0dc;
  border-radius: 10px;
  resize: vertical;
  font-size: 13px;
  line-height: 1.5;
}

.assistant-input textarea:focus {
  border-color: #4f8cff;
  outline: 3px solid #4f8cff26;
}

.assistant-send,
.assistant-stop {
  height: 40px;
  padding: 0 16px;
  border: 0;
  border-radius: 10px;
  background: #2f6fe4;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}

.assistant-send:hover:not(:disabled) {
  background: #2560cc;
}

.assistant-send:disabled {
  background: #aab6c9;
  cursor: default;
}

.assistant-stop {
  background: #5b6475;
}

.assistant-footnote {
  margin: 0;
  padding: 0 14px 10px;
  color: #8a93a5;
  font-size: 11px;
}
</style>
