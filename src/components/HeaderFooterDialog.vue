<script setup>
// 머리글·바닥글 편집 (Word '머리글/바닥글 도구'에 해당)
import { computed, nextTick, ref } from "vue";
import ActionIcon from "./ActionIcon.vue";
import {
  FIELDS,
  FOOTER_GALLERY,
  HEADER_GALLERY,
  PAGE_NUMBER_FORMATS,
  normalizeHeaderFooter,
  resolveSlots,
} from "../header-footer.js";

const props = defineProps({
  config: { type: Object, default: null },
  initialTab: { type: String, default: "header" },
  title: { type: String, default: "" },
  date: { type: String, default: "" },
});
const emit = defineEmits(["apply", "close"]);

const draft = ref(normalizeHeaderFooter(JSON.parse(JSON.stringify(props.config ?? null))));
const tab = ref(["header", "footer", "options"].includes(props.initialTab) ? props.initialTab : "header");
const lastFocused = ref(null); // { key, align, element }

const capital = computed(() => (tab.value === "header" ? "Header" : "Footer"));
const rows = computed(() => {
  if (tab.value === "options") return [];
  const list = [{ key: tab.value, label: draft.value.differentFirstPage || draft.value.differentOddEven ? "기본 (홀수 페이지)" : "모든 페이지" }];
  if (draft.value.differentFirstPage) list.unshift({ key: `first${capital.value}`, label: "첫 페이지" });
  if (draft.value.differentOddEven) list.push({ key: `even${capital.value}`, label: "짝수 페이지" });
  return list;
});
const gallery = computed(() => (tab.value === "header" ? HEADER_GALLERY : FOOTER_GALLERY));

function rememberFocus(key, align, event) {
  lastFocused.value = { key, align, element: event.target };
}

// 커서 위치(없으면 마지막으로 누른 칸 끝)에 필드를 넣는다.
function insertField(token) {
  // 아직 누른 칸이 없으면 기본(모든 페이지) 줄의 가운데 칸에 넣는다.
  const target = lastFocused.value ?? { key: tab.value, align: "center" };
  const current = draft.value[target.key][target.align] ?? "";
  const element = target.element;
  const start = element && typeof element.selectionStart === "number" ? element.selectionStart : current.length;
  const end = element && typeof element.selectionEnd === "number" ? element.selectionEnd : current.length;
  draft.value[target.key][target.align] = current.slice(0, start) + token + current.slice(end);
  if (element) {
    nextTick(() => {
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  }
}

function useGallery(item) {
  draft.value[tab.value] = { ...item.slots };
}

function clearRow(key) {
  draft.value[key] = { left: "", center: "", right: "" };
}

// 미리보기: 첫 3페이지의 머리글·바닥글
const preview = computed(() =>
  [0, 1, 2].map((pageIndex) => ({
    pageIndex,
    header: resolveSlots(draft.value, "header", { pageIndex, pageCount: 3, title: props.title || "리포트 제목", date: props.date || "2026년 11월 7일" }),
    footer: resolveSlots(draft.value, "footer", { pageIndex, pageCount: 3, title: props.title || "리포트 제목", date: props.date || "2026년 11월 7일" }),
  })),
);

function apply() {
  emit("apply", JSON.parse(JSON.stringify(draft.value)));
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    event.stopPropagation();
    emit("close");
  }
}
</script>

<template>
  <div class="modal-backdrop" @keydown="handleKeydown">
    <section class="editor-modal hf-dialog" role="dialog" aria-modal="true" aria-labelledby="hf-dialog-title">
      <header class="chart-insert-header popup-titlebar">
        <div>
          <h2 id="hf-dialog-title">머리글 / 바닥글</h2>
          <p>모든 페이지 위·아래 여백에 표시됩니다. 필드를 넣으면 페이지 번호·날짜 등이 자동으로 바뀝니다.</p>
        </div>
        <button class="modal-close-button" type="button" aria-label="닫기" @click="emit('close')">×</button>
      </header>

      <div class="tm-tabs hf-tabs" role="tablist" aria-label="머리글/바닥글 설정">
        <button type="button" role="tab" :aria-selected="tab === 'header'" :class="{ 'tm-tab-active': tab === 'header' }" @click="tab = 'header'; lastFocused = null">머리글</button>
        <button type="button" role="tab" :aria-selected="tab === 'footer'" :class="{ 'tm-tab-active': tab === 'footer' }" @click="tab = 'footer'; lastFocused = null">바닥글</button>
        <button type="button" role="tab" :aria-selected="tab === 'options'" :class="{ 'tm-tab-active': tab === 'options' }" @click="tab = 'options'">페이지 번호 · 옵션</button>
      </div>

      <div class="hf-body">
        <template v-if="tab !== 'options'">
          <div class="hf-gallery" :aria-label="`${tab === 'header' ? '머리글' : '바닥글'} 기본 모양`">
            <span class="tm-section-label">기본 모양</span>
            <div class="hf-gallery-items">
              <button v-for="item in gallery" :key="item.id" type="button" class="hf-gallery-item" @click="useGallery(item)">
                <span class="hf-gallery-preview">
                  <i>{{ item.slots.left }}</i><i>{{ item.slots.center }}</i><i>{{ item.slots.right }}</i>
                </span>
                {{ item.label }}
              </button>
            </div>
          </div>

          <div class="hf-fields" role="group" aria-label="필드 삽입">
            <span class="tm-section-label">필드 삽입</span>
            <button v-for="field in FIELDS" :key="field.token" type="button" class="hf-field-button" :title="`${field.token} 넣기`" @mousedown.prevent @click="insertField(field.token)">
              <ActionIcon name="add" />{{ field.label }}
            </button>
          </div>

          <div v-for="row in rows" :key="row.key" class="hf-row">
            <div class="hf-row-head">
              <strong>{{ row.label }}</strong>
              <button class="tm-link-button" type="button" @click="clearRow(row.key)">비우기</button>
            </div>
            <div class="hf-slots">
              <label v-for="align in ['left', 'center', 'right']" :key="align">
                <span>{{ align === "left" ? "왼쪽" : align === "center" ? "가운데" : "오른쪽" }}</span>
                <input
                  v-model="draft[row.key][align]"
                  :class="`hf-input-${align}`"
                  maxlength="200"
                  @focus="rememberFocus(row.key, align, $event)"
                  @click="rememberFocus(row.key, align, $event)"
                  @keyup="rememberFocus(row.key, align, $event)"
                />
              </label>
            </div>
          </div>

          <div class="hf-inline-options">
            <label class="binding-toggle">
              <input v-model="draft[tab === 'header' ? 'headerDivider' : 'footerDivider']" type="checkbox" />
              {{ tab === "header" ? "머리글 아래" : "바닥글 위" }} 구분선
            </label>
            <label>
              {{ tab === "header" ? "위쪽" : "아래쪽" }} 여백에서 거리 (px)
              <input v-model.number="draft[tab === 'header' ? 'headerDistance' : 'footerDistance']" type="number" min="4" max="60" />
            </label>
          </div>
        </template>

        <template v-else>
          <div class="hf-options-grid">
            <label>
              페이지 번호 서식
              <select v-model="draft.pageNumber.format">
                <option v-for="format in PAGE_NUMBER_FORMATS" :key="format.id" :value="format.id">{{ format.label }}</option>
              </select>
            </label>
            <label>
              시작 번호
              <input v-model.number="draft.pageNumber.start" type="number" min="1" max="9999" />
            </label>
            <label>
              글자 크기 (px)
              <input v-model.number="draft.fontSize" type="number" min="6" max="20" step="0.5" />
            </label>
            <label>
              글자 색
              <input v-model="draft.color" type="color" />
            </label>
          </div>
          <label class="tm-switch-row">
            <input v-model="draft.differentFirstPage" class="tm-switch-input" type="checkbox" />
            <span class="tm-switch" aria-hidden="true"></span>
            <span class="tm-switch-text">
              <strong>첫 페이지를 다르게 지정</strong>
              <small>표지처럼 첫 페이지에 다른 머리글·바닥글을 쓰거나 비워 둡니다.</small>
            </span>
          </label>
          <label class="tm-switch-row">
            <input v-model="draft.differentOddEven" class="tm-switch-input" type="checkbox" />
            <span class="tm-switch" aria-hidden="true"></span>
            <span class="tm-switch-text">
              <strong>홀수/짝수 페이지를 다르게 지정</strong>
              <small>양면 인쇄용으로 짝수 페이지에 다른 머리글·바닥글을 씁니다.</small>
            </span>
          </label>
        </template>

        <div class="hf-preview" aria-label="미리보기">
          <span class="tm-section-label">미리보기</span>
          <div class="hf-preview-pages">
            <div v-for="page in preview" :key="page.pageIndex" class="hf-preview-page" :style="{ color: draft.color }">
              <div class="hf-preview-area" :class="{ 'hf-preview-divider-bottom': draft.headerDivider }">
                <span>{{ page.header.left }}</span><span>{{ page.header.center }}</span><span>{{ page.header.right }}</span>
              </div>
              <div class="hf-preview-body"><i></i><i></i><i></i><small>{{ page.pageIndex + 1 }}페이지</small></div>
              <div class="hf-preview-area" :class="{ 'hf-preview-divider-top': draft.footerDivider }">
                <span>{{ page.footer.left }}</span><span>{{ page.footer.center }}</span><span>{{ page.footer.right }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer class="chart-insert-footer">
        <span class="chart-insert-credit"></span>
        <button class="dsm-button dsm-button-primary" type="button" @click="apply"><ActionIcon name="check" />적용</button>
        <button class="dsm-button" type="button" @click="emit('close')">취소</button>
      </footer>
    </section>
  </div>
</template>
