<script setup>
// 보고서 텍스트. editable 이면 캔버스에서 바로 값을 고칠 수 있다(서식 없는 텍스트만).
// 입력 중에는 Vue 가 내용을 다시 그리지 않도록 DOM 텍스트를 직접 관리해 커서가 튀지 않게 한다.
import { onMounted, ref, watch } from "vue";

const props = defineProps({
  value: { type: [String, Number], default: "" },
  textStyle: { type: Object, default: undefined },
  editable: { type: Boolean, default: false },
  multiline: { type: Boolean, default: false },
  placeholder: { type: String, default: "" },
  label: { type: String, default: "" },
});
const emit = defineEmits(["update"]);

const element = ref(null);
let valueAtFocus = "";

function asText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function readText() {
  // innerText 는 줄바꿈(<br>)을 \n 으로 돌려준다.
  let text = element.value?.innerText ?? "";
  if (!props.multiline) text = text.replace(/\r?\n/g, " ");
  return text;
}

function syncFromValue() {
  if (!element.value || document.activeElement === element.value) return;
  const text = asText(props.value);
  if (element.value.textContent !== text) element.value.textContent = text;
}

watch(() => [props.value, props.editable], syncFromValue, { flush: "post" });
onMounted(syncFromValue);

function handleFocus() {
  valueAtFocus = asText(props.value);
}

function handleInput() {
  emit("update", readText());
}

function handleBlur() {
  // 줄 끝에 남는 빈 줄 등 브라우저가 넣은 흔적을 정리해 값과 화면을 맞춘다.
  const text = readText();
  if (text !== asText(props.value)) emit("update", text);
  requestAnimationFrame(syncFromValue);
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    element.value.textContent = valueAtFocus;
    emit("update", valueAtFocus);
    element.value.blur();
    return;
  }
  if (event.key === "Enter" && !props.multiline) {
    event.preventDefault();
    element.value.blur();
  }
}

function handlePaste(event) {
  event.preventDefault();
  let text = event.clipboardData?.getData("text/plain") ?? "";
  if (!props.multiline) text = text.replace(/\r?\n/g, " ");
  // 서식 없는 텍스트만 현재 커서 위치에 넣는다.
  document.execCommand("insertText", false, text);
}
</script>

<template>
  <span v-if="!editable" class="report-text" :style="textStyle">{{ value }}</span>
  <span
    v-else
    ref="element"
    class="report-text report-text-editable"
    :class="{ 'report-text-multiline': multiline }"
    :style="textStyle"
    contenteditable="plaintext-only"
    spellcheck="false"
    role="textbox"
    :aria-multiline="multiline"
    :aria-label="label || placeholder"
    :data-placeholder="placeholder"
    @focus="handleFocus"
    @input="handleInput"
    @blur="handleBlur"
    @keydown="handleKeydown"
    @paste="handlePaste"
  ></span>
</template>
