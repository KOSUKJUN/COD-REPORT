<script setup>
// 차트 데이터 편집·매핑. 직접 입력(엑셀 붙여넣기 지원) 또는 DB 쿼리 결과의 필드를 항목·계열에 연결한다.
import { computed, ref } from "vue";
import ActionIcon from "./ActionIcon.vue";
import ReportChart from "./ReportChart.vue";
import { getChartCategory } from "../charts/chart-catalog.js";
import { getChartDataIssue, resolveChartData, toChartNumber } from "../charts/chart-options.js";
import { getDatasourceType } from "../datasource-url.js";

const props = defineProps({
  block: { type: Object, required: true },
  allowDatabase: { type: Boolean, default: true },
  datasources: { type: Array, default: () => [] },
  canManageDatasources: { type: Boolean, default: true },
  databaseConfigured: { type: Boolean, default: true },
  // (query, parametersText, datasourceId) => Promise<{ columns, rows, truncated }>
  runQuery: { type: Function, default: null },
});
const emit = defineEmits(["apply", "close", "manage-datasources"]);

const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

function defaultBinding() {
  return {
    enabled: false,
    datasourceId: "",
    query: "",
    parametersText: "[]",
    columns: [],
    rows: [],
    chartMapping: { categoryField: "", series: [] },
  };
}

const chart = plain(props.block.chart) ?? {};
const chartData = ref(plain(props.block.chartData) ?? { categories: [], series: [] });
chartData.value.categories ??= [];
chartData.value.series ??= [];
const binding = ref({ ...defaultBinding(), ...(plain(props.block.dataBinding) ?? {}) });
binding.value.chartMapping ??= { categoryField: "", series: [] };
binding.value.chartMapping.series ??= [];
const mode = ref(props.allowDatabase && props.block.dataBinding?.enabled ? "database" : "manual");
const queryBusy = ref(false);
const queryMessage = ref(null);

const category = computed(() => getChartCategory(chart.category));
const isCombo = computed(() => chart.category === "combo");

const previewBlock = computed(() => ({
  chart,
  chartData: chartData.value,
  dataBinding: { ...binding.value, enabled: mode.value === "database" },
}));
const resolved = computed(() => resolveChartData(previewBlock.value));
const issue = computed(() => getChartDataIssue(chart, resolved.value));

// ---------- 직접 입력 ----------

const rowCount = computed(() => chartData.value.categories.length);

function cellText(value) {
  return value === null || value === undefined ? "" : String(value);
}

function addRow() {
  chartData.value.categories.push(`항목 ${rowCount.value + 1}`);
  chartData.value.series.forEach((item) => item.values.push(""));
}

function removeRow(index) {
  chartData.value.categories.splice(index, 1);
  chartData.value.series.forEach((item) => item.values.splice(index, 1));
}

function addSeries() {
  chartData.value.series.push({
    name: `계열 ${chartData.value.series.length + 1}`,
    values: chartData.value.categories.map(() => ""),
  });
}

function removeSeries(index) {
  chartData.value.series.splice(index, 1);
}

function ensureSize(rows, columns) {
  while (chartData.value.categories.length < rows) addRow();
  while (chartData.value.series.length < columns) addSeries();
  chartData.value.series.forEach((item) => {
    while (item.values.length < chartData.value.categories.length) item.values.push("");
  });
}

// 엑셀·한글 표에서 여러 칸을 복사해 붙여넣으면 표로 채운다. row -1 = 계열 이름 줄, column -1 = 항목 열.
function handleGridPaste(event, row, column) {
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!/[\t\n]/.test(text.trim())) return;
  event.preventDefault();
  const lines = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((line) => line.split("\t"));
  const lastRow = row + lines.length - 1;
  const lastColumn = column + Math.max(...lines.map((line) => line.length)) - 1;
  ensureSize(lastRow + 1, lastColumn + 1);
  lines.forEach((cells, rowOffset) => {
    cells.forEach((value, columnOffset) => {
      const r = row + rowOffset;
      const c = column + columnOffset;
      if (r === -1 && c === -1) return;
      if (r === -1) chartData.value.series[c].name = value.trim();
      else if (c === -1) chartData.value.categories[r] = value.trim();
      else chartData.value.series[c].values[r] = value.trim();
    });
  });
}

// ---------- DB 쿼리 ----------

const mapping = computed(() => binding.value.chartMapping);
const numericColumns = computed(() => {
  const rows = binding.value.rows ?? [];
  return (binding.value.columns ?? []).filter((column) =>
    rows.length && rows.every((row) => row[column] === null || row[column] === "" || toChartNumber(row[column]) !== null),
  );
});

function datasourceLabel(datasource) {
  return `${datasource.name} · ${getDatasourceType(datasource.type)?.label ?? datasource.type}${datasource.enabled ? "" : " (미사용)"}`;
}

async function runQuery() {
  if (!props.runQuery || queryBusy.value) return;
  if (!binding.value.query.trim()) {
    queryMessage.value = { type: "error", text: "먼저 SELECT 쿼리를 입력해 주세요." };
    return;
  }
  queryBusy.value = true;
  queryMessage.value = { type: "info", text: "쿼리를 실행하고 있습니다..." };
  try {
    const result = await props.runQuery(binding.value.query, binding.value.parametersText, binding.value.datasourceId || "");
    binding.value.columns = result.columns;
    binding.value.rows = result.rows;
    binding.value.lastRefreshedAt = new Date().toISOString();
    autoMap();
    queryMessage.value = {
      type: "success",
      text: `${result.rows.length}행, ${result.columns.length}개 필드를 불러왔습니다.${result.truncated ? " (최대 5,000행)" : ""}`,
    };
  } catch (error) {
    queryMessage.value = { type: "error", text: error.message };
  } finally {
    queryBusy.value = false;
  }
}

// 처음 실행했거나 연결한 필드가 결과에 없으면 글자 필드 → 항목, 숫자 필드 → 계열로 자동 연결한다.
function autoMap() {
  const columns = binding.value.columns ?? [];
  const current = mapping.value;
  const stillValid = current.categoryField && columns.includes(current.categoryField) &&
    current.series.length && current.series.every((item) => !item.field || columns.includes(item.field));
  if (stillValid) return;
  const numbers = numericColumns.value;
  const categoryField = columns.find((column) => !numbers.includes(column)) ?? columns[0] ?? "";
  binding.value.chartMapping = {
    categoryField,
    series: numbers.filter((column) => column !== categoryField).map((field) => ({ field, name: "" })),
  };
}

function addMappedSeries() {
  const used = new Set(mapping.value.series.map((item) => item.field));
  const next = numericColumns.value.find((column) => !used.has(column) && column !== mapping.value.categoryField) ?? "";
  mapping.value.series.push({ field: next, name: "" });
}

function moveMappedSeries(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= mapping.value.series.length) return;
  const [item] = mapping.value.series.splice(index, 1);
  mapping.value.series.splice(target, 0, item);
}

// ---------- 적용 ----------

function apply() {
  const data = {
    categories: chartData.value.categories.map((item) => String(item ?? "")),
    series: chartData.value.series.map((item) => ({
      ...item,
      name: String(item.name ?? ""),
      values: item.values.map(toChartNumber),
    })),
  };
  const payload = { chartData: data };
  if (props.allowDatabase) {
    payload.dataBinding = {
      ...binding.value,
      enabled: mode.value === "database",
      chartMapping: {
        categoryField: mapping.value.categoryField,
        series: mapping.value.series.filter((item) => item.field),
      },
    };
  }
  emit("apply", payload);
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
    <section class="editor-modal chart-data" role="dialog" aria-modal="true" aria-labelledby="chart-data-title">
      <header class="chart-insert-header popup-titlebar">
        <div>
          <h2 id="chart-data-title">차트 데이터 {{ allowDatabase ? "편집·매핑" : "수정" }}</h2>
          <p>{{ category.label }} · {{ category.dataHint }}</p>
        </div>
        <button class="modal-close-button" type="button" aria-label="닫기" @click="emit('close')">×</button>
      </header>

      <div class="chart-data-body">
        <div class="chart-data-editor">
          <div v-if="allowDatabase" class="tm-segmented chart-data-mode" role="radiogroup" aria-label="데이터 가져오는 방법">
            <button
              type="button"
              role="radio"
              :aria-checked="mode === 'manual'"
              :class="{ 'tm-segmented-active': mode === 'manual' }"
              @click="mode = 'manual'"
            >직접 입력</button>
            <button
              type="button"
              role="radio"
              :aria-checked="mode === 'database'"
              :class="{ 'tm-segmented-active': mode === 'database' }"
              @click="mode = 'database'"
            >DB 쿼리</button>
          </div>

          <!-- 직접 입력 -->
          <template v-if="mode === 'manual'">
            <p class="chart-data-tip">엑셀에서 여러 칸을 복사해 표의 칸에 붙여넣으면 한 번에 채워집니다.</p>
            <div class="chart-grid-wrap">
              <table class="chart-grid">
                <thead>
                  <tr>
                    <th class="chart-grid-corner">항목</th>
                    <th v-for="(item, seriesIndex) in chartData.series" :key="seriesIndex">
                      <div class="chart-grid-head">
                        <input
                          v-model="item.name"
                          :aria-label="`계열 ${seriesIndex + 1} 이름`"
                          @paste="handleGridPaste($event, -1, seriesIndex)"
                        />
                        <button type="button" :aria-label="`${item.name || '계열'} 삭제`" title="계열 삭제" @click="removeSeries(seriesIndex)">×</button>
                      </div>
                    </th>
                    <th class="chart-grid-add">
                      <button type="button" title="계열 추가" @click="addSeries"><ActionIcon name="add" />계열</button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(categoryName, rowIndex) in chartData.categories" :key="rowIndex">
                    <th>
                      <input
                        :value="categoryName"
                        :aria-label="`${rowIndex + 1}행 항목`"
                        @input="chartData.categories[rowIndex] = $event.target.value"
                        @paste="handleGridPaste($event, rowIndex, -1)"
                      />
                    </th>
                    <td v-for="(item, seriesIndex) in chartData.series" :key="seriesIndex">
                      <input
                        :value="cellText(item.values[rowIndex])"
                        inputmode="decimal"
                        :aria-label="`${categoryName} ${item.name} 값`"
                        :class="{ 'chart-grid-invalid': cellText(item.values[rowIndex]) !== '' && toChartNumber(item.values[rowIndex]) === null }"
                        @input="item.values[rowIndex] = $event.target.value"
                        @paste="handleGridPaste($event, rowIndex, seriesIndex)"
                      />
                    </td>
                    <td class="chart-grid-row-remove">
                      <button type="button" :aria-label="`${rowIndex + 1}행 삭제`" title="행 삭제" @click="removeRow(rowIndex)">×</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <button class="dsm-button chart-grid-add-row" type="button" @click="addRow"><ActionIcon name="add" />행 추가</button>
          </template>

          <!-- DB 쿼리 -->
          <template v-else>
            <div class="chart-data-fields">
              <label for="chart-data-datasource">데이터소스</label>
              <div class="binding-datasource-row">
                <select id="chart-data-datasource" v-model="binding.datasourceId">
                  <option value="">리포트 DB (기본)</option>
                  <option v-for="datasource in datasources" :key="datasource.id" :value="datasource.id" :disabled="!datasource.enabled">
                    {{ datasourceLabel(datasource) }}
                  </option>
                </select>
                <button v-if="canManageDatasources" class="binding-manage-button" type="button" @click="emit('manage-datasources')"><ActionIcon name="settings" />관리</button>
              </div>
              <label for="chart-data-query">읽기 전용 SELECT 쿼리</label>
              <textarea
                id="chart-data-query"
                v-model="binding.query"
                rows="4"
                spellcheck="false"
                placeholder="SELECT org, COUNT(*) AS cnt FROM incidents WHERE created_at BETWEEN ? AND ? GROUP BY org"
              ></textarea>
              <label for="chart-data-params">파라미터 (JSON 배열)</label>
              <input id="chart-data-params" v-model="binding.parametersText" spellcheck="false" placeholder='["{{periodStart}}", "{{periodEnd}}"]' />
              <button class="binding-run-button" type="button" :disabled="queryBusy || !databaseConfigured || !runQuery" @click="runQuery">
                <ActionIcon name="run" />{{ queryBusy ? "쿼리 실행 중..." : "쿼리 실행 및 필드 불러오기" }}
              </button>
              <p v-if="queryMessage" class="dsm-message" :class="`dsm-message-${queryMessage.type}`">{{ queryMessage.text }}</p>
            </div>

            <template v-if="binding.columns?.length">
              <h3 class="chart-data-section">필드 연결</h3>
              <div class="chart-mapping">
                <label for="chart-map-category">항목 (X축·이름)</label>
                <select id="chart-map-category" v-model="binding.chartMapping.categoryField">
                  <option value="">(행 번호)</option>
                  <option v-for="column in binding.columns" :key="column" :value="column">{{ column }}</option>
                </select>
              </div>
              <div class="chart-mapping-series">
                <div class="chart-mapping-series-head">
                  <span>값 계열</span>
                  <button class="tm-link-button" type="button" @click="addMappedSeries"><ActionIcon name="add" />계열 추가</button>
                </div>
                <div v-for="(item, index) in binding.chartMapping.series" :key="index" class="chart-mapping-row">
                  <span class="chart-mapping-index">{{ index + 1 }}</span>
                  <select v-model="item.field" :aria-label="`계열 ${index + 1} 필드`">
                    <option value="">필드 선택</option>
                    <option v-for="column in binding.columns" :key="column" :value="column">
                      {{ column }}{{ numericColumns.includes(column) ? "" : " (숫자 아님)" }}
                    </option>
                  </select>
                  <input v-model="item.name" :placeholder="item.field || '표시 이름'" :aria-label="`계열 ${index + 1} 표시 이름`" />
                  <select v-if="isCombo" v-model="item.chartType" :aria-label="`계열 ${index + 1} 모양`">
                    <option :value="undefined">자동</option>
                    <option value="bar">막대</option>
                    <option value="line">꺾은선</option>
                    <option value="area">영역</option>
                  </select>
                  <label v-if="isCombo" class="chart-mapping-secondary" title="보조 축(오른쪽)에 표시">
                    <input v-model="item.secondaryAxis" type="checkbox" />보조
                  </label>
                  <span class="chart-mapping-actions">
                    <button type="button" :disabled="index === 0" title="위로" @click="moveMappedSeries(index, -1)"><ActionIcon name="up" /></button>
                    <button type="button" :disabled="index === binding.chartMapping.series.length - 1" title="아래로" @click="moveMappedSeries(index, 1)"><ActionIcon name="down" /></button>
                    <button type="button" title="삭제" @click="binding.chartMapping.series.splice(index, 1)"><ActionIcon name="delete" /></button>
                  </span>
                </div>
                <p v-if="!binding.chartMapping.series.length" class="chart-data-tip">계열을 추가해 숫자 필드를 연결하세요.</p>
              </div>
              <details class="chart-data-sample">
                <summary>조회 결과 미리보기 (처음 5행)</summary>
                <div class="chart-grid-wrap">
                  <table class="chart-sample-table">
                    <thead><tr><th v-for="column in binding.columns" :key="column">{{ column }}</th></tr></thead>
                    <tbody>
                      <tr v-for="(row, rowIndex) in binding.rows.slice(0, 5)" :key="rowIndex">
                        <td v-for="column in binding.columns" :key="column">{{ row[column] }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </details>
            </template>
            <p v-else class="chart-data-tip">쿼리를 실행하면 결과 필드를 항목과 계열에 연결할 수 있습니다. 자동 생성 때는 이 쿼리를 다시 실행해 최신 값으로 그립니다.</p>
          </template>
        </div>

        <aside class="chart-data-preview" aria-label="차트 미리보기">
          <span class="tm-section-label">미리보기</span>
          <div class="chart-data-preview-box">
            <ReportChart :block="previewBlock" :height="280" interactive />
          </div>
          <p v-if="issue" class="dsm-message dsm-message-error">{{ issue }}</p>
          <p v-else class="chart-data-tip">항목 {{ resolved.categories.length }}개 · 계열 {{ resolved.series.length }}개</p>
        </aside>
      </div>

      <footer class="chart-insert-footer">
        <span class="chart-insert-credit"></span>
        <button class="dsm-button dsm-button-primary" type="button" @click="apply"><ActionIcon name="check" />적용</button>
        <button class="dsm-button" type="button" @click="emit('close')">취소</button>
      </footer>
    </section>
  </div>
</template>
