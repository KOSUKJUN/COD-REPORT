import test from "node:test";
import assert from "node:assert/strict";
import * as echarts from "echarts";
import {
  CHART_CATEGORIES,
  CHART_STYLE_PRESETS,
  chartStylePreset,
  createChartConfig,
  defaultChartData,
  resolveChartColors,
} from "../src/charts/chart-catalog.js";
import {
  boxStats,
  buildChartOption,
  buildHierarchy,
  getChartDataIssue,
  histogramBins,
  resolveChartData,
  toChartNumber,
  waterfallSteps,
} from "../src/charts/chart-options.js";

function renderSvg(option) {
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 480, height: 260 });
  try {
    chart.setOption(option);
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

test("every chart category and variant renders with its sample data", () => {
  for (const category of CHART_CATEGORIES) {
    for (const variant of category.variants) {
      const chart = createChartConfig(category.id, variant.id);
      const data = resolveChartData({ chartData: defaultChartData(category.id) });
      assert.equal(getChartDataIssue(chart, data), "", `${category.id}/${variant.id} sample data is valid`);
      const svg = renderSvg(buildChartOption(chart, data));
      assert.match(svg, /^<svg/, `${category.id}/${variant.id}`);
      assert.ok(svg.length > 1500, `${category.id}/${variant.id} draws something`);
    }
  }
});

test("compact thumbnails render every category without text", () => {
  for (const category of CHART_CATEGORIES) {
    const chart = { ...createChartConfig(category.id), showTitle: false, legend: "none", compact: true };
    const svg = renderSvg(buildChartOption(chart, resolveChartData({ chartData: defaultChartData(category.id) })));
    assert.match(svg, /^<svg/, category.id);
  }
});

test("maps DB query rows to chart categories and series", () => {
  const block = {
    chartData: { categories: ["무시"], series: [] },
    dataBinding: {
      enabled: true,
      rows: [{ org: "A", total: "1,200", rate: "12%" }, { org: "B", total: 800, rate: null }],
      chartMapping: {
        categoryField: "org",
        series: [{ field: "total", name: "합계" }, { field: "rate", chartType: "line", secondaryAxis: true }, { field: "" }],
      },
    },
  };
  assert.deepEqual(resolveChartData(block), {
    categories: ["A", "B"],
    series: [
      { name: "합계", values: [1200, 800] },
      { name: "rate", values: [12, null], chartType: "line", secondaryAxis: true },
    ],
  });
  block.dataBinding.enabled = false;
  assert.deepEqual(resolveChartData(block).categories, ["무시"]);
});

test("reports data problems instead of drawing a broken chart", () => {
  const chart = createChartConfig("stock");
  assert.match(getChartDataIssue(chart, { categories: ["a"], series: [{ name: "x", values: [1] }] }), /계열 4개/);
  assert.match(getChartDataIssue(createChartConfig("column"), { categories: ["a"], series: [] }), /계열이 없습니다/);
  assert.match(getChartDataIssue(createChartConfig("column"), { categories: ["a"], series: [{ name: "x", values: [null] }] }), /숫자 값이 없습니다/);
  assert.match(getChartDataIssue(createChartConfig("scatter", "bubble"), { categories: ["1"], series: [{ name: "y", values: [1] }] }), /거품형/);
});

test("computes percent stacks, histogram bins, box stats, waterfall and hierarchy", () => {
  const option = buildChartOption(createChartConfig("column", "percent"), {
    categories: ["a", "b"],
    series: [{ name: "x", values: [1, 3] }, { name: "y", values: [3, 1] }],
  });
  assert.deepEqual(option.series.map((item) => item.data), [[25, 75], [75, 25]]);
  assert.equal(option.yAxis.max, 100);

  assert.deepEqual(histogramBins([1, 2, 3, 4], 2), [{ label: "1–2.5", count: 2 }, { label: "2.5–4", count: 2 }]);
  assert.deepEqual(boxStats([1, 2, 3, 4, 5, null]), [1, 2, 3, 4, 5]);
  assert.deepEqual(waterfallSteps(["a", "b"], [10, -4]).map((step) => [step.base, step.increase, step.decrease, step.total]), [
    [0, 10, 0, undefined], [6, 0, 4, undefined], [0, 0, 0, 6],
  ]);
  assert.deepEqual(buildHierarchy(["A/x", "A/y", "B"], [1, 2, 3]), [
    { name: "A", children: [{ name: "x", value: 1 }, { name: "y", value: 2 }] },
    { name: "B", value: 3 },
  ]);
  assert.equal(toChartNumber("1,234.5"), 1234.5);
  assert.equal(toChartNumber("abc"), null);

  const crowded = buildChartOption(createChartConfig("column"), {
    categories: Array.from({ length: 8 }, (_, index) => `아주 긴 항목 이름 ${index + 1}`),
    series: [{ name: "x", values: [1, 2, 3, 4, 5, 6, 7, 8] }],
  });
  assert.equal(crowded.xAxis.axisLabel.interval, 0, "every category label is shown");
  assert.equal(crowded.xAxis.axisLabel.rotate, 30, "crowded labels are rotated");

  const combo = buildChartOption(createChartConfig("combo", "bar-line-secondary"), defaultChartData("combo"));
  assert.deepEqual(combo.series.map((item) => [item.type, item.yAxisIndex]), [["bar", 0], ["bar", 0], ["line", 1]]);
  assert.equal(combo.yAxis.length, 2);
});

test("chart style presets apply background, text, grid, bar corners and line width", () => {
  const chart = { ...createChartConfig("column"), style: { ...chartStylePreset("dark").style, barRadius: 6 } };
  const option = buildChartOption(chart, defaultChartData("column"));
  assert.equal(option.backgroundColor, "#1f2633");
  assert.equal(option.title.textStyle.color, "#e6e9ef");
  assert.equal(option.legend.textStyle.color, "#e6e9ef");
  assert.equal(option.yAxis.splitLine.lineStyle.color, "#3a4354");
  assert.deepEqual(option.series[0].itemStyle.borderRadius, [6, 6, 0, 0]);

  const horizontal = buildChartOption({ ...createChartConfig("bar"), style: { barRadius: 4 } }, defaultChartData("bar"));
  assert.deepEqual(horizontal.series[0].itemStyle.borderRadius, [0, 4, 4, 0]);

  const clean = buildChartOption({ ...createChartConfig("line"), style: { gridLines: false, lineWidth: 5 } }, defaultChartData("line"));
  assert.equal(clean.yAxis.splitLine.show, false);
  assert.equal(clean.series[0].lineStyle.width, 5);
});

test("per-series colors override the palette and invalid colors are ignored", () => {
  const chart = { ...createChartConfig("column"), palette: "blue", style: { seriesColors: ["", "#ff0000", "nope"] } };
  const colors = resolveChartColors(chart);
  assert.equal(colors[0], "#1F4E79");
  assert.equal(colors[1], "#ff0000");
  assert.equal(colors[2], "#5B9BD5");
  assert.equal(buildChartOption(chart, defaultChartData("column")).color[1], "#ff0000");
});

test("every chart type still renders with every style preset", () => {
  for (const category of CHART_CATEGORIES) {
    for (const preset of CHART_STYLE_PRESETS) {
      const chart = { ...createChartConfig(category.id), style: preset.style };
      const svg = renderSvg(buildChartOption(chart, defaultChartData(category.id)));
      assert.match(svg, /<svg/, `${category.id}/${preset.id}`);
    }
  }
});
