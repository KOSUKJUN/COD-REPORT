// 차트 데이터 해석(직접 입력 / DB 쿼리 매핑)과 ECharts 옵션 생성. 화면·서버·테스트 공용(순수 함수).
import { getChartCategory, resolveChartColors } from "./chart-catalog.js";

const FONT_FAMILY = "'Malgun Gothic', 'Segoe UI', sans-serif";

function displayText(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function toChartNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const number = Number(String(value).replace(/[,\s]/g, "").replace(/%$/, ""));
  return Number.isFinite(number) ? number : null;
}

// 차트에 쓸 데이터: { categories: string[], series: [{ name, values: (number|null)[], chartType?, secondaryAxis? }] }
// DB 바인딩이 켜져 있고 매핑이 있으면 조회 결과에서, 아니면 직접 입력한 데이터(chartData)에서 만든다.
export function resolveChartData(block) {
  const binding = block?.dataBinding;
  const mapping = binding?.chartMapping;
  if (binding?.enabled && mapping && Array.isArray(binding.rows)) {
    const rows = binding.rows;
    const series = (mapping.series ?? [])
      .filter((item) => item?.field)
      .map((item) => ({
        name: item.name?.trim() || item.field,
        values: rows.map((row) => toChartNumber(row?.[item.field])),
        ...(item.chartType ? { chartType: item.chartType } : {}),
        ...(item.secondaryAxis ? { secondaryAxis: true } : {}),
      }));
    return {
      categories: mapping.categoryField ? rows.map((row) => displayText(row?.[mapping.categoryField])) : rows.map((_, index) => String(index + 1)),
      series,
    };
  }
  const data = block?.chartData ?? { categories: [], series: [] };
  return {
    categories: (data.categories ?? []).map(displayText),
    series: (data.series ?? []).map((item) => ({
      ...item,
      name: displayText(item.name),
      values: (item.values ?? []).map(toChartNumber),
    })),
  };
}

// 차트를 그릴 수 없는 데이터면 이유를, 괜찮으면 "" 를 돌려준다.
export function getChartDataIssue(chart, data) {
  const category = getChartCategory(chart?.category);
  const seriesCount = data.series.length;
  if (!seriesCount) return "값 계열이 없습니다. 데이터 편집에서 계열을 추가하거나 쿼리 필드를 연결하세요.";
  if (category.minSeries && seriesCount < category.minSeries) {
    return `${category.label} 차트는 계열 ${category.minSeries}개가 필요합니다 (시가·종가·저가·고가).`;
  }
  const usesCategories = !["histogram", "boxplot"].includes(category.id);
  if (usesCategories && !data.categories.length) return "항목(행)이 없습니다.";
  if (data.series.every((item) => item.values.every((value) => value === null))) {
    return "숫자 값이 없습니다. 계열에 숫자 필드를 연결했는지 확인하세요.";
  }
  if (category.id === "scatter" && chart?.variant === "bubble" && seriesCount < 2) {
    return "거품형은 계열 2개(Y 값, 크기)가 필요합니다.";
  }
  return "";
}

// ---------- 계산 도우미 ----------

function percentValues(series) {
  const length = Math.max(0, ...series.map((item) => item.values.length));
  const totals = Array.from({ length }, (_, index) =>
    series.reduce((sum, item) => sum + Math.abs(item.values[index] ?? 0), 0),
  );
  return series.map((item) => ({
    ...item,
    values: item.values.map((value, index) =>
      value === null || !totals[index] ? null : Math.round((Math.abs(value) / totals[index]) * 10000) / 100,
    ),
  }));
}

function quantile(sorted, q) {
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

export function boxStats(values) {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return [0, 0, 0, 0, 0];
  const round = (value) => Math.round(value * 1000) / 1000;
  return [sorted[0], quantile(sorted, 0.25), quantile(sorted, 0.5), quantile(sorted, 0.75), sorted[sorted.length - 1]].map(round);
}

export function histogramBins(values, requestedBins = 0) {
  const numbers = values.filter((value) => value !== null);
  if (!numbers.length) return [];
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const binCount = Math.max(1, Math.min(50, requestedBins || Math.ceil(Math.log2(numbers.length) + 1)));
  const width = (max - min) / binCount || 1;
  const format = (value) => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));
  const bins = Array.from({ length: binCount }, (_, index) => ({
    from: min + width * index,
    to: index === binCount - 1 ? max : min + width * (index + 1),
    count: 0,
  }));
  for (const value of numbers) {
    const index = Math.min(binCount - 1, Math.floor((value - min) / width));
    bins[index].count += 1;
  }
  return bins.map((bin) => ({ label: `${format(bin.from)}–${format(bin.to)}`, count: bin.count }));
}

export function waterfallSteps(categories, values) {
  let running = 0;
  const steps = values.map((raw, index) => {
    const value = raw ?? 0;
    const base = value >= 0 ? running : running + value;
    running += value;
    return { label: categories[index] ?? `${index + 1}`, base, increase: value >= 0 ? value : 0, decrease: value < 0 ? -value : 0 };
  });
  steps.push({ label: "합계", base: 0, increase: 0, decrease: 0, total: running });
  return steps;
}

// "상위/하위" 경로 항목을 계층 데이터로 묶는다.
export function buildHierarchy(categories, values) {
  const root = [];
  categories.forEach((path, index) => {
    const value = values[index];
    if (value === null || value === undefined) return;
    const parts = String(path).split("/").map((part) => part.trim()).filter(Boolean);
    let level = root;
    parts.forEach((name, depth) => {
      let node = level.find((item) => item.name === name);
      if (!node) {
        node = { name };
        level.push(node);
      }
      if (depth === parts.length - 1) {
        node.value = (node.value ?? 0) + value;
      } else {
        node.children ??= [];
        level = node.children;
      }
    });
  });
  return root;
}

// ---------- ECharts 옵션 ----------

function baseOption(chart, colors, { interactive }) {
  const legendPosition = chart.legend ?? "bottom";
  return {
    animation: false,
    color: colors,
    textStyle: { fontFamily: FONT_FAMILY, color: "#3b4252" },
    title: chart.showTitle !== false && chart.title
      ? { text: chart.title, left: "center", top: 4, textStyle: { fontSize: 14, fontWeight: 600, color: "#2b3039" } }
      : undefined,
    legend: legendPosition === "none"
      ? { show: false }
      : {
          show: true,
          type: "plain",
          textStyle: { fontSize: 10 },
          itemWidth: 12,
          itemHeight: 8,
          ...(legendPosition === "right"
            ? { orient: "vertical", right: 4, top: "middle" }
            : legendPosition === "top"
              ? { top: chart.showTitle !== false && chart.title ? 28 : 4 }
              : { bottom: 2 }),
        },
    tooltip: interactive ? { trigger: "item", confine: true } : undefined,
  };
}

function gridFor(chart) {
  const hasTitle = chart.showTitle !== false && chart.title;
  const legend = chart.legend ?? "bottom";
  return {
    left: chart.yAxisTitle ? 44 : 12,
    right: legend === "right" ? 96 : 16,
    top: (hasTitle ? 34 : 12) + (legend === "top" ? 22 : 0),
    bottom: (legend === "bottom" ? 26 : 8) + (chart.xAxisTitle ? 20 : 0),
    containLabel: true,
  };
}

function axisName(title, location = "middle") {
  return title ? { name: title, nameLocation: location, nameGap: 28, nameTextStyle: { fontSize: 10, color: "#5d6678" } } : {};
}

const AXIS_STYLE = {
  axisLabel: { fontSize: 10, color: "#5d6678" },
  axisLine: { lineStyle: { color: "#b7bcc6" } },
  splitLine: { lineStyle: { color: "#e6e8ec" } },
};

// 보고서에서는 항목이 빠지면 안 되므로 겹쳐도 모든 항목 이름을 표시한다.
// 항목이 많거나 이름이 길면 기울이고, 너무 긴 이름은 말줄임으로 줄인다.
function categoryLabelStyle(categories, { horizontal = false } = {}) {
  const longest = Math.max(0, ...categories.map((label) => String(label).length));
  const crowded = !horizontal && (categories.length > 6 || longest * categories.length > 48);
  return {
    ...AXIS_STYLE.axisLabel,
    interval: 0,
    hideOverlap: false,
    rotate: crowded ? 30 : 0,
    overflow: "truncate",
    width: horizontal ? 90 : crowded ? 80 : Math.max(40, Math.floor(420 / Math.max(1, categories.length))),
  };
}

function labelOption(chart, extra = {}) {
  return chart.showLabels ? { show: true, fontSize: 9, ...extra } : { show: false };
}

function cartesianOption(chart, data, colors, options) {
  const category = chart.category;
  const variant = chart.variant;
  const horizontal = category === "bar";
  const percent = variant === "percent";
  const stacked = variant === "stacked" || percent;
  const series = percent ? percentValues(data.series) : data.series;
  const isArea = category === "area" || (category === "combo" && variant === "area-bar");

  const resolvedSeries = series.map((item, index) => {
    let type = category === "line" || category === "area" ? "line" : "bar";
    let onSecondary = false;
    let area = category === "area";
    let stack = stacked ? "total" : undefined;
    if (category === "combo") {
      const last = index === series.length - 1 && series.length > 1;
      if (variant === "area-bar") {
        type = index === 0 ? "line" : "bar";
        area = index === 0;
        stack = undefined;
      } else {
        type = last ? "line" : "bar";
        onSecondary = variant === "bar-line-secondary" && last;
      }
      if (item.chartType === "bar" || item.chartType === "line" || item.chartType === "area") {
        type = item.chartType === "bar" ? "bar" : "line";
        area = item.chartType === "area";
      }
      if (item.secondaryAxis) onSecondary = true;
    }
    return {
      name: item.name,
      type,
      data: item.values,
      stack,
      yAxisIndex: horizontal ? undefined : onSecondary ? 1 : 0,
      smooth: category === "line" && variant === "smooth",
      step: category === "line" && variant === "step" ? "middle" : undefined,
      showSymbol: type === "line" && (variant === "markers" || category === "combo"),
      symbolSize: 6,
      areaStyle: area ? { opacity: isArea && stacked ? 0.85 : 0.6 } : undefined,
      barMaxWidth: 36,
      label: labelOption(chart, { position: type === "bar" ? (stacked ? "inside" : horizontal ? "right" : "top") : "top", formatter: percent ? "{c}%" : undefined }),
      emphasis: { focus: "series" },
    };
  });

  const categoryAxis = {
    type: "category",
    data: data.categories,
    boundaryGap: resolvedSeries.some((item) => item.type === "bar"),
    ...AXIS_STYLE,
    axisLabel: categoryLabelStyle(data.categories, { horizontal }),
    splitLine: { show: false },
  };
  const valueAxis = {
    type: "value",
    ...AXIS_STYLE,
    ...(percent ? { max: 100, axisLabel: { ...AXIS_STYLE.axisLabel, formatter: "{value}%" } } : {}),
  };
  const usesSecondary = !horizontal && resolvedSeries.some((item) => item.yAxisIndex === 1);
  return {
    ...baseOption(chart, colors, options),
    tooltip: options.interactive ? { trigger: "axis", confine: true } : undefined,
    grid: gridFor(chart),
    xAxis: horizontal ? { ...valueAxis, ...axisName(chart.yAxisTitle) } : { ...categoryAxis, ...axisName(chart.xAxisTitle) },
    yAxis: horizontal
      ? { ...categoryAxis, inverse: true, ...axisName(chart.xAxisTitle) }
      : usesSecondary
        ? [{ ...valueAxis, ...axisName(chart.yAxisTitle) }, { ...valueAxis, splitLine: { show: false } }]
        : { ...valueAxis, ...axisName(chart.yAxisTitle) },
    series: resolvedSeries,
  };
}

function pieOption(chart, data, colors, options) {
  const values = data.series[0]?.values ?? [];
  const variant = chart.variant;
  const hasTitle = chart.showTitle !== false && chart.title;
  return {
    ...baseOption(chart, colors, options),
    series: [{
      name: data.series[0]?.name,
      type: "pie",
      radius: variant === "doughnut" ? ["38%", "66%"] : variant === "rose" ? ["12%", "68%"] : "66%",
      center: ["50%", hasTitle ? "55%" : "50%"],
      roseType: variant === "rose" ? "radius" : undefined,
      data: data.categories.map((name, index) => ({ name, value: values[index] ?? 0 })),
      label: chart.compact
        ? { show: false }
        : chart.showLabels
          ? { show: true, fontSize: 10, formatter: "{b}: {c} ({d}%)" }
          : { show: true, fontSize: 10, formatter: "{d}%" },
      itemStyle: { borderColor: "#fff", borderWidth: 1 },
    }],
  };
}

function scatterOption(chart, data, colors, options) {
  const xs = data.categories.map((value, index) => toChartNumber(value) ?? index + 1);
  const bubble = chart.variant === "bubble";
  const sizes = bubble ? data.series[1]?.values ?? [] : [];
  const maxSize = Math.max(1, ...sizes.map((value) => Math.abs(value ?? 0)));
  const plotted = bubble ? data.series.slice(0, 1) : data.series;
  return {
    ...baseOption(chart, colors, options),
    grid: gridFor(chart),
    xAxis: { type: "value", scale: true, ...AXIS_STYLE, ...axisName(chart.xAxisTitle) },
    yAxis: { type: "value", scale: true, ...AXIS_STYLE, ...axisName(chart.yAxisTitle) },
    series: plotted.map((item) => ({
      name: item.name,
      type: "scatter",
      data: item.values.map((value, index) => (value === null ? null : bubble ? [xs[index], value, sizes[index] ?? 0] : [xs[index], value])).filter(Boolean),
      symbolSize: bubble ? (point) => 8 + (Math.sqrt(Math.abs(point[2])) / Math.sqrt(maxSize)) * 36 : 9,
      itemStyle: bubble ? { opacity: 0.7 } : undefined,
      label: labelOption(chart, { position: "top", formatter: (params) => params.value[1] }),
    })),
  };
}

function stockOption(chart, data, colors, options) {
  const [open, close, low, high] = data.series;
  return {
    ...baseOption(chart, colors, options),
    legend: { show: false },
    grid: gridFor({ ...chart, legend: "none" }),
    xAxis: { type: "category", data: data.categories, ...AXIS_STYLE, axisLabel: categoryLabelStyle(data.categories), splitLine: { show: false }, ...axisName(chart.xAxisTitle) },
    yAxis: { type: "value", scale: true, ...AXIS_STYLE, ...axisName(chart.yAxisTitle) },
    series: [{
      type: "candlestick",
      name: "주가",
      // 한국 표기: 상승 빨강, 하락 파랑
      itemStyle: { color: "#e5484d", color0: "#2f6fd6", borderColor: "#e5484d", borderColor0: "#2f6fd6" },
      data: data.categories.map((_, index) => [open?.values[index], close?.values[index], low?.values[index], high?.values[index]]),
    }],
  };
}

function heatmapOption(chart, data, colors, options) {
  const points = [];
  data.series.forEach((item, y) => item.values.forEach((value, x) => {
    if (value !== null) points.push([x, y, value]);
  }));
  const values = points.map((point) => point[2]);
  return {
    ...baseOption(chart, colors, options),
    legend: { show: false },
    grid: { ...gridFor({ ...chart, legend: "none" }), bottom: 44 + (chart.xAxisTitle ? 18 : 0) },
    xAxis: { type: "category", data: data.categories, ...AXIS_STYLE, splitArea: { show: true }, ...axisName(chart.xAxisTitle) },
    yAxis: { type: "category", data: data.series.map((item) => item.name), ...AXIS_STYLE, splitArea: { show: true }, ...axisName(chart.yAxisTitle) },
    visualMap: {
      min: Math.min(...values, 0),
      max: Math.max(...values, 1),
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemHeight: 120,
      itemWidth: 10,
      textStyle: { fontSize: 9 },
      inRange: { color: ["#eef3fb", colors[0]] },
    },
    series: [{ type: "heatmap", data: points, label: { show: chart.showLabels !== false, fontSize: 9 } }],
  };
}

function radarOption(chart, data, colors, options) {
  const max = Math.max(1, ...data.series.flatMap((item) => item.values.map((value) => value ?? 0)));
  const hasTitle = chart.showTitle !== false && chart.title;
  return {
    ...baseOption(chart, colors, options),
    radar: {
      indicator: data.categories.map((name) => ({ name, max: Math.ceil(max * 1.1) })),
      radius: "62%",
      center: ["50%", hasTitle ? "55%" : "50%"],
      axisName: { fontSize: 10, color: "#5d6678" },
      splitLine: { lineStyle: { color: "#e1e4ea" } },
    },
    series: [{
      type: "radar",
      data: data.series.map((item) => ({
        name: item.name,
        value: item.values.map((value) => value ?? 0),
        areaStyle: chart.variant === "filled" ? { opacity: 0.25 } : undefined,
        label: labelOption(chart),
      })),
    }],
  };
}

function hierarchyOption(chart, data, colors, options) {
  const tree = buildHierarchy(data.categories, data.series[0]?.values ?? []);
  const hasTitle = chart.showTitle !== false && chart.title;
  if (chart.category === "sunburst") {
    return {
      ...baseOption(chart, colors, options),
      legend: { show: false },
      series: [{
        type: "sunburst",
        data: tree,
        radius: ["12%", "88%"],
        center: ["50%", hasTitle ? "55%" : "50%"],
        sort: undefined,
        label: { fontSize: 10, rotate: "radial" },
        itemStyle: { borderColor: "#fff", borderWidth: 1 },
      }],
    };
  }
  return {
    ...baseOption(chart, colors, options),
    legend: { show: false },
    series: [{
      type: "treemap",
      data: tree,
      top: hasTitle ? 34 : 6,
      left: 6,
      right: 6,
      bottom: 6,
      roam: false,
      nodeClick: false,
      breadcrumb: { show: false },
      label: { show: true, fontSize: 11, formatter: chart.showLabels ? "{b}\n{c}" : "{b}" },
      upperLabel: { show: true, height: 18, fontSize: 10 },
      levels: [{ itemStyle: { borderColor: "#fff", borderWidth: 2, gapWidth: 2 } }, { colorSaturation: [0.35, 0.6], itemStyle: { gapWidth: 1, borderColorSaturation: 0.7 } }],
    }],
  };
}

function histogramOption(chart, data, colors, options) {
  const bins = histogramBins(data.series[0]?.values ?? [], Number(chart.histogramBins) || 0);
  return {
    ...baseOption(chart, colors, options),
    legend: { show: false },
    grid: gridFor({ ...chart, legend: "none" }),
    xAxis: { type: "category", data: bins.map((bin) => bin.label), ...AXIS_STYLE, splitLine: { show: false }, ...axisName(chart.xAxisTitle || data.series[0]?.name) },
    yAxis: { type: "value", minInterval: 1, ...AXIS_STYLE, ...axisName(chart.yAxisTitle || "개수") },
    series: [{ type: "bar", name: "개수", data: bins.map((bin) => bin.count), barCategoryGap: "2%", label: labelOption(chart, { position: "top" }) }],
  };
}

function boxplotOption(chart, data, colors, options) {
  return {
    ...baseOption(chart, colors, options),
    legend: { show: false },
    grid: gridFor({ ...chart, legend: "none" }),
    xAxis: { type: "category", data: data.series.map((item) => item.name), ...AXIS_STYLE, splitLine: { show: false }, ...axisName(chart.xAxisTitle) },
    yAxis: { type: "value", scale: true, ...AXIS_STYLE, ...axisName(chart.yAxisTitle) },
    series: [{
      type: "boxplot",
      data: data.series.map((item, index) => ({ value: boxStats(item.values), itemStyle: { color: `${colors[index % colors.length]}55`, borderColor: colors[index % colors.length] } })),
    }],
  };
}

function waterfallOption(chart, data, colors, options) {
  const steps = waterfallSteps(data.categories, data.series[0]?.values ?? []);
  const label = () => labelOption(chart, { position: "top", formatter: (params) => (params.value ? params.value : "") });
  return {
    ...baseOption(chart, colors, options),
    legend: chart.legend === "none" ? { show: false } : { ...baseOption(chart, colors, options).legend, data: ["증가", "감소", "합계"] },
    grid: gridFor(chart),
    xAxis: { type: "category", data: steps.map((step) => step.label), ...AXIS_STYLE, axisLabel: categoryLabelStyle(steps.map((step) => step.label)), splitLine: { show: false }, ...axisName(chart.xAxisTitle) },
    yAxis: { type: "value", ...AXIS_STYLE, ...axisName(chart.yAxisTitle) },
    series: [
      { type: "bar", stack: "waterfall", silent: true, itemStyle: { color: "transparent", borderColor: "transparent" }, data: steps.map((step) => step.base), barMaxWidth: 40 },
      { type: "bar", name: "증가", stack: "waterfall", itemStyle: { color: colors[0] }, data: steps.map((step) => step.increase || null), label: label("increase") },
      { type: "bar", name: "감소", stack: "waterfall", itemStyle: { color: colors[1] }, data: steps.map((step) => step.decrease || null), label: label("decrease") },
      { type: "bar", name: "합계", stack: "waterfall", itemStyle: { color: colors[2] }, data: steps.map((step) => step.total ?? null), label: label("total") },
    ],
  };
}

function funnelOption(chart, data, colors, options) {
  const values = data.series[0]?.values ?? [];
  const hasTitle = chart.showTitle !== false && chart.title;
  return {
    ...baseOption(chart, colors, options),
    series: [{
      type: "funnel",
      name: data.series[0]?.name,
      top: hasTitle ? 36 : 10,
      bottom: (chart.legend ?? "bottom") === "bottom" ? 30 : 10,
      left: "12%",
      width: "76%",
      sort: "descending",
      gap: 2,
      data: data.categories.map((name, index) => ({ name, value: values[index] ?? 0 })),
      label: { show: true, position: "inside", fontSize: 10, color: "#fff", formatter: chart.showLabels ? "{b}: {c}" : "{b}" },
      itemStyle: { borderColor: "#fff", borderWidth: 1 },
    }],
  };
}

// ---------- 차트 스타일(chart.style) ----------
// 종류별 옵션을 만든 뒤 배경·글자색·눈금선·막대 모서리·선 두께를 한 번에 덧입힌다.

function axisList(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function applyChartStyle(option, chart) {
  const style = chart?.style;
  if (!style || typeof style !== "object") return option;
  const isColor = (value) => typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value);

  if (isColor(style.backgroundColor)) option.backgroundColor = style.backgroundColor;

  const text = isColor(style.textColor) ? style.textColor : "";
  if (text) {
    option.textStyle = { ...option.textStyle, color: text };
    if (option.title) option.title = { ...option.title, textStyle: { ...option.title.textStyle, color: text } };
    if (option.legend && option.legend.show !== false) option.legend = { ...option.legend, textStyle: { ...option.legend.textStyle, color: text } };
    if (option.radar) option.radar = { ...option.radar, axisName: { ...option.radar.axisName, color: text } };
    if (option.visualMap) option.visualMap = { ...option.visualMap, textStyle: { ...option.visualMap.textStyle, color: text } };
  }

  for (const key of ["xAxis", "yAxis"]) {
    for (const axis of axisList(option[key])) {
      if (text) {
        axis.axisLabel = { ...axis.axisLabel, color: text };
        if (axis.nameTextStyle) axis.nameTextStyle = { ...axis.nameTextStyle, color: text };
      }
      // 값 축 눈금선만 바꾼다(항목 축은 원래 눈금선이 없다).
      if (axis.type === "value" && axis.splitLine?.show !== false) {
        axis.splitLine = {
          ...axis.splitLine,
          show: style.gridLines !== false,
          lineStyle: { ...axis.splitLine?.lineStyle, ...(isColor(style.gridColor) ? { color: style.gridColor } : {}) },
        };
      }
      if (isColor(style.gridColor)) axis.axisLine = { ...axis.axisLine, lineStyle: { ...axis.axisLine?.lineStyle, color: style.gridColor } };
    }
  }
  if (option.radar && isColor(style.gridColor)) {
    option.radar = { ...option.radar, splitLine: { lineStyle: { color: style.gridColor } }, axisLine: { lineStyle: { color: style.gridColor } } };
  }

  const radius = Math.min(16, Math.max(0, Number(style.barRadius) || 0));
  const lineWidth = Math.min(6, Math.max(1, Number(style.lineWidth) || 2));
  const horizontal = chart.category === "bar";
  for (const series of option.series ?? []) {
    if (series.type === "bar" && !series.silent && radius) {
      series.itemStyle = { ...series.itemStyle, borderRadius: horizontal ? [0, radius, radius, 0] : [radius, radius, 0, 0] };
    }
    if (series.type === "line") {
      series.lineStyle = { ...series.lineStyle, width: lineWidth };
    }
    // 원형·깔때기 등의 조각 사이 선은 배경색에 맞춘다.
    if (isColor(style.backgroundColor) && series.itemStyle?.borderColor === "#fff") {
      series.itemStyle = { ...series.itemStyle, borderColor: style.backgroundColor };
    }
    if (text && series.label?.show && !series.label.color && series.type !== "funnel") {
      series.label = { ...series.label, color: text };
    }
  }
  return option;
}

export function buildChartOption(chart, data, { interactive = false } = {}) {
  const colors = resolveChartColors(chart);
  const options = { interactive };
  const option = applyChartStyle(buildOptionForCategory(chart, data, colors, options), chart);
  // 작은 미리보기(차트 삽입 창의 세부 종류)는 글자를 숨겨 모양만 보여 준다.
  if (chart?.compact) {
    for (const axisKey of ["xAxis", "yAxis"]) {
      const axes = Array.isArray(option[axisKey]) ? option[axisKey] : option[axisKey] ? [option[axisKey]] : [];
      axes.forEach((axis) => {
        axis.axisLabel = { show: false };
        axis.name = undefined;
      });
    }
    if (option.radar) option.radar.axisName = { show: false };
    if (option.visualMap) option.visualMap.show = false;
    option.series?.forEach((item) => {
      if (item.type === "funnel" || item.type === "treemap" || item.type === "sunburst") item.label = { show: false };
      if (item.type === "treemap") item.upperLabel = { show: false };
    });
    if (option.grid) option.grid = { left: 2, right: 2, top: 4, bottom: 2, containLabel: false };
  }
  return option;
}

function buildOptionForCategory(chart, data, colors, options) {
  switch (chart?.category) {
    case "pie": return pieOption(chart, data, colors, options);
    case "scatter": return scatterOption(chart, data, colors, options);
    case "stock": return stockOption(chart, data, colors, options);
    case "heatmap": return heatmapOption(chart, data, colors, options);
    case "radar": return radarOption(chart, data, colors, options);
    case "treemap":
    case "sunburst": return hierarchyOption(chart, data, colors, options);
    case "histogram": return histogramOption(chart, data, colors, options);
    case "boxplot": return boxplotOption(chart, data, colors, options);
    case "waterfall": return waterfallOption(chart, data, colors, options);
    case "funnel": return funnelOption(chart, data, colors, options);
    default: return cartesianOption({ ...chart, category: chart?.category ?? "column" }, data, colors, options);
  }
}
