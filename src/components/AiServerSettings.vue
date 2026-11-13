<script setup>
import { computed, onMounted, ref } from "vue";

const settings = ref(null);
const draft = ref(null);
const loading = ref(true);
const busy = ref("");
const message = ref("");
const failed = ref(false);
const server = ref(null); // { version, models, recommendedAssistantModel }

const toolModels = computed(() => (server.value?.models ?? []).filter((item) => item.tools));
const visionModels = computed(() => (server.value?.models ?? []).filter((item) => item.vision));
const dirty = computed(() => Boolean(draft.value && settings.value) && JSON.stringify(draft.value) !== JSON.stringify(settings.value));

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
  });
  let result = {};
  try {
    result = await response.json();
  } catch {
    // 본문이 없으면 상태 코드로 안내한다.
  }
  if (!response.ok) throw new Error(result.error || `요청에 실패했습니다 (${response.status}).`);
  return result;
}

function show(text, error = false) {
  message.value = text;
  failed.value = error;
}

async function load() {
  loading.value = true;
  try {
    const result = await request("/api/ai-settings");
    settings.value = result.settings;
    draft.value = { ...result.settings };
    if (result.settings.ollamaBaseUrl) await testConnection(true);
  } catch (error) {
    show(error.message || "사내 AI 설정을 불러오지 못했습니다.", true);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function testConnection(silent = false) {
  if (busy.value) return;
  busy.value = "test";
  if (!silent) show("");
  try {
    server.value = await request("/api/ai-settings/test", { method: "POST", body: JSON.stringify({ ollamaBaseUrl: draft.value.ollamaBaseUrl }) });
    if (!silent) show(`연결했습니다. Ollama ${server.value.version || ""} · 모델 ${server.value.models.length}개`);
  } catch (error) {
    server.value = null;
    show(error.message || "사내 AI 서버에 연결하지 못했습니다.", true);
  } finally {
    busy.value = "";
  }
}

async function save() {
  if (busy.value) return;
  busy.value = "save";
  show("");
  try {
    const result = await request("/api/ai-settings", { method: "PUT", body: JSON.stringify(draft.value) });
    settings.value = result.settings;
    draft.value = { ...result.settings };
    show("사내 AI 설정을 저장했습니다. 에디터를 새로 고치면 어시스턴트에 반영됩니다.");
  } catch (error) {
    show(error.message || "사내 AI 설정을 저장하지 못했습니다.", true);
  } finally {
    busy.value = "";
  }
}

function modelOptionLabel(item, recommended) {
  const tags = [item.vision && "이미지", item.tools && "도구", item.thinking && "추론"].filter(Boolean).join("·");
  return `${item.id}${item.description ? ` — ${item.description}` : ""}${tags ? ` [${tags}]` : ""}${item.id === recommended ? " (권장)" : ""}`;
}
</script>

<template>
  <div class="ai-server-settings">
    <h3>사내 AI 서버 (Ollama)</h3>
    <p>양식 가져오기의 문서 분석과 에디터의 AI 어시스턴트가 이 서버를 사용합니다. 파일과 대화는 외부로 나가지 않으며 사용료가 없습니다.</p>
    <p v-if="message" :class="['ai-key-message', { error: failed }]" role="status">{{ message }}</p>
    <p v-if="loading">설정을 불러오는 중입니다.</p>
    <form v-else-if="draft" class="ai-server-form" @submit.prevent="save">
      <label for="ai-server-url">서버 주소</label>
      <div class="ai-server-url-row">
        <input id="ai-server-url" v-model.trim="draft.ollamaBaseUrl" type="url" placeholder="http://192.168.0.106:11434" autocomplete="off" :disabled="Boolean(busy)" />
        <button type="button" class="dsm-button" :disabled="Boolean(busy) || !draft.ollamaBaseUrl" @click="testConnection()">{{ busy === "test" ? "확인 중..." : "연결 확인" }}</button>
      </div>
      <small>비워 두고 저장하면 사내 AI를 사용하지 않습니다. 리포트 서버에서 이 주소로 접속할 수 있어야 합니다.</small>

      <fieldset class="ai-server-group">
        <legend>AI 어시스턴트</legend>
        <label class="ai-server-check"><input v-model="draft.assistantEnabled" type="checkbox" :disabled="Boolean(busy)" />에디터에 AI 어시스턴트 사용</label>
        <label for="ai-assistant-model">어시스턴트 모델</label>
        <select id="ai-assistant-model" v-model="draft.assistantModel" :disabled="Boolean(busy) || !server">
          <option value="">자동 선택{{ server?.recommendedAssistantModel ? ` (현재: ${server.recommendedAssistantModel})` : "" }}</option>
          <option v-if="draft.assistantModel && !toolModels.some((item) => item.id === draft.assistantModel)" :value="draft.assistantModel">{{ draft.assistantModel }} (서버에서 찾을 수 없음)</option>
          <option v-for="item in toolModels" :key="item.id" :value="item.id">{{ modelOptionLabel(item, server?.recommendedAssistantModel) }}</option>
        </select>
        <small v-if="!server">연결 확인을 누르면 도구 호출을 지원하는 모델 목록이 표시됩니다.</small>
        <small v-else-if="!toolModels.length" class="ai-server-warning">도구 호출을 지원하는 모델이 없습니다. qwen3 계열처럼 tools를 지원하는 모델을 서버에 설치해 주세요.</small>
        <small v-else>어시스턴트는 양식 편집 기능을 도구로 호출하므로 [도구] 표시가 있는 모델만 쓸 수 있습니다. 27B 이상 Qwen 계열을 권장합니다.</small>
        <label class="ai-server-check"><input v-model="draft.assistantThink" type="checkbox" :disabled="Boolean(busy)" />추론 모드 사용 (복잡한 요청에 더 정확하지만 응답이 느려집니다)</label>
      </fieldset>

      <fieldset class="ai-server-group">
        <legend>문서 분석 (양식 가져오기)</legend>
        <label for="ai-import-model">기본 모델</label>
        <select id="ai-import-model" v-model="draft.importModel" :disabled="Boolean(busy) || !server">
          <option value="">자동 (Qwen 3.5 이상 계열 우선)</option>
          <option v-if="draft.importModel && !visionModels.some((item) => item.id === draft.importModel)" :value="draft.importModel">{{ draft.importModel }} (서버에서 찾을 수 없음)</option>
          <option v-for="item in visionModels" :key="item.id" :value="item.id">{{ modelOptionLabel(item) }}</option>
        </select>
        <small>양식 가져오기의 모델 목록에서 맨 위에 표시되어 기본으로 선택됩니다. 이미지를 읽을 수 있는 모델만 표시합니다.</small>
      </fieldset>

      <div class="ai-key-actions">
        <button type="submit" class="dsm-button dsm-button-primary" :disabled="Boolean(busy) || !dirty">{{ busy === "save" ? "저장 중..." : "설정 저장" }}</button>
        <button type="button" class="dsm-button" :disabled="Boolean(busy) || !dirty" @click="draft = { ...settings }; message = ''">되돌리기</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
/* 리포트 설정의 다른 탭(AI API 키)과 같은 여백·글자 크기 */
.ai-server-settings {
  max-width: 760px;
  padding: 24px;
  color: #333e55;
}

.ai-server-settings h3 {
  margin: 0 0 10px;
  font-size: 16px;
}

.ai-server-settings > p {
  margin: 0 0 10px;
  color: #68748a;
  font-size: 12px;
  line-height: 1.6;
}

.ai-server-settings .ai-key-message {
  color: #287348;
}

.ai-server-settings .ai-key-message.error {
  color: #a53e44;
}

.ai-server-form {
  display: grid;
  gap: 6px;
  max-width: 720px;
}

.ai-server-form > label,
.ai-server-group > label:not(.ai-server-check) {
  font-weight: 600;
  font-size: 13px;
}

.ai-server-url-row {
  display: flex;
  gap: 8px;
}

.ai-server-url-row input {
  flex: 1;
  min-width: 0;
}

.ai-server-form input[type="url"],
.ai-server-form select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid #c9d0dc;
  border-radius: 4px;
  background: #fff;
}

.ai-server-form small {
  color: #6b7385;
  font-size: 12px;
}

.ai-server-form .ai-server-warning {
  color: #b42318;
}

.ai-server-group {
  display: grid;
  gap: 6px;
  margin: 10px 0 0;
  padding: 10px 12px 12px;
  border: 1px solid #e3e7ef;
  border-radius: 6px;
}

.ai-server-group legend {
  padding: 0 4px;
  font-weight: 700;
  font-size: 13px;
}

.ai-server-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
</style>
