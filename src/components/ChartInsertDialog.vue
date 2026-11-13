<script setup>
// Word '차트 삽입' 창과 같은 구성: 왼쪽 분류 → 위쪽 세부 종류 미리보기 → 가운데 큰 미리보기.
import { computed, onMounted, ref } from "vue";
import ChartTypeIcon from "./ChartTypeIcon.vue";
import ReportChart from "./ReportChart.vue";
import { CHART_CATEGORIES, createChartConfig, defaultChartData, getChartCategory } from "../charts/chart-catalog.js";

const props = defineProps({
  // 차트 종류 변경일 때 현재 설정 { category, variant }
  current: { type: Object, default: null },
});
const emit = defineEmits(["confirm", "close"]);

const categoryId = ref(props.current?.category ?? "column");
const variantId = ref(props.current?.variant ?? getChartCategory(categoryId.value).variants[0].id);
const categoryList = ref(null);

const category = computed(() => getChartCategory(categoryId.value));
const variant = computed(() => category.value.variants.find((item) => item.id === variantId.value) ?? category.value.variants[0]);

function previewBlock(variantKey, { thumbnail = false } = {}) {
  const chart = createChartConfig(categoryId.value, variantKey);
  if (thumbnail) {
    chart.showTitle = false;
    chart.legend = "none";
    chart.compact = true;
  }
  return { chart, chartData: defaultChartData(categoryId.value) };
}

const mainPreview = computed(() => previewBlock(variant.value.id));

function selectCategory(id) {
  categoryId.value = id;
  variantId.value = getChartCategory(id).variants[0].id;
}

function handleCategoryKeydown(event) {
  const index = CHART_CATEGORIES.findIndex((item) => item.id === categoryId.value);
  const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : null;
  if (next === null || next < 0 || next >= CHART_CATEGORIES.length) return;
  event.preventDefault();
  selectCategory(CHART_CATEGORIES[next].id);
  categoryList.value?.querySelector(`[data-category="${CHART_CATEGORIES[next].id}"]`)?.focus();
}

function confirm() {
  emit("confirm", { category: category.value.id, variant: variant.value.id });
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    event.stopPropagation();
    emit("close");
  } else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
    confirm();
  }
}

onMounted(() => {
  categoryList.value?.querySelector(`[data-category="${categoryId.value}"]`)?.focus();
});
</script>

<template>
  <div class="modal-backdrop" @keydown="handleKeydown">
    <section class="editor-modal chart-insert" role="dialog" aria-modal="true" aria-labelledby="chart-insert-title">
      <header class="chart-insert-header popup-titlebar">
        <h2 id="chart-insert-title">{{ current ? "차트 종류 변경" : "차트 삽입" }}</h2>
        <button class="modal-close-button" type="button" aria-label="닫기" @click="emit('close')">×</button>
      </header>
      <div class="chart-insert-tabs" role="tablist">
        <span role="tab" aria-selected="true" class="chart-insert-tab-active">모든 차트</span>
      </div>
      <div class="chart-insert-body">
        <div ref="categoryList" class="chart-insert-categories" role="listbox" aria-label="차트 종류" @keydown="handleCategoryKeydown">
          <button
            v-for="item in CHART_CATEGORIES"
            :key="item.id"
            :data-category="item.id"
            type="button"
            role="option"
            :aria-selected="item.id === categoryId"
            :tabindex="item.id === categoryId ? 0 : -1"
            :class="{ 'chart-insert-category-active': item.id === categoryId }"
            @click="selectCategory(item.id)"
            @dblclick="confirm"
          >
            <ChartTypeIcon :type="item.id" />
            {{ item.label }}
          </button>
        </div>
        <div class="chart-insert-main">
          <div class="chart-insert-variants" role="radiogroup" :aria-label="`${category.label} 세부 종류`">
            <button
              v-for="item in category.variants"
              :key="item.id"
              type="button"
              role="radio"
              :aria-checked="item.id === variant.id"
              :title="item.label"
              :class="{ 'chart-insert-variant-active': item.id === variant.id }"
              @click="variantId = item.id"
              @dblclick="confirm"
            >
              <ReportChart :key="`${categoryId}-${item.id}`" :block="previewBlock(item.id, { thumbnail: true })" :height="58" />
            </button>
          </div>
          <h3>{{ variant.label }}</h3>
          <div class="chart-insert-preview">
            <ReportChart :key="`${categoryId}-${variant.id}-main`" :block="mainPreview" :height="250" interactive />
          </div>
          <p class="chart-insert-hint">{{ category.dataHint }} 삽입한 뒤 ‘데이터 편집·매핑’에서 값을 넣거나 DB 쿼리를 연결할 수 있습니다.</p>
        </div>
      </div>
      <footer class="chart-insert-footer">
        <span class="chart-insert-credit">차트 엔진: Apache ECharts (Apache License 2.0)</span>
        <button class="dsm-button dsm-button-primary" type="button" @click="confirm">확인</button>
        <button class="dsm-button" type="button" @click="emit('close')">취소</button>
      </footer>
    </section>
  </div>
</template>
