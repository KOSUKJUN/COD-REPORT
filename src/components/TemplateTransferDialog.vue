<script setup>
import { computed, onUnmounted, ref, watch } from "vue";
import { importTemplatePages } from "../template-transfer.js";
import { getModelDescription } from "../ai-model-description.js";
import { fileToPageImages } from "../ai-page-images.js";

const emit = defineEmits(["close", "import"]);
const mode = ref("file");
const provider = ref("ollama");
const models = ref([]);
const model = ref("");
const keyStatus = ref(null);
const ollamaHost = ref("");
const loadingKeyStatus = ref(false);
const consent = ref(false);
const file = ref(null);
const busy = ref(false);
const progress = ref("");
const loadingModels = ref(false);
const error = ref("");
const notice = ref("");
const selectedModel = computed(() => models.value.find((item) => item.id === model.value));
const modelDescription = computed(() => getModelDescription(provider.value, model.value));
const isOllama = computed(() => provider.value === "ollama");
const missingSetupMessage = computed(() => isOllama.value
  ? "사내 AI 서버 주소가 설정되지 않았습니다. 관리자에게 리포트 설정 › 사내 AI에서 서버 주소 설정을 요청해 주세요."
  : "API 키가 없습니다. 키를 발급받은 후 관리자에게 리포트 설정에서 등록해 달라고 요청해 주세요.");
const consentMessage = computed(() => isOllama.value
  ? `선택한 파일 전체가 사내 AI 서버${ollamaHost.value ? `(${ollamaHost.value})` : ""}로 전송되는 것에 동의합니다.`
  : "선택한 파일 전체가 외부 AI 제공자에게 전송되는 것에 동의합니다.");
let requestVersion = 0;
let abortController = null;

watch([provider, mode], async () => {
  requestVersion += 1;
  models.value = [];
  model.value = "";
  error.value = "";
  notice.value = "";
  keyStatus.value = null;
  ollamaHost.value = "";
  consent.value = false;
  loadingKeyStatus.value = false;
  if (mode.value !== "ai") return;
  const version = requestVersion;
  loadingKeyStatus.value = true;
  try {
    const response = await fetch("/api/ai-keys", { headers: { Accept: "application/json" } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "API 키 상태를 확인하지 못했습니다.");
    const selected = result.providers?.find((item) => item.provider === provider.value);
    if (typeof selected?.configured !== "boolean") throw new Error("API 키 상태 응답 형식이 올바르지 않습니다.");
    if (version === requestVersion) {
      keyStatus.value = selected.configured;
      ollamaHost.value = typeof selected.host === "string" ? selected.host : "";
    }
  } catch (caught) {
    if (version === requestVersion) error.value = caught.message || "API 키 상태를 확인하지 못했습니다.";
  } finally {
    if (version === requestVersion) loadingKeyStatus.value = false;
  }
});
onUnmounted(() => {
  requestVersion += 1;
  abortController?.abort();
});

async function loadModels() {
  if (!keyStatus.value) {
    error.value = missingSetupMessage.value;
    return;
  }
  const version = ++requestVersion;
  models.value = [];
  model.value = "";
  error.value = "";
  loadingModels.value = true;
  try {
    const response = await fetch("/api/templates/ai-models", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ provider: provider.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `모델 목록을 불러오지 못했습니다 (${response.status}).`);
    if (!Array.isArray(result.models) || !result.models.length ||
        result.models.some((item) => typeof item.id !== "string" || typeof item.label !== "string" ||
          (item.description !== undefined && typeof item.description !== "string"))) {
      throw new Error("모델 목록 응답 형식이 올바르지 않습니다.");
    }
    if (version !== requestVersion) return;
    models.value = result.models;
    model.value = result.models[0].id;
  } catch (caught) {
    if (version === requestVersion) error.value = caught instanceof SyntaxError ? "모델 목록 응답을 읽을 수 없습니다." : caught.message;
  } finally {
    if (version === requestVersion) loadingModels.value = false;
  }
}

function chooseFile(event) {
  file.value = event.target.files?.[0] ?? null;
  error.value = "";
  notice.value = "";
}

async function postImport(body, signal) {
  const response = await fetch("/api/templates/ai-import", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`서버 응답을 읽을 수 없습니다 (${response.status}).`);
  }
  if (!response.ok) throw new Error(result.error || `AI 변환에 실패했습니다 (${response.status}).`);
  return result;
}

// 사내 서버는 페이지마다 따로 요청해 진행 상황을 보여 주고, 긴 작업 중에도 취소할 수 있게 한다.
async function convertWithOllama(mimeType, signal) {
  progress.value = "페이지 이미지를 준비하는 중...";
  const images = await fileToPageImages(file.value, mimeType, (page, total) => {
    progress.value = `페이지 이미지를 준비하는 중 (${page}/${total})`;
  });
  const pages = [];
  let skipped = 0;
  for (const [index, image] of images.entries()) {
    if (signal.aborted) throw new DOMException("취소됨", "AbortError");
    progress.value = `AI 분석 중 (${index + 1}/${images.length}페이지)`;
    try {
      const result = await postImport({ provider: "ollama", model: model.value, ...image, consent: consent.value }, signal);
      pages.push(...result.pages);
      skipped += Number(result.skipped) || 0;
    } catch (caught) {
      if (caught?.name === "AbortError") throw caught;
      throw new Error(images.length > 1 ? `${index + 1}페이지 분석에 실패했습니다. ${caught.message}` : caught.message);
    }
  }
  return { pages, skipped };
}

async function submit() {
  if (busy.value) return;
  error.value = "";
  notice.value = "";
  try {
    if (!file.value) throw new Error("가져올 파일을 선택해 주세요.");
    if (mode.value === "file") {
      if (file.value.size > 10 * 1024 * 1024) throw new Error("양식 파일은 10MB 이하여야 합니다.");
      const pages = importTemplatePages(JSON.parse(await file.value.text()));
      emit("import", pages);
      return;
    }
    if (!consent.value) throw new Error(isOllama.value ? "사내 AI 서버로 파일을 전송하는 데 동의해 주세요." : "외부 AI 제공자에게 파일을 전송하는 데 동의해 주세요.");
    const sizeLimit = isOllama.value ? 30 : 9;
    if (file.value.size > sizeLimit * 1024 * 1024) throw new Error(`AI 변환 파일은 ${sizeLimit}MB 이하여야 합니다.`);
    const mimeTypes = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
    const mimeType = mimeTypes[file.value.name.split(".").pop().toLowerCase()];
    if (!mimeType) throw new Error("PDF, PNG 또는 JPG 파일을 선택해 주세요. DOCX와 HWPX는 PDF로 변환해 주세요.");
    if (!keyStatus.value) throw new Error(missingSetupMessage.value);
    if (!model.value || !models.value.some((item) => item.id === model.value)) throw new Error("모델 목록을 불러온 후 모델을 선택해 주세요.");
    busy.value = true;
    if (isOllama.value) {
      abortController = new AbortController();
      const { pages, skipped } = await convertWithOllama(mimeType, abortController.signal);
      const imported = importTemplatePages({ format: "cod-report-template", version: 1, pages });
      if (skipped) window.alert(`AI가 인식한 요소 중 ${skipped}개는 형식이 올바르지 않아 제외했습니다. 가져온 페이지를 원본과 비교해 확인해 주세요.`);
      emit("import", imported);
      return;
    }
    const bytes = new Uint8Array(await file.value.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    }
    const result = await postImport({ provider: provider.value, model: model.value.trim(), mimeType, data: btoa(binary), consent: consent.value });
    const pages = importTemplatePages({ format: "cod-report-template", version: 1, pages: result.pages });
    emit("import", pages);
  } catch (caught) {
    if (caught?.name === "AbortError") notice.value = "AI 분석을 취소했습니다.";
    else error.value = caught instanceof SyntaxError ? "양식 파일의 JSON 형식이 올바르지 않습니다." : caught.message;
  } finally {
    busy.value = false;
    progress.value = "";
    abortController = null;
  }
}

function cancel() {
  if (busy.value && abortController) abortController.abort();
  else if (!busy.value) emit("close");
}
</script>

<template>
  <div class="modal-backdrop">
    <section class="editor-modal transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-title">
      <header class="editor-modal-header popup-titlebar">
        <div><p class="portal-eyebrow">IMPORT TEMPLATE</p><h2 id="transfer-title">양식 가져오기</h2></div>
        <button class="modal-close-button" type="button" aria-label="닫기" :disabled="busy" @click="emit('close')">×</button>
      </header>
      <form class="transfer-form" @submit.prevent="submit">
        <p>현재 양식은 유지하고 가져온 내용을 새 페이지로 추가합니다. 추가 후 양식을 저장해 주세요.</p>
        <label>가져오기 방식
          <select v-model="mode" :disabled="busy || loadingModels" @change="file = null; error = ''">
            <option value="file">내보낸 양식 파일</option>
            <option value="ai">AI로 문서 분석</option>
          </select>
        </label>
        <label>파일
          <input :key="mode" type="file" :accept="mode === 'file' ? '.json,application/json' : '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg'" :disabled="busy" @change="chooseFile" />
        </label>
        <template v-if="mode === 'ai'">
          <p v-if="isOllama">PDF(최대 30페이지), PNG, JPG 최대 30MB. PDF는 브라우저에서 페이지별 이미지로 바꿔 한 페이지씩 분석하며, 페이지당 수십 초~수 분이 걸릴 수 있습니다. DOCX와 HWPX는 먼저 PDF로 변환해 주세요. 원본 이미지 삽입은 지원하지 않으며, 복잡한 서식은 원본과 다를 수 있으므로 결과를 확인해 주세요.</p>
          <p v-else>PDF, PNG, JPG 최대 9MB. DOCX와 HWPX는 먼저 PDF로 변환해 주세요. AI가 텍스트·표·도형·차트로 분석합니다. 원본 이미지 삽입은 지원하지 않으며, 복잡한 서식은 원본과 다를 수 있으므로 결과를 확인해 주세요.</p>
          <label>AI 제공자
            <select v-model="provider" :disabled="busy || loadingModels">
              <option value="ollama">사내 AI 서버 (Ollama)</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic Claude</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </label>
          <p v-if="loadingKeyStatus">{{ isOllama ? "사내 AI 서버 설정을 확인하는 중입니다." : "API 키 등록 상태를 확인하는 중입니다." }}</p>
          <p v-else-if="keyStatus === false" class="transfer-error" role="alert">{{ missingSetupMessage }}</p>
          <p v-else-if="keyStatus === true">{{ isOllama ? `사내 AI 서버(${ollamaHost})를 사용합니다. 외부로 전송되지 않으며 사용 요금이 없습니다.` : "리포트 설정에 등록된 API 키를 사용합니다." }}</p>
          <button type="button" class="modal-secondary-button" :disabled="busy || loadingModels || loadingKeyStatus || keyStatus !== true" @click="loadModels">{{ loadingModels ? "모델 목록 불러오는 중..." : "사용 가능한 모델 불러오기" }}</button>
          <label>모델
            <select v-model="model" required :disabled="busy || loadingModels || !models.length">
              <option value="" disabled>모델 목록을 불러오세요</option>
              <option v-for="item in models" :key="item.id" :value="item.id">{{ item.label === item.id ? item.id : `${item.label} (${item.id})` }}</option>
            </select>
          </label>
          <div v-if="selectedModel" class="transfer-model-description" aria-live="polite">
            <strong>선택한 모델 안내</strong>
            <p>{{ modelDescription || (isOllama ? "이 모델의 계열별 안내가 없습니다. 비전 모델이지만 문서 서식 변환 품질은 모델마다 다릅니다." : "이 모델의 계열별 안내가 없습니다. 제공자 문서에서 상세 정보를 확인해 주세요.") }}</p>
            <p v-if="selectedModel.description"><span>{{ isOllama ? "서버 정보:" : "제공자 설명:" }}</span> {{ selectedModel.description }}</p>
            <small>{{ isOllama ? "계열별 일반 안내이며, 실제 품질과 속도는 모델 크기와 서버 사양에 따라 다릅니다." : "계열별 일반 안내이며, 세부 기능과 가격은 모델 버전 및 제공자 정책에 따라 다릅니다." }}</small>
          </div>
          <p v-if="isOllama">사내 서버에 설치된 모델 중 이미지를 읽을 수 있는 모델만 표시하며, 문서 변환에 적합한 Qwen 3.5 이상 계열을 먼저 표시합니다. 외부로 요청을 넘기는 원격 모델은 제외합니다.</p>
          <template v-else>
            <p>제공자의 모델 목록을 기준으로 정렬합니다. Gemini는 출시일 정보가 없어 모델 버전순입니다. 일부 모델은 문서 분석을 지원하지 않을 수 있습니다.</p>
            <p>ChatGPT 등의 웹 로그인과 별도의 API 키가 필요합니다. 저장된 키는 호출 시 선택한 제공자에 전달되며 사용량에 따라 비용이 발생할 수 있습니다.</p>
          </template>
          <label class="transfer-consent"><input v-model="consent" type="checkbox" :disabled="busy" />{{ consentMessage }}</label>
        </template>
        <p v-if="progress" aria-live="polite">{{ progress }}</p>
        <p v-if="notice" role="status">{{ notice }}</p>
        <p v-if="error" class="transfer-error" role="alert">{{ error }}</p>
        <footer class="editor-modal-actions">
          <button type="button" class="modal-secondary-button" :disabled="busy && !isOllama" @click="cancel">{{ busy && isOllama ? "분석 취소" : "취소" }}</button>
          <button class="generate-report-button" type="submit" :disabled="busy || loadingModels">{{ busy ? "AI 분석 중..." : "새 페이지로 가져오기" }}</button>
        </footer>
      </form>
    </section>
  </div>
</template>
