<script setup>
// 보고서 차트. Apache ECharts(SVG 렌더러)로 그려 인쇄·PDF에서도 선명하다.
// 그린 뒤 data-chart-ready="true" 를 달아 내보내기에서 완성을 기다릴 수 있게 한다.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { buildChartOption, getChartDataIssue, resolveChartData } from "../charts/chart-options.js";

const props = defineProps({
  // { chart, chartData, dataBinding } 를 가진 차트 요소
  block: { type: Object, required: true },
  interactive: { type: Boolean, default: false },
  // 차트 삽입 창 미리보기처럼 블록 없이 그릴 때 높이를 직접 지정
  height: { type: Number, default: 0 },
});

const container = ref(null);
const instance = shallowRef(null);
const ready = ref(false);
const loadError = ref("");
let resizeObserver;
let echartsModule;

const chartHeight = computed(() => props.height || Number(props.block.chart?.height) || 260);
const data = computed(() => resolveChartData(props.block));
const issue = computed(() => getChartDataIssue(props.block.chart, data.value));
const option = computed(() => buildChartOption(props.block.chart ?? {}, data.value, { interactive: props.interactive }));
// 차트 스타일의 테두리·배경은 차트 칸 자체에 입힌다(그림으로 내보낼 때도 함께 찍힌다).
const frameStyle = computed(() => {
  const style = props.block.chart?.style ?? {};
  const isColor = (value) => typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value);
  return {
    height: `${chartHeight.value}px`,
    ...(isColor(style.borderColor) ? { border: `1px solid ${style.borderColor}`, borderRadius: "4px" } : {}),
    ...(isColor(style.backgroundColor) ? { backgroundColor: style.backgroundColor } : {}),
  };
});

function render() {
  if (!instance.value) return;
  if (issue.value) {
    instance.value.clear();
  } else {
    instance.value.setOption(option.value, true);
  }
  ready.value = true;
}

onMounted(async () => {
  try {
    echartsModule ??= (await import("../charts/echarts-setup.js")).default;
    if (!container.value) return;
    instance.value = echartsModule.init(container.value, null, { renderer: "svg" });
    render();
    resizeObserver = new ResizeObserver(() => instance.value?.resize());
    resizeObserver.observe(container.value);
  } catch (error) {
    loadError.value = `차트를 그리지 못했습니다: ${error.message}`;
    ready.value = true;
  }
});

watch([option, issue], render, { deep: true });
watch(chartHeight, () => requestAnimationFrame(() => instance.value?.resize()));

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  instance.value?.dispose();
});
</script>

<template>
  <div
    class="report-chart"
    :style="frameStyle"
    :data-chart-ready="ready ? 'true' : 'false'"
  >
    <div ref="container" class="report-chart-canvas" :aria-label="block.chart?.title || '차트'" role="img"></div>
    <div v-if="issue || loadError" class="report-chart-issue">
      <strong>차트를 표시할 수 없습니다</strong>
      <span>{{ loadError || issue }}</span>
    </div>
  </div>
</template>
