<script setup>
import { onMounted, ref } from "vue";

const providers = [
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic Claude" },
  { id: "gemini", name: "Google Gemini" },
];
const configured = ref({});
const ollamaHost = ref("");
const keys = ref({ openai: "", anthropic: "", gemini: "" });
const busy = ref(false);
const loading = ref(true);
const statusReady = ref(false);
const message = ref("");
const failed = ref(false);
const confirming = ref("");

async function readStatus() {
  const response = await fetch("/api/ai-keys", { headers: { Accept: "application/json" } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "API 키 상태를 불러오지 못했습니다.");
  if (!Array.isArray(result.providers) || providers.some(({ id }) =>
    !result.providers.some((item) => item.provider === id && typeof item.configured === "boolean"))) {
    throw new Error("API 키 상태 응답 형식이 올바르지 않습니다.");
  }
  configured.value = Object.fromEntries(result.providers.map((item) => [item.provider, item.configured]));
  const ollama = result.providers.find((item) => item.provider === "ollama");
  ollamaHost.value = typeof ollama?.host === "string" ? ollama.host : "";
  statusReady.value = true;
}

async function loadStatus() {
  loading.value = true;
  message.value = "";
  try {
    await readStatus();
  } catch (error) {
    failed.value = true;
    message.value = error.message || "API 키 상태를 불러오지 못했습니다.";
  } finally {
    loading.value = false;
  }
}
onMounted(loadStatus);

async function changeKey(id, remove = false) {
  if (busy.value) return;
  if (!remove && !keys.value[id]) {
    failed.value = true;
    message.value = "저장할 API 키를 입력해 주세요.";
    return;
  }
  busy.value = true;
  message.value = "";
  try {
    const response = await fetch(`/api/ai-keys/${id}`, {
      method: remove ? "DELETE" : "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      ...(remove ? {} : { body: JSON.stringify({ apiKey: keys.value[id] }) }),
    });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || `API 키를 ${remove ? "삭제" : "저장"}하지 못했습니다.`);
    }
    keys.value[id] = "";
    confirming.value = "";
    configured.value = { ...configured.value, [id]: !remove };
    failed.value = false;
    message.value = remove ? "API 키를 삭제했습니다." : "API 키를 저장했습니다.";
  } catch (error) {
    failed.value = true;
    message.value = error.message || "API 키 처리 중 오류가 발생했습니다.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="ai-key-settings">
    <h3>AI API 키 관리</h3>
    <p>관리자가 등록한 키는 모든 에디터가 공유하며, 사용량에 따라 비용이 발생할 수 있습니다. 키는 암호화해 저장하며 다시 표시하지 않습니다.</p>
    <p>각 AI 제공자에서 API 키를 발급받아 등록하세요. 변경하려면 새 키를 입력하고 저장하세요.</p>
    <p v-if="message" :class="['ai-key-message', { error: failed }]" role="status">{{ message }}</p>
    <p v-if="loading">등록 상태를 불러오는 중입니다.</p>
    <button v-else-if="!statusReady" type="button" class="dsm-button" @click="loadStatus">상태 다시 불러오기</button>
    <div v-else class="ai-key-list">
      <form v-for="item in providers" :key="item.id" class="ai-key-card" @submit.prevent="changeKey(item.id)">
        <div class="ai-key-card-title">
          <strong>{{ item.name }}</strong>
          <span :class="{ configured: configured[item.id] }">{{ configured[item.id] ? "등록됨" : "미등록" }}</span>
        </div>
        <label :for="`ai-key-${item.id}`">새 API 키</label>
        <input :id="`ai-key-${item.id}`" v-model="keys[item.id]" type="password" autocomplete="off" maxlength="512" :disabled="busy" placeholder="발급받은 API 키 입력" />
        <div class="ai-key-actions">
          <button type="submit" class="dsm-button dsm-button-primary" :disabled="busy">키 저장</button>
          <button v-if="configured[item.id] && confirming !== item.id" type="button" class="dsm-button dsm-button-danger" :disabled="busy" @click="confirming = item.id">삭제</button>
          <template v-if="confirming === item.id">
            <span>키를 삭제하시겠습니까?</span>
            <button type="button" class="dsm-button dsm-button-danger" :disabled="busy" @click="changeKey(item.id, true)">삭제 확인</button>
            <button type="button" class="dsm-button" :disabled="busy" @click="confirming = ''">취소</button>
          </template>
        </div>
      </form>
      <div class="ai-key-card">
        <div class="ai-key-card-title">
          <strong>사내 AI 서버 (Ollama)</strong>
          <span :class="{ configured: configured.ollama }">{{ configured.ollama ? "연결 설정됨" : "미설정" }}</span>
        </div>
        <p v-if="configured.ollama">{{ ollamaHost }} 서버를 사용합니다. API 키가 필요 없고 파일이 외부로 전송되지 않습니다.</p>
        <p>서버 주소와 사용할 모델은 리포트 설정 › 사내 AI 탭에서 바꿀 수 있습니다.</p>
      </div>
    </div>
  </div>
</template>
