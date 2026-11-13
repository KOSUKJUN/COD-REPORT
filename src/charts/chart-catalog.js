// 차트 종류 목록(Word '차트 삽입' 구성)과 기본 데이터·색상표.
// 렌더링은 Apache ECharts(Apache-2.0)를 사용한다.

const STACK_VARIANTS = (shape) => [
  { id: "clustered", label: `묶은 ${shape}` },
  { id: "stacked", label: `누적 ${shape}` },
  { id: "percent", label: `100% 기준 누적 ${shape}` },
];

export const CHART_CATEGORIES = [
  {
    id: "column",
    label: "세로 막대형",
    variants: STACK_VARIANTS("세로 막대형"),
    dataHint: "항목(X축)과 계열별 값을 연결합니다.",
  },
  {
    id: "line",
    label: "꺾은선형",
    variants: [
      { id: "line", label: "꺾은선형" },
      { id: "markers", label: "표식이 있는 꺾은선형" },
      { id: "stacked", label: "누적 꺾은선형" },
      { id: "smooth", label: "부드러운 꺾은선형" },
      { id: "step", label: "계단형 꺾은선형" },
    ],
    dataHint: "항목(X축)과 계열별 값을 연결합니다.",
  },
  {
    id: "pie",
    label: "원형",
    variants: [
      { id: "pie", label: "원형" },
      { id: "doughnut", label: "도넛형" },
      { id: "rose", label: "장미형" },
    ],
    dataHint: "항목과 첫 번째 계열의 값만 사용합니다.",
  },
  {
    id: "bar",
    label: "가로 막대형",
    variants: STACK_VARIANTS("가로 막대형"),
    dataHint: "항목(Y축)과 계열별 값을 연결합니다.",
  },
  {
    id: "area",
    label: "영역형",
    variants: STACK_VARIANTS("영역형").map((variant) =>
      variant.id === "clustered" ? { id: "area", label: "영역형" } : variant,
    ),
    dataHint: "항목(X축)과 계열별 값을 연결합니다.",
  },
  {
    id: "scatter",
    label: "분산형",
    variants: [
      { id: "scatter", label: "분산형" },
      { id: "bubble", label: "거품형" },
    ],
    dataHint: "항목에 X 값(숫자), 계열에 Y 값을 넣습니다. 거품형은 두 번째 계열이 거품 크기입니다.",
  },
  {
    id: "stock",
    label: "주식형",
    variants: [{ id: "ohlc", label: "시가-종가-저가-고가" }],
    dataHint: "계열 4개를 시가·종가·저가·고가 순서로 연결합니다.",
    minSeries: 4,
  },
  {
    id: "heatmap",
    label: "히트맵",
    variants: [{ id: "heatmap", label: "히트맵" }],
    dataHint: "항목이 X축, 계열 이름이 Y축이 되고 값의 크기를 색으로 표시합니다.",
  },
  {
    id: "radar",
    label: "방사형",
    variants: [
      { id: "radar", label: "방사형" },
      { id: "filled", label: "채워진 방사형" },
    ],
    dataHint: "항목이 축(꼭짓점)이 되고 계열마다 다각형 하나를 그립니다.",
  },
  {
    id: "treemap",
    label: "트리맵",
    variants: [{ id: "treemap", label: "트리맵" }],
    dataHint: "항목과 첫 번째 계열 값을 사용합니다. 항목을 '상위/하위'처럼 / 로 나누면 계층으로 묶습니다.",
  },
  {
    id: "sunburst",
    label: "선버스트",
    variants: [{ id: "sunburst", label: "선버스트" }],
    dataHint: "항목을 '상위/하위'처럼 / 로 나누면 안쪽부터 계층으로 표시합니다. 값은 첫 번째 계열입니다.",
  },
  {
    id: "histogram",
    label: "히스토그램",
    variants: [{ id: "histogram", label: "히스토그램" }],
    dataHint: "첫 번째 계열의 값들을 구간으로 나눠 개수를 셉니다.",
  },
  {
    id: "boxplot",
    label: "상자 수염",
    variants: [{ id: "boxplot", label: "상자 수염" }],
    dataHint: "계열마다 값들의 최솟값·사분위수·중앙값·최댓값을 상자로 표시합니다.",
  },
  {
    id: "waterfall",
    label: "폭포",
    variants: [{ id: "waterfall", label: "폭포" }],
    dataHint: "첫 번째 계열을 증감 값으로 보고 누적 흐름을 그립니다. 마지막에 합계 막대를 붙입니다.",
  },
  {
    id: "funnel",
    label: "깔때기형",
    variants: [{ id: "funnel", label: "깔때기형" }],
    dataHint: "항목과 첫 번째 계열 값을 큰 값부터 단계로 표시합니다.",
  },
  {
    id: "combo",
    label: "혼합",
    variants: [
      { id: "bar-line", label: "묶은 세로 막대형 - 꺾은선형" },
      { id: "bar-line-secondary", label: "묶은 세로 막대형 - 꺾은선형, 보조 축" },
      { id: "area-bar", label: "누적 영역형 - 묶은 세로 막대형" },
    ],
    dataHint: "마지막 계열이 꺾은선(또는 첫 계열이 영역)이 됩니다. 계열마다 그래프 모양을 직접 고를 수도 있습니다.",
  },
];

export function getChartCategory(id) {
  return CHART_CATEGORIES.find((category) => category.id === id) ?? CHART_CATEGORIES[0];
}

export function getChartVariant(categoryId, variantId) {
  const category = getChartCategory(categoryId);
  return category.variants.find((variant) => variant.id === variantId) ?? category.variants[0];
}

export function chartTypeLabel(chart) {
  return getChartVariant(chart?.category, chart?.variant).label;
}

// Word 기본 차트 데이터(항목 1~4, 계열 1~3)
const DEFAULT_DATA = {
  categories: ["항목 1", "항목 2", "항목 3", "항목 4"],
  series: [
    { name: "계열 1", values: [4.3, 2.5, 3.5, 4.5] },
    { name: "계열 2", values: [2.4, 4.4, 1.8, 2.8] },
    { name: "계열 3", values: [2, 2, 3, 5] },
  ],
};

const SAMPLE_DATA = {
  pie: { categories: ["1분기", "2분기", "3분기", "4분기"], series: [{ name: "판매", values: [8.2, 3.2, 1.4, 1.2] }] },
  funnel: { categories: ["탐지", "분석", "조치 요구", "조치 완료"], series: [{ name: "건수", values: [120, 64, 22, 15] }] },
  scatter: { categories: ["0.7", "1.8", "2.6", "3.4", "4.1", "5.0"], series: [{ name: "Y 값", values: [2.7, 3.2, 0.8, 4.4, 3.1, 4.9] }, { name: "크기", values: [10, 4, 8, 6, 12, 5] }] },
  stock: {
    categories: ["11/01", "11/02", "11/03", "11/04", "11/05"],
    series: [
      { name: "시가", values: [44, 25, 38, 50, 34] },
      { name: "종가", values: [25, 38, 50, 34, 40] },
      { name: "저가", values: [20, 22, 36, 30, 30] },
      { name: "고가", values: [55, 41, 52, 58, 46] },
    ],
  },
  treemap: { categories: ["보안/탐지", "보안/분석", "보안/조치", "운영/점검", "운영/장애"], series: [{ name: "건수", values: [42, 28, 12, 20, 6] }] },
  sunburst: { categories: ["보안/탐지/웹", "보안/탐지/네트워크", "보안/분석", "운영/점검", "운영/장애"], series: [{ name: "건수", values: [24, 18, 28, 20, 6] }] },
  histogram: { categories: [], series: [{ name: "응답 시간", values: [12, 15, 17, 18, 21, 22, 22, 24, 25, 27, 28, 30, 31, 33, 36, 38, 41, 45, 52, 60] }] },
  boxplot: {
    categories: [],
    series: [
      { name: "1월", values: [12, 15, 18, 21, 24, 27, 33] },
      { name: "2월", values: [10, 14, 19, 22, 26, 30, 38] },
      { name: "3월", values: [14, 17, 20, 23, 25, 29, 31] },
    ],
  },
  waterfall: { categories: ["기초", "1분기", "2분기", "3분기", "4분기"], series: [{ name: "증감", values: [100, 30, -20, 45, -15] }] },
};

export function defaultChartData(categoryId) {
  return JSON.parse(JSON.stringify(SAMPLE_DATA[categoryId] ?? DEFAULT_DATA));
}

export const CHART_PALETTES = [
  { id: "office", label: "기본 (Office)", colors: ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47", "#264478", "#9E480E"] },
  { id: "blue", label: "파랑 계열", colors: ["#1F4E79", "#2E75B6", "#5B9BD5", "#9DC3E6", "#BDD7EE", "#DEEBF7", "#203864", "#8FAADC"] },
  { id: "green", label: "초록 계열", colors: ["#375623", "#548235", "#70AD47", "#A9D18E", "#C5E0B4", "#E2F0D9", "#385723", "#92D050"] },
  { id: "warm", label: "따뜻한 색", colors: ["#C00000", "#ED7D31", "#FFC000", "#F4B183", "#FF7C80", "#BF9000", "#843C0C", "#FFD966"] },
  { id: "mono", label: "회색조", colors: ["#262626", "#595959", "#7F7F7F", "#A6A6A6", "#BFBFBF", "#D9D9D9", "#404040", "#8C8C8C"] },
  { id: "teal", label: "청록 계열", colors: ["#0B6E6E", "#14A3A3", "#4CC9C0", "#9BE3DC", "#2F8F9D", "#C6F1EC", "#06494A", "#7FD1C7"] },
  { id: "purple", label: "보라 계열", colors: ["#4B2A86", "#7048B6", "#9C7AD9", "#C9B5EE", "#5E3A9E", "#E4DAF7", "#32195E", "#B497E6"] },
  { id: "pastel", label: "파스텔", colors: ["#8FB8DE", "#F4B6A6", "#B5D99C", "#F6D186", "#C3B1E1", "#9ED9D3", "#F2A7C3", "#D4C4A8"] },
  { id: "vivid", label: "선명한 색", colors: ["#E63946", "#1D7FE0", "#2BB673", "#F7B32B", "#8E44AD", "#FF7F11", "#00A6A6", "#D81E5B"] },
  { id: "ocean", label: "바다", colors: ["#03256C", "#2541B2", "#1768AC", "#06BEE1", "#7FD8F0", "#B9E8F5", "#0B3C5D", "#3E92CC"] },
];

export function getPalette(id) {
  return (CHART_PALETTES.find((palette) => palette.id === id) ?? CHART_PALETTES[0]).colors;
}

// 계열(또는 원형·깔때기는 항목)별로 직접 고른 색을 팔레트 위에 덮어쓴다.
// chart.style.seriesColors = ["#hex" | "" ...]  ("" = 팔레트 색 그대로)
export function resolveChartColors(chart) {
  const palette = getPalette(chart?.palette);
  const overrides = Array.isArray(chart?.style?.seriesColors) ? chart.style.seriesColors : [];
  const length = Math.max(palette.length, overrides.length);
  return Array.from({ length }, (_, index) =>
    /^#[0-9a-f]{3,8}$/i.test(overrides[index] ?? "") ? overrides[index] : palette[index % palette.length],
  );
}

// 차트 스타일 (Word '차트 스타일' 갤러리와 같은 개념). 고르면 아래 값으로 바꾸고, 이후 하나씩 다시 고칠 수 있다.
// chart.style = {
//   backgroundColor: "" | "#hex",  // 차트 배경 (없으면 투명 = 용지색)
//   textColor: "" | "#hex",        // 제목·범례·축 글자 색
//   gridLines: true | false,       // 값 축 눈금선
//   gridColor: "" | "#hex",        // 눈금선 색
//   barRadius: 0~16,               // 막대 모서리 둥글기(px)
//   lineWidth: 1~6,                // 꺾은선 두께(px)
//   borderColor: "" | "#hex",      // 차트 테두리
//   seriesColors: [],              // 계열별 색 (resolveChartColors 참고)
// }
export const CHART_STYLE_PRESETS = [
  { id: "default", label: "기본", style: { backgroundColor: "", textColor: "", gridLines: true, gridColor: "", barRadius: 0, lineWidth: 2, borderColor: "" } },
  { id: "rounded", label: "둥근 막대", style: { backgroundColor: "", textColor: "", gridLines: true, gridColor: "", barRadius: 6, lineWidth: 2, borderColor: "" } },
  { id: "clean", label: "눈금선 없음", style: { backgroundColor: "", textColor: "", gridLines: false, gridColor: "", barRadius: 2, lineWidth: 2, borderColor: "" } },
  { id: "bold", label: "굵게", style: { backgroundColor: "", textColor: "#1f2633", gridLines: true, gridColor: "#d5d9e2", barRadius: 0, lineWidth: 4, borderColor: "" } },
  { id: "soft", label: "연한 배경", style: { backgroundColor: "#f4f7fc", textColor: "", gridLines: true, gridColor: "#dde4f0", barRadius: 4, lineWidth: 2, borderColor: "#dde4f0" } },
  { id: "framed", label: "테두리", style: { backgroundColor: "#ffffff", textColor: "", gridLines: true, gridColor: "", barRadius: 0, lineWidth: 2, borderColor: "#9aa3b5" } },
  { id: "dark", label: "어두운 배경", style: { backgroundColor: "#1f2633", textColor: "#e6e9ef", gridLines: true, gridColor: "#3a4354", barRadius: 3, lineWidth: 2, borderColor: "" } },
];

export function chartStylePreset(id) {
  return CHART_STYLE_PRESETS.find((preset) => preset.id === id) ?? CHART_STYLE_PRESETS[0];
}

export function createChartConfig(categoryId = "column", variantId) {
  return {
    category: categoryId,
    variant: getChartVariant(categoryId, variantId).id,
    title: "차트 제목",
    showTitle: true,
    legend: "bottom",
    showLabels: false,
    xAxisTitle: "",
    yAxisTitle: "",
    height: 260,
    palette: "office",
    histogramBins: 0,
  };
}
