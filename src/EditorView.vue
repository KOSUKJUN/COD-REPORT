<script setup>
import TemplateMailSettings from "./components/TemplateMailSettings.vue";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import ReportSettings from "./components/ReportSettings.vue";
import FontToolbar from "./components/FontToolbar.vue";
import { fillSummaryTemplate, hasCellFields } from "./data-binding.js";
import { getDatasourceType } from "./datasource-url.js";
import ReportCanvas from "./components/ReportCanvas.vue";
import ActionIcon from "./components/ActionIcon.vue";
import ToolNav from "./components/ToolNav.vue";
import ChartDataDialog from "./components/ChartDataDialog.vue";
import ChartInsertDialog from "./components/ChartInsertDialog.vue";
import ChartTypeIcon from "./components/ChartTypeIcon.vue";
import {
  CHART_PALETTES,
  CHART_STYLE_PRESETS,
  chartStylePreset,
  chartTypeLabel,
  createChartConfig,
  defaultChartData,
  resolveChartColors,
} from "./charts/chart-catalog.js";
import { resolveChartData } from "./charts/chart-options.js";
import { SHAPE_GROUPS, createShapeConfig, getShape, shapeSvgMarkup } from "./shapes.js";
import HeaderFooterDialog from "./components/HeaderFooterDialog.vue";
import TemplateTransferDialog from "./components/TemplateTransferDialog.vue";
import AssistantPanel from "./components/AssistantPanel.vue";
import { exportTemplatePages, importTemplatePages } from "./template-transfer.js";
import { ROLE_LABELS } from "./user-admin.js";
import { downloadBlob } from "./report-export/download.js";
import {
  MAX_BLOCK_HEIGHT,
  MIN_BLOCK_HEIGHT,
  SPLIT_PRESETS,
  WIDTH_PRESETS,
  applySplit,
  clampHeight,
  clampWidth,
  getLayout,
  heightTarget,
  isFree,
} from "./layout.js";
import {
  FOOTER_GALLERY,
  HEADER_GALLERY,
  applyGallery,
  clearArea,
  hasPageNumber,
  insertPageNumber,
  removePageNumbers,
} from "./header-footer.js";
import { ensureTableColumns, useTextFormatting } from "./composables/useTextFormatting.js";
import { getColumnWidths, normalizeColumnWidths } from "./table-size.js";
import {
  CUSTOM_SIZE_LIMITS,
  PAPER_SIZES,
  describePageSetup,
  getPageDimensions,
  isDefaultPageSetup,
  normalizePageSetup,
  paperDimensionText,
  printWithPageSetup,
} from "./page-setup.js";
import {
  executeDataQuery,
  createTemplate,
  deleteTemplate,
  getDatabaseStatus,
  getDatasources,
  getSchedules,
  getTemplateAccessOptions,
  getTemplates,
  normalizeTableBlock,
  saveSchedule,
  updateTemplateAccess,
  updateTemplate,
} from "./reports-api.js";
import {
  getNextScheduleRun,
  getReportPeriod,
  getScheduleClock,
  resolveScheduleParameters,
} from "./report-scheduler.js";

const props = defineProps({
  authUser: { type: Object, required: true },
});
const emit = defineEmits(["logout", "help", "select-tool"]);

function getLocalDate() {
  return getScheduleClock(new Date()).date;
}

// 양식은 모두 DB에 저장된 일반 양식이다. 아무 양식도 열지 않았을 때(reportType === "")는
// 저장되지 않은 새 양식을 편집하며, 저장하면 새 양식으로 만들어진다.
const NEW_TEMPLATE = { label: "새 양식", group: "양식", layoutType: "daily" };

const insertableItems = [
  { type: "title", label: "제목", icon: "T" },
  { type: "text", label: "텍스트", icon: "¶" },
  { type: "section", label: "업무 항목", icon: "▤" },
  { type: "table", label: "표", icon: "▦" },
  { type: "special", label: "특이사항", icon: "!" },
  { type: "subheading", label: "구분 제목", icon: "H" },
  { type: "period", label: "기간", icon: "◷" },
  { type: "date", label: "작성일", icon: "▣" },
  { type: "divider", label: "구분선", icon: "—" },
];

// Word '일러스트레이션' 그룹: 그림 · 도형 · 차트
const illustrationItems = [
  { type: "image", label: "그림" },
  { type: "shape", label: "도형" },
  { type: "chart", label: "차트" },
];
const INSERTABLE_TYPES = new Set([...insertableItems, ...illustrationItems].map((item) => item.type));

let nextId = 0;

function createBlock(type, properties = {}) {
  return {
    id: `report-item-${Date.now()}-${++nextId}`,
    type,
    heading: "",
    content: "",
    fontSize: type === "title" ? 27 : 14,
    align: "left",
    ...properties,
  };
}

// 아무 양식도 열지 않았을 때 편집하는 새 양식의 처음 내용
function createNewTemplateBlocks() {
  return [
    createBlock("title", { content: NEW_TEMPLATE.label }),
    createBlock("date"),
    createBlock("divider"),
  ];
}

const reportType = ref("");
const date = ref(getLocalDate());
// 양식 목록을 불러온 뒤 첫 양식(없으면 새 양식)을 연다.
const blocks = ref([]);
const pages = ref([{ id: `report-page-${Date.now()}`, blocks: blocks.value }]);
const currentPageIndex = ref(0);
const pendingReportType = ref(reportType.value);
const customTemplates = ref([]);
const catalogError = ref("");
const collapsedTemplateGroups = ref({});
const templateSearch = ref("");
const managerMode = ref("detail");
const managerTab = ref("info");
const managerNotice = ref(null);
const managerConfirm = ref(null);
const managerBusy = ref(false);
const renameDraft = ref(null);
const newTemplateDraft = ref(createNewTemplateDraft());
const templateSaveBusy = ref(false);
const templateError = ref("");
const scheduleRows = ref([]);
const scheduleDraft = ref(null);
const scheduleBusy = ref(false);
const scheduleError = ref("");
const scheduleLoadFailed = ref(false);
const isTemplateManagerOpen = ref(false);
const templateSearchInput = ref(null);
const templateAccessOptions = ref({ groups: [], users: [] });
const templateAccessLoaded = ref(false);
const templateAccessError = ref("");
let templateAccessLoadToken = 0;
const templateAccessDraft = ref({ groups: [], users: [] });
const savedPagesSnapshot = ref("");
// 현재 양식의 머리글·바닥글·페이지 번호 설정 (없으면 null)
const headerFooter = ref(null);
// 현재 양식의 용지 크기·방향 (없으면 A4 세로)
const pageSetup = ref(null);
const pageDimensions = computed(() => getPageDimensions(pageSetup.value));
const pageSetupText = computed(() => describePageSetup(pageSetup.value));
const customPaperDraft = ref({ widthMm: 210, heightMm: 297 });
// 편집 용지에 본문 영역(여백 안쪽) 경계 표시 — 브라우저에 기억한다.
const SHOW_BOUNDARIES_KEY = "cod-report.editor.showBoundaries";
function readShowBoundaries() {
  try {
    return localStorage.getItem(SHOW_BOUNDARIES_KEY) === "1";
  } catch {
    return false;
  }
}
const showBoundaries = ref(readShowBoundaries());
function toggleBoundaries() {
  showBoundaries.value = !showBoundaries.value;
  try {
    localStorage.setItem(SHOW_BOUNDARIES_KEY, showBoundaries.value ? "1" : "0");
  } catch {
    // 저장할 수 없어도 이번 화면에서는 적용한다.
  }
}
let managerNoticeTimer;

const layoutTypeLabels = { daily: "일간", weekly: "주간", monthly: "월간" };

// 양식 아이콘 모서리에 표시할 주기 글자 (일/주/월)
function templateInitial(template) {
  return (layoutTypeLabels[template?.layoutType] ?? "일간").slice(0, 1);
}
const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];
const blockTypeLabels = Object.fromEntries(
  [...insertableItems, ...illustrationItems].map((item) => [item.type, item.label]),
);

function createNewTemplateDraft(overrides = {}) {
  return {
    label: "",
    group: "양식",
    source: "current",
    layoutType: "daily",
    scheduleEnabled: true,
    access: { groups: [], users: [] },
    ...overrides,
  };
}
const isPreviewOpen = ref(false);
const selectedId = ref(blocks.value[0]?.id ?? "");
const zoom = ref(100);

// ---------- 왼쪽(페이지)·오른쪽(속성) 패널 너비 조절 ----------
// 사용자가 조절한 너비만 저장한다. 저장값이 없으면 CSS 기본값(창 크기별)을 쓴다.
const PANEL_WIDTH_STORAGE_KEY = "cod-report.editor.panel-widths";
const PANEL_LIMITS = {
  toolbox: { min: 150, max: 420 },
  properties: { min: 200, max: 560 },
};
const MIN_CANVAS_WIDTH = 360;
const designerGrid = ref(null);
const panelWidths = ref(readPanelWidths());

function readPanelWidths() {
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY) || "{}");
    const widths = {};
    for (const [panel, { min, max }] of Object.entries(PANEL_LIMITS)) {
      if (Number.isFinite(saved[panel])) widths[panel] = Math.min(max, Math.max(min, saved[panel]));
    }
    return widths;
  } catch {
    return {};
  }
}

function savePanelWidths() {
  try {
    localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify(panelWidths.value));
  } catch {
    // 저장소를 쓸 수 없어도 현재 화면에서는 조절한 너비가 유지된다.
  }
}

const designerGridStyle = computed(() => ({
  ...(panelWidths.value.toolbox ? { "--toolbox-width": `${panelWidths.value.toolbox}px` } : {}),
  ...(panelWidths.value.properties ? { "--properties-width": `${panelWidths.value.properties}px` } : {}),
}));

function panelElement(panel) {
  return designerGrid.value?.querySelector(panel === "toolbox" ? ".toolbox" : ".properties-panel");
}

// 캔버스가 너무 좁아지지 않도록 반대쪽 패널 너비를 빼고 최대값을 정한다.
function clampPanelWidth(panel, width) {
  const other = panelElement(panel === "toolbox" ? "properties" : "toolbox");
  const gridWidth = designerGrid.value?.clientWidth ?? window.innerWidth;
  const room = gridWidth - (other?.offsetWidth ?? 0) - MIN_CANVAS_WIDTH;
  const { min, max } = PANEL_LIMITS[panel];
  return Math.round(Math.max(min, Math.min(max, room, width)));
}

function setPanelWidth(panel, width) {
  panelWidths.value = { ...panelWidths.value, [panel]: clampPanelWidth(panel, width) };
}

function startPanelResize(panel, event) {
  if (event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget;
  const startX = event.clientX;
  const startWidth = panelElement(panel)?.offsetWidth ?? 0;
  // 왼쪽 패널은 오른쪽으로 끌면 넓어지고, 오른쪽 패널은 왼쪽으로 끌면 넓어진다.
  const direction = panel === "toolbox" ? 1 : -1;
  handle.setPointerCapture(event.pointerId);
  document.body.classList.add("panel-resizing");
  const onMove = (moveEvent) => {
    setPanelWidth(panel, startWidth + (moveEvent.clientX - startX) * direction);
  };
  const onEnd = () => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onEnd);
    handle.removeEventListener("pointercancel", onEnd);
    document.body.classList.remove("panel-resizing");
    savePanelWidths();
  };
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onEnd);
  handle.addEventListener("pointercancel", onEnd);
}

function resizePanelByKey(panel, event) {
  const step = event.shiftKey ? 40 : 10;
  const grow = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (event.key === "Home" || event.key === "Enter") {
    resetPanelWidth(panel);
    event.preventDefault();
    return;
  }
  if (!grow) return;
  event.preventDefault();
  const current = panelElement(panel)?.offsetWidth ?? 0;
  setPanelWidth(panel, current + grow * step * (panel === "toolbox" ? 1 : -1));
  savePanelWidths();
}

function resetPanelWidth(panel) {
  const { [panel]: _removed, ...rest } = panelWidths.value;
  panelWidths.value = rest;
  savePanelWidths();
}

const selectedTableRow = ref(0);
const selectedTableColumn = ref(0);
const selectedCells = ref([{ row: 0, column: 0 }]);
const cellSelectionAnchor = ref(null);
const isCellDragging = ref(false);
const isDraggingBlock = ref(false);

const selectedBlock = computed(
  () => blocks.value.find((block) => block.id === selectedId.value) ?? null,
);
const activeTemplate = computed(() =>
  customTemplates.value.find((template) => template.id === reportType.value) ??
  NEW_TEMPLATE,
);
const activeLayoutType = computed(
  () => activeTemplate.value.layoutType ?? reportType.value,
);
const templateGroups = computed(() => {
  const groupedTemplates = new Map();
  const normalizeGroup = (group) =>
    ["기본 양식", "내 양식", "양식"].includes(group) ? "" : group;
  for (const template of customTemplates.value) {
    const group = normalizeGroup(template.group);
    if (!groupedTemplates.has(group)) groupedTemplates.set(group, []);
    groupedTemplates.get(group).push(template);
  }
  return [...groupedTemplates.entries()]
    .map(([name, groupTemplates]) => ({
      name,
      templates: [...groupTemplates].sort((left, right) =>
        left.label.localeCompare(right.label, "ko"),
      ),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "ko"));
});
const allTemplateCount = computed(() =>
  templateGroups.value.reduce((count, group) => count + group.templates.length, 0),
);
const filteredTemplateGroups = computed(() => {
  const query = templateSearch.value.trim().toLocaleLowerCase("ko");
  return templateGroups.value
    .map((group) => ({
      ...group,
      templates: group.templates.filter((template) => {
        if (!query) return true;
        return [template.label, template.group, template.title ?? ""]
          .some((value) => value.toLocaleLowerCase("ko").includes(query));
      }),
    }))
    .filter((group) => group.templates.length);
});
const visibleTemplateIds = computed(() =>
  filteredTemplateGroups.value.flatMap((group) =>
    isTemplateGroupOpen(group.name) ? group.templates.map((template) => template.id) : [],
  ),
);
const customTemplateGroupNames = computed(() =>
  [...new Set(customTemplates.value
    .map((template) => template.group)
    .filter((group) => !["기본 양식", "내 양식", "양식"].includes(group)))]
    .sort((left, right) => left.localeCompare(right, "ko")),
);
const managerTemplate = computed(() => getTemplateById(pendingReportType.value));
const managerTemplateIsCustom = computed(() => isCustomTemplateId(pendingReportType.value));
const managerTemplateStats = computed(() => {
  const template = managerTemplate.value;
  if (!template) return null;
  const templatePages = pendingReportType.value === reportType.value
    ? currentEditorPages()
    : getStoredTemplatePages(template);
  const counts = new Map();
  let blockCount = 0;
  for (const page of templatePages) {
    for (const block of page.blocks ?? []) {
      blockCount += 1;
      counts.set(block.type, (counts.get(block.type) ?? 0) + 1);
    }
  }
  return {
    pageCount: templatePages.length,
    blockCount,
    bindingCount: templatePages.reduce(
      (count, page) =>
        count + (page.blocks ?? []).filter((block) => block.dataBinding?.enabled).length,
      0,
    ),
    composition: [...counts.entries()]
      .map(([type, count]) => ({ type, label: blockTypeLabels[type] ?? type, count }))
      .sort((left, right) => right.count - left.count),
  };
});
const savedManagerSchedule = computed(() =>
  scheduleRows.value.find((schedule) => schedule.templateId === pendingReportType.value) ?? null,
);
const scheduleDirty = computed(() => {
  if (!scheduleDraft.value || !managerTemplateIsCustom.value) return false;
  const saved = savedManagerSchedule.value;
  if (!saved) return true;
  return ["enabled", "frequency", "time", "weekday", "dayOfMonth"].some(
    (key) => String(saved[key]) !== String(scheduleDraft.value[key]),
  );
});
const nextScheduleRun = computed(() =>
  scheduleDraft.value ? getNextScheduleRun(scheduleDraft.value) : null,
);
const newTemplateDuplicate = computed(() => {
  const label = newTemplateDraft.value.label.trim();
  const group = newTemplateDraft.value.group.trim();
  return Boolean(label) && customTemplates.value.some(
    (template) => template.group === group && template.label === label,
  );
});
const renameDuplicate = computed(() => {
  if (!renameDraft.value) return false;
  const label = renameDraft.value.label.trim();
  const group = renameDraft.value.group.trim();
  return customTemplates.value.some(
    (template) =>
      template.id !== pendingReportType.value &&
      template.group === group &&
      template.label === label,
  );
});
const scheduleClockTick = ref(Date.now());
let scheduleClockTimer;
const editorScheduleSummary = computed(() => {
  const id = reportType.value;
  if (!isCustomTemplateId(id)) {
    return {
      enabled: false,
      text: "저장되지 않은 새 양식 · 양식을 저장하면 자동 생성을 설정할 수 있습니다",
    };
  }
  if (scheduleLoadFailed.value) {
    return { enabled: false, text: "자동 생성 일정을 불러오지 못했습니다" };
  }
  const schedule = scheduleRows.value.find((item) => item.templateId === id);
  if (!schedule) {
    return { enabled: false, text: "자동 생성 일정 확인 중..." };
  }
  if (!schedule.enabled) {
    return { enabled: false, text: "자동 생성 꺼짐" };
  }
  const nextRun = getNextScheduleRun(schedule, new Date(scheduleClockTick.value));
  return {
    enabled: true,
    text: `자동 생성 ${describeSchedule(id)}${nextRun ? ` · 다음 ${formatNextRun(nextRun)}` : ""} (한국시간)`,
  };
});
const currentBlockCount = computed(() =>
  currentEditorPages().reduce((count, page) => count + page.blocks.length, 0),
);
const newTemplateScheduleText = computed(() => {
  const type = newTemplateDraft.value.layoutType;
  if (type === "weekly") return "매주 월요일 08:00";
  if (type === "monthly") return "매월 1일 08:00";
  return "매일 08:00";
});
const hasUnsavedEditorChanges = computed(
  () => Boolean(savedPagesSnapshot.value) &&
    serializePages(currentEditorPages()) !== savedPagesSnapshot.value,
);
function canLeave() {
  if (saveState.value === "saving") {
    window.alert("양식 저장이 완료된 후 이동해 주세요.");
    return false;
  }
  return !hasUnsavedEditorChanges.value || window.confirm("저장하지 않은 변경사항이 있습니다. 이동하시겠습니까?");
}
defineExpose({ canLeave });

function handleBeforeUnload(event) {
  if (hasUnsavedEditorChanges.value || saveState.value === "saving") {
    event.preventDefault();
    event.returnValue = "";
  }
}
const canMergeCells = computed(() =>
  selectedBlock.value?.type === "table" &&
  isMergeSelectionAvailable(selectedBlock.value, selectedCells.value),
);
const canUnmergeCells = computed(() =>
  selectedBlock.value?.type === "table" &&
  selectedBlock.value.merges?.some((merge) =>
    selectedCells.value.some(
      (cell) => cell.row === merge.row && cell.column === merge.column,
    ),
  ),
);
const reportLabel = computed(() => activeTemplate.value.label);

const saveStatus = ref("");
const saveState = ref("idle");
const databaseConfigured = ref(false);
const bindingBusy = ref(false);
const bindingMessage = ref("");
const summaryBindingBusy = ref(false);
const summaryBindingMessage = ref("");
const datasources = ref([]);
const isReportSettingsOpen = ref(false);
const summaryTemplateInput = ref(null);

function pagesFromTemplate(type) {
  const template = customTemplates.value.find((item) => item.id === type);
  if (!template) {
    return [{ id: `report-page-${Date.now()}-${++nextId}`, blocks: createNewTemplateBlocks() }];
  }
  const templatePages = Array.isArray(template.pages) && template.pages.length
    ? template.pages
    : [{ blocks: template.blocks }];
  return templatePages.map((page) => ({
    id: `report-page-${Date.now()}-${++nextId}`,
    blocks: page.blocks.map((block) => ({
      ...(block.type === "table" ? normalizeTableBlock(block) : block),
      id: `report-item-${Date.now()}-${++nextId}`,
    })),
  }));
}

function selectCellRange(start, end) {
  const top = Math.min(start.row, end.row);
  const bottom = Math.max(start.row, end.row);
  const left = Math.min(start.column, end.column);
  const right = Math.max(start.column, end.column);
  const range = [];

  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      range.push({ row, column });
    }
  }

  selectedCells.value = range;
}

function getCellSelectionBounds(cells) {
  if (!cells.length) {
    return null;
  }

  const top = Math.min(...cells.map((cell) => cell.row));
  const bottom = Math.max(...cells.map((cell) => cell.row));
  const left = Math.min(...cells.map((cell) => cell.column));
  const right = Math.max(...cells.map((cell) => cell.column));
  const width = right - left + 1;
  const height = bottom - top + 1;
  if (cells.length !== width * height) {
    return null;
  }

  return { top, bottom, left, right, width, height };
}

function isMergeSelectionAvailable(table, cells) {
  const bounds = getCellSelectionBounds(cells);
  if (!bounds || (bounds.width === 1 && bounds.height === 1)) {
    return false;
  }

  return !(table.merges ?? []).some(
    (merge) =>
      merge.row <= bounds.bottom &&
      merge.row + merge.rowspan - 1 >= bounds.top &&
      merge.column <= bounds.right &&
      merge.column + merge.colspan - 1 >= bounds.left,
  );
}

function beginCellSelection(row, column, event) {
  if (event.button !== 0 || !selectedBlock.value) {
    return;
  }

  const cell = { row, column };
  const additive = event.ctrlKey || event.metaKey;
  selectedTableRow.value = row;
  selectedTableColumn.value = column;

  if (event.shiftKey && cellSelectionAnchor.value) {
    selectCellRange(cellSelectionAnchor.value, cell);
    isCellDragging.value = false;
    return;
  }

  if (additive) {
    selectedCells.value = isCellSelected(row, column)
      ? selectedCells.value.filter(
          (selected) => selected.row !== row || selected.column !== column,
        )
      : [...selectedCells.value, cell];
    cellSelectionAnchor.value = cell;
    isCellDragging.value = false;
    return;
  }

  cellSelectionAnchor.value = cell;
  selectedCells.value = [cell];
  isCellDragging.value = true;
}

function extendCellSelection(row, column) {
  if (isCellDragging.value && cellSelectionAnchor.value) {
    selectCellRange(cellSelectionAnchor.value, { row, column });
  }
}

function endCellSelection() {
  isCellDragging.value = false;
}

function setSelectedCellShade(color) {
  const table = selectedBlock.value;
  if (table?.type !== "table") {
    return;
  }

  ensureTableColumns(table);
  selectedCells.value.forEach(({ row, column }) => {
    const tableRow = table.rows[row];
    if (tableRow) {
      tableRow.cellStyles[column] = { ...tableRow.cellStyles[column], backgroundColor: color };
    }
  });
}

// ---------- 글꼴 서식 (요소 전체 또는 선택한 표 셀) — 뷰어와 공용 ----------

const {
  fontFormatTarget,
  fontStyleState,
  fontTargetLabel,
  applyFontPatch,
  toggleFontStyle,
  setFontSize,
  setTextAlignment,
  stepFontSize,
  changeSelectionCase,
  clearFontFormatting,
  handleFontShortcut,
} = useTextFormatting({
  selectedBlock,
  selectedCells,
  layoutType: activeLayoutType,
  blockLabel: (block) => blockLabel(block),
});

async function saveEditorTemplate() {
  if (!isCustomTemplateId(reportType.value)) {
    openTemplateManager();
    startCreateTemplate({ label: "", source: "current" });
    templateError.value = "아직 저장하지 않은 새 양식입니다. 이름과 그룹을 정해 양식으로 저장하세요.";
    return;
  }

  saveState.value = "saving";
  saveStatus.value = "보고서 양식을 저장하고 있습니다.";
  try {
    pages.value[currentPageIndex.value].blocks = blocks.value;
    const updatedTemplate = await updateTemplate(reportType.value, {
      label: activeTemplate.value.label,
      group: activeTemplate.value.group,
      layoutType: activeLayoutType.value,
      blocks: blocks.value,
      pages: pages.value,
      headerFooter: headerFooter.value,
      pageSetup: pageSetup.value,
    });
    const templateIndex = customTemplates.value.findIndex(
      (template) => template.id === updatedTemplate.id,
    );
    if (templateIndex >= 0) {
      customTemplates.value[templateIndex] = updatedTemplate;
    }
    markEditorSaved();
    saveState.value = "saved";
    saveStatus.value = "양식을 저장했습니다. 설정된 예약 시각에 보고서가 자동 생성됩니다.";
  } catch (error) {
    saveState.value = "error";
    saveStatus.value = `양식을 저장하지 못했습니다: ${error.message}`;
  }
}

async function changeReportType(type) {
  reportType.value = type;
  pages.value = pagesFromTemplate(type);
  currentPageIndex.value = 0;
  blocks.value = pages.value[0].blocks;
  selectedId.value = blocks.value[0]?.id ?? "";
  const template = customTemplates.value.find((item) => item.id === type);
  headerFooter.value = template?.headerFooter ? JSON.parse(JSON.stringify(template.headerFooter)) : null;
  pageSetup.value = template?.pageSetup ? normalizePageSetup(template.pageSetup) : null;
  markEditorSaved();
}

function isCustomTemplateId(id) {
  return typeof id === "string" && id.startsWith("custom-");
}

function currentEditorPages() {
  return pages.value.map((page, index) =>
    index === currentPageIndex.value ? { ...page, blocks: blocks.value } : page,
  );
}

const isTransferOpen = ref(false);
function exportCurrentTemplate() {
  try {
    const document = exportTemplatePages(currentEditorPages());
    importTemplatePages(document);
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
    if (blob.size > 10 * 1024 * 1024) throw new Error("내보낼 양식은 10MB 이하여야 합니다. 그림 크기를 줄여 주세요.");
    const filename = `${reportLabel.value.replace(/[\\/:*?"<>|]/g, "_") || "report-template"}.json`;
    downloadBlob(blob, filename);
  } catch (error) {
    window.alert(`양식을 내보내지 못했습니다: ${error.message}`);
  }
}

function appendImportedPages(importedPages) {
  pages.value[currentPageIndex.value].blocks = blocks.value;
  const firstIndex = pages.value.length;
  for (const page of importedPages) {
    pages.value.push({
      id: `report-page-${Date.now()}-${++nextId}`,
      blocks: page.blocks.map((block) => ({
        ...(block.type === "table" ? normalizeTableBlock(block) : block),
        id: `report-item-${Date.now()}-${++nextId}`,
      })),
    });
  }
  currentPageIndex.value = firstIndex;
  blocks.value = pages.value[firstIndex].blocks;
  selectedId.value = "";
  selectedCells.value = [];
  cellSelectionAnchor.value = null;
  if (blocks.value[0]) selectBlock(blocks.value[0].id);
  isTransferOpen.value = false;
  saveStatus.value = `${importedPages.length}개 페이지를 추가했습니다. 양식을 저장해 주세요.`;
}

function getStoredTemplatePages(template) {
  return Array.isArray(template.pages) && template.pages.length
    ? template.pages
    : [{ blocks: template.blocks ?? [] }];
}

// 저장하지 않은 변경 감지용: 페이지 요소와 머리글·바닥글을 함께 비교한다.
function serializePages(value) {
  return JSON.stringify({
    pages: value.map((page) => page.blocks),
    headerFooter: headerFooter.value ?? null,
    pageSetup: pageSetup.value ?? null,
  });
}

function markEditorSaved() {
  savedPagesSnapshot.value = serializePages(currentEditorPages());
}

function isTemplateGroupOpen(name) {
  return Boolean(templateSearch.value.trim()) || !collapsedTemplateGroups.value[name];
}

function showManagerNotice(text, type = "success") {
  clearTimeout(managerNoticeTimer);
  managerNotice.value = { text, type };
  managerNoticeTimer = setTimeout(() => {
    managerNotice.value = null;
  }, 3600);
}

function describeSchedule(templateId) {
  if (!isCustomTemplateId(templateId)) {
    return "자동 생성 없음";
  }
  const schedule = scheduleRows.value.find((item) => item.templateId === templateId);
  if (!schedule?.enabled) {
    return "자동 생성 꺼짐";
  }
  if (schedule.frequency === "weekly") {
    return `매주 ${weekdayLabels[Number(schedule.weekday)]}요일 ${schedule.time}`;
  }
  if (schedule.frequency === "monthly") {
    return `매월 ${schedule.dayOfMonth}일 ${schedule.time}`;
  }
  return `매일 ${schedule.time}`;
}

function isScheduleEnabled(templateId) {
  return isCustomTemplateId(templateId) &&
    Boolean(scheduleRows.value.find((item) => item.templateId === templateId)?.enabled);
}

function formatNextRun(run) {
  if (!run) return "";
  const today = getScheduleClock(new Date()).date;
  const [year, month, day] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  const relative = run.date === today ? "오늘 " : run.date === tomorrow ? "내일 " : "";
  return `${relative}${run.date.replaceAll("-", ".")} (${weekdayLabels[run.weekday]}) ${run.time}`;
}

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "—";
  return parsed.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function templateGroupLabel(group) {
  return ["기본 양식", "내 양식", "양식"].includes(group) ? "양식" : group;
}

function uniqueTemplateLabel(base, group) {
  const taken = new Set(
    customTemplates.value
      .filter((template) => template.group === group)
      .map((template) => template.label),
  );
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
}

function focusManagerElement(selector) {
  nextTick(() => {
    document.querySelector(selector)?.focus();
  });
}

async function openTemplateManager() {
  const accessLoadToken = ++templateAccessLoadToken;
  pendingReportType.value = reportType.value;
  templateError.value = "";
  templateAccessLoaded.value = false;
  templateAccessError.value = "";
  templateAccessOptions.value = { groups: [], users: [] };
  scheduleError.value = "";
  managerMode.value = "detail";
  managerTab.value = "info";
  managerConfirm.value = null;
  managerNotice.value = null;
  renameDraft.value = null;
  templateSearch.value = "";
  const selectedTemplate = getTemplateById(pendingReportType.value);
  templateAccessDraft.value = {
    groups: [...(selectedTemplate?.access?.groups ?? [])],
    users: [...(selectedTemplate?.access?.users ?? [])],
  };
  loadPendingSchedule();
  isTemplateManagerOpen.value = true;
  nextTick(() => templateSearchInput.value?.focus());
  if (catalogError.value) {
    try {
      await loadTemplateCatalog();
      catalogError.value = "";
    } catch (error) {
      catalogError.value = `양식 목록을 불러오지 못했습니다: ${error.message}`;
    }
  }
  try {
    const options = await getTemplateAccessOptions();
    if (accessLoadToken !== templateAccessLoadToken) return;
    templateAccessOptions.value = options;
    templateAccessLoaded.value = true;
  } catch (error) {
    if (accessLoadToken !== templateAccessLoadToken) return;
    templateAccessError.value = `결과 열람 권한 목록을 불러오지 못했습니다: ${error.message}`;
  }
  try {
    scheduleRows.value = await getSchedules();
    scheduleLoadFailed.value = false;
    loadPendingSchedule();
  } catch (error) {
    scheduleError.value = `예약 일정을 불러오지 못했습니다: ${error.message}`;
  }
}

function openScheduleSettings() {
  openTemplateManager();
  managerTab.value = "schedule";
}

function openReportSettings() {
  if (props.authUser.role === "ADMIN") {
    isReportSettingsOpen.value = true;
  }
}

async function refreshEditorSchedules() {
  try {
    scheduleRows.value = await getSchedules();
    scheduleLoadFailed.value = false;
  } catch {
    scheduleLoadFailed.value = true;
  }
}

function closeTemplateManager() {
  if (managerBusy.value || templateSaveBusy.value) return;
  templateAccessLoadToken += 1;
  isTemplateManagerOpen.value = false;
  managerConfirm.value = null;
  renameDraft.value = null;
}

function handleManagerEscape() {
  if (managerConfirm.value) {
    managerConfirm.value = null;
  } else if (renameDraft.value) {
    renameDraft.value = null;
  } else if (managerMode.value === "create") {
    cancelCreateTemplate();
  } else {
    closeTemplateManager();
  }
}

function selectManagerTemplate(id) {
  if (managerMode.value === "create") {
    managerMode.value = "detail";
  }
  if (pendingReportType.value === id) return;
  pendingReportType.value = id;
  const selectedTemplate = getTemplateById(id);
  templateAccessDraft.value = {
    groups: [...(selectedTemplate?.access?.groups ?? [])],
    users: [...(selectedTemplate?.access?.users ?? [])],
  };
  renameDraft.value = null;
  managerConfirm.value = null;
  templateError.value = "";
  loadPendingSchedule();
}

async function persistTemplateAccess() {
  const template = managerTemplate.value;
  if (!template || !managerTemplateIsCustom.value || managerBusy.value || !templateAccessLoaded.value) return;
  managerBusy.value = true;
  templateError.value = "";
  try {
    const access = await updateTemplateAccess(template.id, templateAccessDraft.value);
    const index = customTemplates.value.findIndex((item) => item.id === template.id);
    if (index >= 0) customTemplates.value[index] = { ...customTemplates.value[index], access };
    templateAccessDraft.value = {
      groups: [...access.groups],
      users: [...access.users],
    };
    showManagerNotice("생성 결과 열람 권한을 저장했습니다.");
  } catch (error) {
    templateError.value = `결과 열람 권한을 저장하지 못했습니다: ${error.message}`;
  } finally {
    managerBusy.value = false;
  }
}

function handleTemplateListKeydown(event) {
  const ids = visibleTemplateIds.value;
  if (!ids.length) return;
  const index = ids.indexOf(pendingReportType.value);
  let nextIndex = null;
  if (event.key === "ArrowDown") nextIndex = index < 0 ? 0 : Math.min(index + 1, ids.length - 1);
  else if (event.key === "ArrowUp") nextIndex = index < 0 ? 0 : Math.max(index - 1, 0);
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = ids.length - 1;
  else if (event.key === "Enter" && index >= 0) {
    if (!(event.target instanceof HTMLElement) || !event.target.closest("[data-template-id]")) {
      return;
    }
    event.preventDefault();
    requestOpenTemplate(ids[index]);
    return;
  }
  if (nextIndex === null) return;
  event.preventDefault();
  selectManagerTemplate(ids[nextIndex]);
  focusManagerElement(`[data-template-id="${ids[nextIndex]}"]`);
}

function handleTemplateSearchKeydown(event) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    const firstId = visibleTemplateIds.value[0];
    if (firstId) {
      selectManagerTemplate(firstId);
      focusManagerElement(`[data-template-id="${firstId}"]`);
    }
  }
}

async function requestOpenTemplate(id = pendingReportType.value) {
  if (id === reportType.value) {
    closeTemplateManager();
    return;
  }
  if (hasUnsavedEditorChanges.value) {
    managerConfirm.value = { kind: "discard", templateId: id };
    return;
  }
  await openTemplateInEditor(id);
}

async function openTemplateInEditor(id) {
  await changeReportType(id);
  managerConfirm.value = null;
  isTemplateManagerOpen.value = false;
  saveState.value = "idle";
  saveStatus.value = "";
}

function startCreateTemplate(overrides = {}) {
  managerMode.value = "create";
  managerConfirm.value = null;
  renameDraft.value = null;
  templateError.value = "";
  newTemplateDraft.value = createNewTemplateDraft({
    group: isCustomTemplateId(reportType.value) ? activeTemplate.value.group : "양식",
    layoutType: activeLayoutType.value,
    ...overrides,
  });
  focusManagerElement("#new-template-label");
}

function cancelCreateTemplate() {
  managerMode.value = "detail";
  templateError.value = "";
}

function startRenameTemplate() {
  const template = managerTemplate.value;
  if (!template || !managerTemplateIsCustom.value) return;
  managerConfirm.value = null;
  managerTab.value = "info";
  renameDraft.value = { label: template.label, group: template.group };
  focusManagerElement("#rename-template-label");
}

async function saveRenameTemplate() {
  const template = managerTemplate.value;
  const label = renameDraft.value?.label.trim();
  const group = renameDraft.value?.group.trim();
  if (!template || !label || !group || renameDuplicate.value || managerBusy.value) return;
  if (label === template.label && group === template.group) {
    renameDraft.value = null;
    return;
  }
  managerBusy.value = true;
  templateError.value = "";
  try {
    const updated = await updateTemplate(template.id, {
      label,
      group,
      layoutType: template.layoutType,
      blocks: template.blocks ?? [],
      pages: template.pages,
      // 이름만 바꿔도 양식 전체를 다시 저장하므로 머리글·바닥글·용지 설정을 함께 보낸다.
      headerFooter: template.headerFooter ?? null,
      pageSetup: template.pageSetup ?? null,
    });
    const index = customTemplates.value.findIndex((item) => item.id === template.id);
    if (index >= 0) {
      customTemplates.value[index] = { ...template, ...updated };
    }
    collapsedTemplateGroups.value[group] = false;
    renameDraft.value = null;
    showManagerNotice("양식 정보를 변경했습니다.");
  } catch (error) {
    templateError.value = `양식 정보를 변경하지 못했습니다: ${error.message}`;
  } finally {
    managerBusy.value = false;
  }
}

async function duplicateManagerTemplate() {
  const template = managerTemplate.value;
  if (!template || managerBusy.value) return;
  managerBusy.value = true;
  managerConfirm.value = null;
  templateError.value = "";
  try {
    const group = isCustomTemplateId(template.id) ? template.group : "양식";
    const sourcePages = getStoredTemplatePages(template).map((page, index) => ({
      id: page.id ?? `report-page-${Date.now()}-${index}`,
      blocks: page.blocks,
    }));
    const created = await createTemplate({
      label: uniqueTemplateLabel(`${template.label} 사본`, group),
      group,
      layoutType: template.layoutType ?? "daily",
      blocks: sourcePages[0]?.blocks ?? [],
      pages: sourcePages,
      headerFooter: template.headerFooter ?? null,
      pageSetup: template.pageSetup ?? null,
      access: template.access ?? { groups: [], users: [] },
    });
    customTemplates.value.push(created);
    const sourceSchedule = scheduleRows.value.find((item) => item.templateId === template.id);
    const copiedSchedule = await saveSchedule(created.id, sourceSchedule
      ? {
          enabled: sourceSchedule.enabled,
          frequency: sourceSchedule.frequency,
          time: sourceSchedule.time,
          weekday: Number(sourceSchedule.weekday),
          dayOfMonth: Number(sourceSchedule.dayOfMonth),
        }
      : {
          enabled: false,
          frequency: created.layoutType,
          time: "08:00",
          weekday: 1,
          dayOfMonth: 1,
        });
    scheduleRows.value = [
      ...scheduleRows.value.filter((item) => item.templateId !== created.id),
      copiedSchedule,
    ];
    templateSearch.value = "";
    collapsedTemplateGroups.value[group] = false;
    selectManagerTemplate(created.id);
    showManagerNotice(`'${created.label}' 양식으로 복제했습니다. 이름을 바로 바꿀 수 있습니다.`);
    startRenameTemplate();
  } catch (error) {
    templateError.value = `양식을 복제하지 못했습니다: ${error.message}`;
  } finally {
    managerBusy.value = false;
  }
}

function requestDeleteTemplate() {
  if (!managerTemplateIsCustom.value) return;
  renameDraft.value = null;
  managerConfirm.value = { kind: "delete", templateId: pendingReportType.value };
}

async function confirmDeleteTemplate() {
  const id = managerConfirm.value?.templateId;
  const template = getTemplateById(id);
  if (!template || managerBusy.value) return;
  managerBusy.value = true;
  templateError.value = "";
  try {
    await deleteTemplate(id);
    customTemplates.value = customTemplates.value.filter((item) => item.id !== id);
    scheduleRows.value = scheduleRows.value.filter((item) => item.templateId !== id);
    managerConfirm.value = null;
    if (reportType.value === id) {
      // 편집 중인 양식을 지웠으면 남은 첫 양식을, 하나도 없으면 새 양식을 연다.
      await changeReportType(firstTemplateId());
    }
    pendingReportType.value = reportType.value;
    loadPendingSchedule();
    showManagerNotice(`'${template.label}' 양식을 삭제했습니다.`);
  } catch (error) {
    managerConfirm.value = null;
    templateError.value = `양식을 삭제하지 못했습니다: ${error.message}`;
  } finally {
    managerBusy.value = false;
  }
}

function getTemplateById(id) {
  return customTemplates.value.find((template) => template.id === id) ?? null;
}

function firstTemplateId() {
  return templateGroups.value[0]?.templates[0]?.id ?? "";
}

function loadPendingSchedule() {
  const savedSchedule = scheduleRows.value.find(
    (schedule) => schedule.templateId === pendingReportType.value,
  );
  const template = getTemplateById(pendingReportType.value);
  scheduleDraft.value = savedSchedule
    ? { ...savedSchedule }
    : {
        enabled: true,
        frequency: template?.layoutType ?? "daily",
        time: "08:00",
        weekday: 1,
        dayOfMonth: 1,
      };
  scheduleError.value = "";
}

async function persistSchedule() {
  if (!pendingReportType.value.startsWith("custom-") || !scheduleDraft.value) {
    return;
  }
  scheduleBusy.value = true;
  scheduleError.value = "";
  try {
    const savedSchedule = await saveSchedule(
      pendingReportType.value,
      scheduleDraft.value,
    );
    const index = scheduleRows.value.findIndex(
      (schedule) => schedule.templateId === savedSchedule.templateId,
    );
    if (index < 0) {
      scheduleRows.value.push(savedSchedule);
    } else {
      scheduleRows.value[index] = savedSchedule;
    }
    scheduleDraft.value = { ...savedSchedule };
    showManagerNotice(
      savedSchedule.enabled ? "자동 생성 일정을 저장했습니다." : "자동 생성을 껐습니다.",
    );
  } catch (error) {
    scheduleError.value = `예약 일정을 저장하지 못했습니다: ${error.message}`;
  } finally {
    scheduleBusy.value = false;
  }
}

function toggleTemplateGroup(group) {
  collapsedTemplateGroups.value[group] = !collapsedTemplateGroups.value[group];
}

async function saveNewTemplate() {
  const draft = newTemplateDraft.value;
  const label = draft.label.trim();
  const group = draft.group.trim();
  if (!label || !group || newTemplateDuplicate.value || templateSaveBusy.value || !templateAccessLoaded.value) {
    return;
  }

  templateSaveBusy.value = true;
  templateError.value = "";
  try {
    const templatePages = draft.source === "current"
      ? currentEditorPages().map((page) => ({ id: page.id, blocks: page.blocks }))
      : [{
          id: `report-page-${Date.now()}-${++nextId}`,
          blocks: [
            createBlock("title", { content: label }),
            createBlock("date"),
            createBlock("divider"),
          ],
        }];
    const template = await createTemplate({
      label,
      group,
      layoutType: draft.layoutType,
      blocks: templatePages[0].blocks,
      pages: templatePages,
      headerFooter: draft.source === "current" ? headerFooter.value : null,
      pageSetup: draft.source === "current" ? pageSetup.value : null,
      access: draft.access,
    });
    customTemplates.value.push(template);
    if (!draft.scheduleEnabled) {
      await saveSchedule(template.id, {
        enabled: false,
        frequency: draft.layoutType,
        time: "08:00",
        weekday: 1,
        dayOfMonth: 1,
      }).catch(() => {});
    }
    scheduleRows.value = await getSchedules().catch(() => scheduleRows.value);
    templateSearch.value = "";
    collapsedTemplateGroups.value[group] = false;
    managerMode.value = "detail";
    managerTab.value = "info";
    pendingReportType.value = template.id;
    loadPendingSchedule();
    if (draft.source === "current") {
      await changeReportType(template.id);
      saveState.value = "saved";
      saveStatus.value = "현재 편집 내용을 새 양식으로 저장했습니다.";
      showManagerNotice(`'${label}' 양식을 만들고 편집기에 열었습니다.`);
    } else {
      showManagerNotice(`'${label}' 양식을 만들었습니다. [이 양식 열기]로 편집을 시작하세요.`);
    }
  } catch (error) {
    templateError.value = `양식을 저장하지 못했습니다: ${error.message}`;
  } finally {
    templateSaveBusy.value = false;
  }
}

async function loadTemplateCatalog() {
  customTemplates.value = await getTemplates();
}

function addPage() {
  pages.value[currentPageIndex.value].blocks = blocks.value;
  pages.value.push({
    id: `report-page-${Date.now()}-${++nextId}`,
    blocks: [],
  });
  currentPageIndex.value = pages.value.length - 1;
  blocks.value = pages.value[currentPageIndex.value].blocks;
  selectedId.value = "";
}

function selectPage(index) {
  if (index < 0 || index >= pages.value.length || index === currentPageIndex.value) {
    return;
  }
  pages.value[currentPageIndex.value].blocks = blocks.value;
  currentPageIndex.value = index;
  blocks.value = pages.value[index].blocks;
  selectedId.value = blocks.value[0]?.id ?? "";
}

// 뷰어로 갈 때 지금 편집 중인 양식을 뷰어에서 바로 고르도록 넘겨준다(같은 탭 한 번만 사용).
const VIEWER_OPEN_TEMPLATE_KEY = "cod-report.viewer.openTemplate";

// 상단 도구 이동 메뉴. 저장 중에는 옮기지 않는다(저장하지 않은 변경은 App 이 canLeave 로 확인).
function selectTool(tool) {
  if (saveState.value === "saving") return;
  try {
    sessionStorage.removeItem(VIEWER_OPEN_TEMPLATE_KEY);
  } catch {
    // 무시
  }
  if (tool === "viewer") {
    try {
      if (isCustomTemplateId(reportType.value)) sessionStorage.setItem(VIEWER_OPEN_TEMPLATE_KEY, reportType.value);
    } catch {
      // 저장소를 쓸 수 없으면 뷰어가 기본 양식을 고른다.
    }
  }
  emit("select-tool", tool);
}

// 에디터에 다시 들어오면 마지막으로 작업한 양식을 연다(사용자별, 이 브라우저에만 기억).
function lastTemplateKey() {
  return `cod-report.editor.lastTemplate.${props.authUser?.userCd ?? ""}`;
}

function readLastTemplateId() {
  try {
    const id = localStorage.getItem(lastTemplateKey()) ?? "";
    return customTemplates.value.some((template) => template.id === id) ? id : "";
  } catch {
    return "";
  }
}

watch(reportType, (id) => {
  if (!isCustomTemplateId(id)) return;
  try {
    localStorage.setItem(lastTemplateKey(), id);
  } catch {
    // 기억하지 못해도 편집에는 문제가 없다.
  }
});

function addBlock(type, afterId = selectedId.value) {
  const targetIndex = blocks.value.findIndex((item) => item.id === afterId);
  const selectedIndex = targetIndex >= 0
    ? targetIndex
    : blocks.value.findIndex((item) => item.id === selectedId.value);
  insertBlockAt(type, selectedIndex >= 0 ? selectedIndex + 1 : blocks.value.length);
}

function insertBlockAt(type, index, overrides = {}) {
  if (!INSERTABLE_TYPES.has(type)) {
    return null;
  }
  const block = { ...createDefaultBlock(type), ...overrides };
  const insertIndex = Math.max(0, Math.min(index, blocks.value.length));
  blocks.value.splice(insertIndex, 0, block);
  selectedId.value = block.id;
  return block;
}

// 선택한 요소 다음에 넣는다(선택이 없으면 맨 끝).
function insertAfterSelection(type, overrides = {}) {
  const selectedIndex = blocks.value.findIndex((item) => item.id === selectedId.value);
  return insertBlockAt(type, selectedIndex >= 0 ? selectedIndex + 1 : blocks.value.length, overrides);
}

// ---------- 일러스트레이션: 그림 ----------

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const IMAGE_MAX_SIDE = 1600;
const IMAGE_MAX_DATA_URL = 4 * 1024 * 1024;
const imageFileInput = ref(null);
const imageMessage = ref("");
let imageTargetBlockId = "";

function pickImage(targetBlockId = "") {
  imageTargetBlockId = targetBlockId;
  imageMessage.value = "";
  imageFileInput.value.value = "";
  imageFileInput.value.click();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("그림 파일을 열 수 없습니다. 손상되었거나 지원하지 않는 형식입니다."));
    image.src = src;
  });
}

// 큰 그림은 긴 변 1600px 로 줄여 양식 용량을 관리한다. (사진은 JPEG, 그 외는 PNG)
async function prepareImage(file) {
  if (!IMAGE_TYPES.includes(file.type)) {
    throw new Error("PNG, JPG, GIF, WEBP 그림만 넣을 수 있습니다.");
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("20MB 이하의 그림만 넣을 수 있습니다.");
  }
  const original = await readFileAsDataUrl(file);
  const image = await loadImage(original);
  let src = original;
  let width = image.naturalWidth;
  let height = image.naturalHeight;
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(width, height));
  if (scale < 1 || file.size > 1.5 * 1024 * 1024 || file.type === "image/webp") {
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const photo = file.type === "image/jpeg" || file.type === "image/webp";
    if (photo) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    src = canvas.toDataURL(photo ? "image/jpeg" : "image/png", 0.88);
  }
  if (src.length > IMAGE_MAX_DATA_URL) {
    throw new Error("그림이 너무 큽니다. 더 작은 그림을 사용해 주세요.");
  }
  return { src, naturalWidth: width, naturalHeight: height, fileName: file.name };
}

async function handleImageFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const prepared = await prepareImage(file);
    const target = blocks.value.find((item) => item.id === imageTargetBlockId && item.type === "image");
    if (target) {
      target.image = { ...target.image, ...prepared };
      selectedId.value = target.id;
    } else {
      const block = insertAfterSelection("image");
      block.image = { ...block.image, ...prepared, alt: file.name.replace(/\.[^.]+$/, "") };
    }
    imageMessage.value = "";
  } catch (error) {
    imageMessage.value = error.message;
    if (!imageTargetBlockId) window.alert(error.message);
  }
}

// ---------- 일러스트레이션: 도형 ----------

const shapeMenu = ref(null); // { top, left }
const shapeMenuButton = ref(null);
const shapeMenuPanel = ref(null);

function toggleShapeMenu() {
  if (shapeMenu.value) {
    shapeMenu.value = null;
    return;
  }
  const rect = shapeMenuButton.value.getBoundingClientRect();
  shapeMenu.value = {
    top: rect.bottom + 6,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 380)),
  };
  nextTick(() => shapeMenuPanel.value?.querySelector("button")?.focus());
}

function insertShape(kind) {
  shapeMenu.value = null;
  insertAfterSelection("shape", { shape: createShapeConfig(kind) });
}

function handleShapeMenuOutside(event) {
  if (
    shapeMenu.value &&
    !shapeMenuPanel.value?.contains(event.target) &&
    !shapeMenuButton.value?.contains(event.target)
  ) {
    shapeMenu.value = null;
  }
}

function shapePreviewMarkup(kind) {
  const config = createShapeConfig(kind);
  return shapeSvgMarkup(
    { ...config, fill: getShape(kind).line ? "none" : "#dbe4f7", stroke: "#4058a8", strokeWidth: 1.5 },
    { width: 28, height: getShape(kind).line ? 28 : 22 },
  );
}

function changeShapeKind(block, kind) {
  const wasLine = getShape(block.shape?.kind).line;
  const next = createShapeConfig(kind);
  // 선 ↔ 면 도형을 바꿀 때만 기본 색·크기를 다시 쓴다.
  block.shape = Boolean(wasLine) === Boolean(getShape(kind).line)
    ? { ...block.shape, kind }
    : next;
}

// ---------- 일러스트레이션: 차트 ----------

const chartDialog = ref(null); // { mode: "insert" | "change", blockId }
const chartDataBlockId = ref("");
const chartDataBlock = computed(() => blocks.value.find((item) => item.id === chartDataBlockId.value) ?? null);

function openChartInsert() {
  chartDialog.value = { mode: "insert" };
}

function openChartTypeChange(block) {
  chartDialog.value = { mode: "change", blockId: block.id, current: { category: block.chart?.category, variant: block.chart?.variant } };
}

function handleChartDialogConfirm({ category, variant }) {
  const dialog = chartDialog.value;
  chartDialog.value = null;
  if (dialog?.mode === "change") {
    const block = blocks.value.find((item) => item.id === dialog.blockId);
    if (!block) return;
    // 아직 기본 예제 데이터 그대로라면 새 종류에 맞는 예제로 바꾼다.
    const untouchedSample = JSON.stringify(block.chartData) === JSON.stringify(defaultChartData(block.chart?.category));
    block.chart = { ...block.chart, category, variant };
    if (untouchedSample && !block.dataBinding?.enabled) block.chartData = defaultChartData(category);
    selectedId.value = block.id;
    return;
  }
  insertAfterSelection("chart", { chart: createChartConfig(category, variant), chartData: defaultChartData(category) });
}

function openChartData(block) {
  chartDataBlockId.value = block.id;
}

function applyChartData(payload) {
  const block = chartDataBlock.value;
  chartDataBlockId.value = "";
  if (!block) return;
  block.chartData = payload.chartData;
  if (payload.dataBinding) block.dataBinding = payload.dataBinding;
}

async function runChartQuery(query, parametersText, datasourceId) {
  let parameters;
  try {
    parameters = JSON.parse(parametersText || "[]");
  } catch {
    throw new Error("쿼리 파라미터를 JSON 배열 형식으로 입력해 주세요. 예: [\"2026-11-01\"]");
  }
  if (!Array.isArray(parameters)) throw new Error("쿼리 파라미터는 JSON 배열이어야 합니다.");
  const reportPeriod = getReportPeriod(date.value, activeLayoutType.value);
  return executeDataQuery(query, resolveScheduleParameters(parameters, reportPeriod), datasourceId);
}

function chartDataSummary(block) {
  const data = resolveChartData(block);
  const size = `항목 ${data.categories.length}개 · 계열 ${data.series.length}개`;
  return block.dataBinding?.enabled
    ? `DB 쿼리 · ${datasourceLabel(block.dataBinding.datasourceId)} · ${size}`
    : `직접 입력 · ${size}`;
}

const CHART_AXIS_CATEGORIES = new Set(["column", "bar", "line", "area", "scatter", "stock", "heatmap", "histogram", "boxplot", "waterfall", "combo"]);

function createDefaultBlock(type) {
  const defaults = {
    title: { content: "새 보고서 제목" },
    text: { content: "텍스트를 입력하세요." },
    section: { heading: "새 항목", content: "내용을 입력하세요." },
    subheading: { content: "새 구분 제목", fontSize: 12 },
    period: { start: `${date.value}T00:00`, end: `${date.value}T23:59` },
    date: {},
    special: { heading: "〈특이사항〉", content: "내용을 입력하세요." },
    table: {
      heading: "새 표",
      gridVersion: 1,
      columns: ["", "", ""],
      rows: [
        { cells: ["", "", ""] },
        { cells: ["", "", ""] },
      ],
      columnStyles: [{}, {}, {}],
      merges: [],
    },
    divider: {},
    image: {
      align: "center",
      image: { src: "", alt: "", widthPercent: 60, border: false, naturalWidth: 0, naturalHeight: 0 },
    },
    shape: { align: "center", shape: createShapeConfig("rect") },
    chart: { align: "center", chart: createChartConfig("column"), chartData: defaultChartData("column") },
  };
  return createBlock(type, defaults[type] ?? {});
}

function startBlockDrag(type, event) {
  event.dataTransfer?.setData("application/x-cod-report-block", type);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "copy";
  }
  isDraggingBlock.value = true;
}

function finishBlockDrag() {
  isDraggingBlock.value = false;
}

// 보고서 용지 바깥(회색 영역)에 놓으면 용지 위/아래 중 가까운 쪽 끝에 추가한다.
function dropBlock(event) {
  event.preventDefault();
  const type = event.dataTransfer?.getData("application/x-cod-report-block");
  finishBlockDrag();
  if (!type) {
    return;
  }
  const paper = event.currentTarget.querySelector(".report");
  const paperTop = paper?.getBoundingClientRect().top ?? 0;
  insertBlockAt(type, event.clientY < paperTop ? 0 : blocks.value.length);
}

// beforeId: 이 요소 앞에 넣는다(null 이면 맨 끝)
function insertBlockByDrop({ type, beforeId }) {
  finishBlockDrag();
  const index = beforeId ? blocks.value.findIndex((block) => block.id === beforeId) : -1;
  insertBlockAt(type, index >= 0 ? index : blocks.value.length);
}

function selectBlock(id) {
  const selectionChanged = selectedId.value !== id;
  selectedId.value = id;
  const block = blocks.value.find((item) => item.id === id);
  if (block?.type === "table" && selectionChanged) {
    selectedTableRow.value = 0;
    selectedTableColumn.value = 0;
    selectedCells.value = block.rows.length && block.columns.length
      ? [{ row: 0, column: 0 }]
      : [];
    cellSelectionAnchor.value = selectedCells.value[0] ?? null;
    ensureTableColumns(block);
  }
}

function getBindingFields(block) {
  if (block.type === "table") {
    const fields = [
      { key: "heading", label: "표 제목" },
      { key: "unit", label: "단위" },
    ];
    // 요약은 별도 요약 쿼리로 연결한다. 예전 양식에 표 쿼리로 연결된 요약이 있으면 해제할 수 있게 남겨 둔다.
    if (block.dataBinding?.mappings?.fields?.summary) {
      fields.push({ key: "summary", label: "요약 (예전 방식)" });
    }
    return fields;
  }
  if (block.type === "period") {
    return [
      { key: "start", label: "시작 시각" },
      { key: "end", label: "종료 시각" },
    ];
  }
  if (block.type === "date") {
    return [{ key: "date", label: "작성일" }];
  }
  if (block.type === "section" || block.type === "special") {
    return [
      { key: "heading", label: "제목" },
      { key: "content", label: "내용" },
    ];
  }
  if (block.type === "title" || block.type === "text" || block.type === "subheading") {
    return [{ key: "content", label: "내용" }];
  }
  return [];
}

function ensureDataBinding(block) {
  block.dataBinding ??= {
    enabled: false,
    query: "",
    parametersText: "[]",
    parameters: [],
    repeatRows: true,
    mappings: { fields: {}, columns: [] },
    columns: [],
    rows: [],
  };
  block.dataBinding.repeatTable ??= false;
  block.dataBinding.mappings ??= { fields: {}, columns: [] };
  block.dataBinding.mappings.fields ??= {};
  block.dataBinding.mappings.columns ??= [];

  if (block.type === "table") {
    while (block.dataBinding.mappings.columns.length < block.columns.length) {
      block.dataBinding.mappings.columns.push("");
    }
    block.dataBinding.mappings.columns.length = block.columns.length;
  }
  return block.dataBinding;
}

// ---------- 표 셀 필드: 필드 목록에서 셀로 끌어다 놓기 ----------

const FIELD_DRAG_TYPE = "application/x-cod-report-field";

function startFieldDrag(fieldName, event) {
  event.dataTransfer.setData(FIELD_DRAG_TYPE, fieldName);
  event.dataTransfer.setData("text/plain", `{${fieldName}}`);
  event.dataTransfer.effectAllowed = "copy";
}

function usesLegacyColumnMapping(table) {
  return !hasCellFields(table) && Boolean(table.dataBinding?.mappings?.columns?.some(Boolean));
}

// 예전 '열마다 필드 연결'을 셀 필드로 옮긴다: 첫 데이터 행의 셀에 필드를 넣고, 행 반복이었으면 그 행을 반복 행으로.
function convertLegacyColumnMapping(table) {
  if (!usesLegacyColumnMapping(table)) return;
  ensureTableColumns(table);
  const binding = table.dataBinding;
  let rowIndex = table.rows.findIndex((row) => !row.isTitleRow);
  if (rowIndex < 0) {
    table.rows.push({ cells: table.columns.map(() => ""), cellStyles: table.columns.map(() => ({ backgroundColor: "" })) });
    rowIndex = table.rows.length - 1;
  }
  const row = table.rows[rowIndex];
  row.fields = table.columns.map((_, column) => binding.mappings.columns[column] || "");
  if (binding.repeatRows && !binding.repeatTable) {
    table.rows.forEach((item, index) => { item.repeat = index === rowIndex; });
  }
  binding.mappings.columns = table.columns.map(() => "");
}

function setCellField({ blockId, row: rowIndex, column, field }) {
  const table = blocks.value.find((block) => block.id === blockId);
  if (table?.type !== "table" || !table.rows?.[rowIndex]) return;
  ensureDataBinding(table);
  convertLegacyColumnMapping(table);
  ensureTableColumns(table);
  const row = table.rows[rowIndex];
  row.fields ??= table.columns.map(() => "");
  row.fields[column] = field;
  if (!row.fields.some(Boolean)) {
    delete row.fields;
    row.repeat = false;
  }
  selectBlock(blockId);
}

// '행 반복'은 표에서 한 행만 켤 수 있다.
function setRowRepeat({ blockId, row: rowIndex, repeat }) {
  const table = blocks.value.find((block) => block.id === blockId);
  if (table?.type !== "table") return;
  table.rows.forEach((row, index) => { row.repeat = repeat && index === rowIndex; });
}

// 표 반복(표 하나 = 조회 결과 한 행)을 켜면 행 반복은 끈다.
function setRepeatTable(table, enabled) {
  const binding = ensureDataBinding(table);
  binding.repeatTable = enabled;
  if (enabled) table.rows.forEach((row) => { row.repeat = false; });
}

function cellFieldCount(table) {
  return (table.rows ?? []).reduce((sum, row) => sum + (row.fields?.filter(Boolean).length ?? 0), 0);
}

function toggleDataBinding(block, enabled) {
  const binding = ensureDataBinding(block);
  binding.enabled = enabled;
  bindingMessage.value = "";
}

// 표 아래 요약은 표와 다른 쿼리·데이터소스로 조회한다.
function ensureSummaryBinding(block) {
  block.summaryBinding ??= {
    enabled: false,
    datasourceId: "",
    query: "",
    parametersText: "[]",
    parameters: [],
    template: block.summary ?? "",
    columns: [],
    rows: [],
  };
  return block.summaryBinding;
}

function toggleSummaryBinding(block, enabled) {
  const binding = ensureSummaryBinding(block);
  binding.enabled = enabled;
  if (enabled && !binding.template) binding.template = block.summary ?? "";
  summaryBindingMessage.value = "";
}

function insertSummaryField(block, column) {
  const binding = ensureSummaryBinding(block);
  const token = `{${column}}`;
  const input = summaryTemplateInput.value;
  const text = binding.template ?? "";
  if (input && document.activeElement === input) {
    const start = input.selectionStart ?? text.length;
    const end = input.selectionEnd ?? text.length;
    binding.template = text.slice(0, start) + token + text.slice(end);
    nextTick(() => {
      input.focus();
      input.setSelectionRange(start + token.length, start + token.length);
    });
  } else {
    binding.template = text + token;
  }
}

function summaryPreview(block) {
  const binding = block.summaryBinding;
  if (!binding?.rows?.length) return "";
  return fillSummaryTemplate(binding.template ?? "", binding.rows[0]);
}

function datasourceLabel(id) {
  if (!id) return "리포트 DB (기본)";
  const datasource = datasources.value.find((item) => item.id === id);
  if (!datasource) return "삭제되었거나 찾을 수 없는 데이터소스";
  return `${datasource.name} · ${getDatasourceType(datasource.type)?.label ?? datasource.type}`;
}

function datasourceMissing(id) {
  return Boolean(id) && !datasources.value.some((item) => item.id === id);
}

async function refreshDatasources() {
  try {
    datasources.value = await getDatasources();
  } catch {
    // 접속정보 목록을 못 불러와도 기본 리포트 DB 바인딩은 계속 쓸 수 있다.
  }
}

async function runDataBindingQuery(block, kind = "data") {
  const isSummary = kind === "summary";
  const binding = isSummary ? ensureSummaryBinding(block) : ensureDataBinding(block);
  const busy = isSummary ? summaryBindingBusy : bindingBusy;
  const message = isSummary ? summaryBindingMessage : bindingMessage;
  let parameters;
  try {
    parameters = JSON.parse(binding.parametersText || "[]");
  } catch {
    message.value = "쿼리 파라미터를 JSON 배열 형식으로 입력해 주세요. 예: [\"2026-11-01\"]";
    return;
  }
  if (!Array.isArray(parameters)) {
    message.value = "쿼리 파라미터는 JSON 배열이어야 합니다.";
    return;
  }
  if (!binding.query.trim()) {
    message.value = "먼저 SELECT 쿼리를 입력해 주세요.";
    return;
  }

  busy.value = true;
  message.value = `${datasourceLabel(binding.datasourceId)}에서 쿼리를 실행하고 있습니다.`;
  try {
    const reportPeriod = getReportPeriod(date.value, activeLayoutType.value);
    const result = await executeDataQuery(
      binding.query,
      resolveScheduleParameters(parameters, reportPeriod),
      binding.datasourceId || "",
    );
    binding.columns = result.columns;
    binding.rows = result.rows;
    binding.parameters = parameters;
    binding.enabled = true;
    binding.lastRefreshedAt = new Date().toISOString();
    message.value = result.truncated
      ? "최대 5,000행까지만 가져왔습니다."
      : `${result.rows.length}행, ${result.columns.length}개 필드를 불러왔습니다.`;
  } catch (error) {
    message.value = `데이터를 불러오지 못했습니다: ${error.message}`;
  } finally {
    busy.value = false;
  }
}

async function loadDatabaseStatus() {
  try {
    const status = await getDatabaseStatus();
    databaseConfigured.value = status.configured;
    if (!status.configured) {
      bindingMessage.value = "서버의 .env 파일에 MySQL 접속 설정이 필요합니다.";
    }
  } catch (error) {
    bindingMessage.value = `DB 상태를 확인하지 못했습니다: ${error.message}`;
  }
}

function addTableRow(table) {
  ensureTableColumns(table);
  const row = {
    cells: table.columns.map(() => ""),
    cellStyles: table.columns.map(() => ({ backgroundColor: "" })),
  };
  table.rows.push(row);
  selectedTableRow.value = table.rows.length - 1;
  selectedCells.value = table.columns.length
    ? [{ row: selectedTableRow.value, column: 0 }]
    : [];
  cellSelectionAnchor.value = selectedCells.value[0] ?? null;
}

function setTableTitleRow(table, rowIndex, isTitleRow) {
  ensureTableColumns(table);
  table.rows.forEach((row, index) => {
    row.isTitleRow = isTitleRow ? index <= rowIndex : index < rowIndex;
  });
}

function removeTableRow(table) {
  if (selectedTableRow.value < 0 || selectedTableRow.value >= table.rows.length) {
    return;
  }
  if (!window.confirm(`${selectedTableRow.value + 1}번째 행을 삭제하시겠습니까?`)) {
    return;
  }

  const deletedRowIndex = selectedTableRow.value;
  table.merges = (table.merges ?? [])
    .filter(
      (merge) =>
        deletedRowIndex < merge.row ||
        deletedRowIndex >= merge.row + merge.rowspan,
    )
    .map((merge) => ({
      ...merge,
      row: merge.row > deletedRowIndex ? merge.row - 1 : merge.row,
    }));
  table.rows.splice(deletedRowIndex, 1);
  selectedCells.value = selectedCells.value
    .filter((cell) => cell.row !== deletedRowIndex)
    .map((cell) => ({
      ...cell,
      row: cell.row > deletedRowIndex ? cell.row - 1 : cell.row,
    }));
  if (cellSelectionAnchor.value) {
    if (cellSelectionAnchor.value.row === deletedRowIndex) {
      cellSelectionAnchor.value = selectedCells.value[0] ?? null;
    } else if (cellSelectionAnchor.value.row > deletedRowIndex) {
      cellSelectionAnchor.value = {
        ...cellSelectionAnchor.value,
        row: cellSelectionAnchor.value.row - 1,
      };
    }
  }
  selectedTableRow.value = Math.min(
    selectedTableRow.value,
    Math.max(0, table.rows.length - 1),
  );
}

function addTableColumn(table) {
  ensureTableColumns(table);
  const columnIndex = table.columns.length;
  const widths = getColumnWidths(table);
  table.columns.push("");
  table.columnStyles.push({ backgroundColor: "" });
  if (widths) {
    // 새 열은 지금 열들의 평균 너비로 넣고 전체를 100%로 맞춘다.
    table.columnWidths = normalizeColumnWidths([...widths, 100 / widths.length]);
  }
  table.rows.forEach((row) => {
    row.cells.push("");
    row.cellStyles ??= [];
    row.cellStyles.push({ backgroundColor: "" });
    row.fields?.push("");
  });
  if (table.dataBinding) {
    table.dataBinding.mappings.columns.push("");
  }

  selectedTableColumn.value = columnIndex;
}

function removeTableColumn(table) {
  if (selectedTableColumn.value < 0 || selectedTableColumn.value >= table.columns.length) {
    return;
  }
  if (!window.confirm(`${selectedTableColumn.value + 1}번째 열을 삭제하시겠습니까?`)) {
    return;
  }

  const columnIndex = selectedTableColumn.value;
  table.merges = (table.merges ?? [])
    .filter(
      (merge) =>
        columnIndex < merge.column ||
        columnIndex >= merge.column + merge.colspan,
    )
    .map((merge) => ({
      ...merge,
      column: merge.column > columnIndex ? merge.column - 1 : merge.column,
    }));
  const widths = getColumnWidths(table);
  table.columns.splice(columnIndex, 1);
  table.columnStyles?.splice(columnIndex, 1);
  if (widths && table.columns.length) {
    widths.splice(columnIndex, 1);
    table.columnWidths = normalizeColumnWidths(widths);
  } else {
    delete table.columnWidths;
  }
  table.dataBinding?.mappings?.columns?.splice(columnIndex, 1);
  table.rows.forEach((row) => {
    row.cells.splice(columnIndex, 1);
    row.cellStyles?.splice(columnIndex, 1);
    row.fields?.splice(columnIndex, 1);
  });
  selectedCells.value = selectedCells.value
    .filter((cell) => cell.column !== columnIndex)
    .map((cell) => ({
      ...cell,
      column: cell.column > columnIndex ? cell.column - 1 : cell.column,
    }));
  if (cellSelectionAnchor.value) {
    if (cellSelectionAnchor.value.column === columnIndex) {
      cellSelectionAnchor.value = selectedCells.value[0] ?? null;
    } else if (cellSelectionAnchor.value.column > columnIndex) {
      cellSelectionAnchor.value = {
        ...cellSelectionAnchor.value,
        column: cellSelectionAnchor.value.column - 1,
      };
    }
  }
  selectedTableColumn.value = Math.min(
    columnIndex,
    Math.max(0, table.columns.length - 1),
  );
}

function mergeSelectedCells() {
  const table = selectedBlock.value;
  const bounds = table?.type === "table"
    ? getCellSelectionBounds(selectedCells.value)
    : null;
  if (!bounds || !isMergeSelectionAvailable(table, selectedCells.value)) {
    return;
  }

  table.merges ??= [];
  table.merges.push({
    row: bounds.top,
    column: bounds.left,
    rowspan: bounds.height,
    colspan: bounds.width,
  });
}

function unmergeSelectedCells() {
  const table = selectedBlock.value;
  if (table?.type !== "table") {
    return;
  }

  const selectedAnchors = new Set(
    selectedCells.value.map((cell) => `${cell.row}:${cell.column}`),
  );
  table.merges = (table.merges ?? []).filter(
    (merge) => !selectedAnchors.has(`${merge.row}:${merge.column}`),
  );
}

function setTableColumnShade(table, color) {
  ensureTableColumns(table);
  const style = table.columnStyles[selectedTableColumn.value];
  if (style) {
    style.backgroundColor = color;
  }
}

function moveSelectedBlock(direction) {
  const index = blocks.value.findIndex((block) => block.id === selectedId.value);
  const nextIndex = index + direction;

  if (index < 0 || nextIndex < 0 || nextIndex >= blocks.value.length) {
    return;
  }

  const [block] = blocks.value.splice(index, 1);
  blocks.value.splice(nextIndex, 0, block);
}

function deleteSelectedBlock() {
  if (!selectedBlock.value) {
    return;
  }

  const label = blockLabel(selectedBlock.value);
  if (!window.confirm(`"${label}" 요소를 삭제하시겠습니까?`)) {
    return;
  }

  const index = blocks.value.findIndex((block) => block.id === selectedId.value);
  blocks.value.splice(index, 1);
  selectedId.value = blocks.value[Math.min(index, blocks.value.length - 1)]?.id ?? "";
}

function handleEditorKeydown(event) {
  if (isTransferOpen.value) return;
  if (event.key === "Escape") {
    if (shapeMenu.value) {
      shapeMenu.value = null;
      shapeMenuButton.value?.focus();
      return;
    }
    if (ribbonMenu.value) {
      ribbonMenu.value = null;
      return;
    }
    if (isTemplateManagerOpen.value) {
      handleManagerEscape();
    }
    isPreviewOpen.value = false;
    return;
  }
  if (
    isTemplateManagerOpen.value ||
    isPreviewOpen.value ||
    isReportSettingsOpen.value ||
    chartDialog.value ||
    chartDataBlockId.value ||
    headerFooterDialog.value
  ) {
    return;
  }
  if (handleFontShortcut(event)) {
    event.preventDefault();
    return;
  }
  if (event.key !== "Delete" || !selectedBlock.value) {
    return;
  }

  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select, [contenteditable='true']"))
  ) {
    return;
  }

  event.preventDefault();
  deleteSelectedBlock();
}

// beforeId 요소 앞으로 옮긴다(null 이면 맨 끝). 자유 배치 요소가 섞여 있어도 순서가 맞는다.
function moveBlockByDrop({ id, beforeId }) {
  const sourceIndex = blocks.value.findIndex((block) => block.id === id);
  if (sourceIndex < 0 || id === beforeId) {
    return;
  }
  const [block] = blocks.value.splice(sourceIndex, 1);
  const targetIndex = beforeId ? blocks.value.findIndex((item) => item.id === beforeId) : -1;
  blocks.value.splice(targetIndex >= 0 ? targetIndex : blocks.value.length, 0, block);
  selectedId.value = block.id;
}

// ---------- 배치: 분할(가로 나열) · 자유 배치 · 크기 ----------

// 캔버스에서 바로 고친 글자(제목·텍스트·업무 항목·특이사항 등)를 요소에 반영한다.
function handleCanvasFieldInput({ blockId, field, value, index }) {
  const block = blocks.value.find((item) => item.id === blockId);
  if (!block) return;
  if (field === "definitions") {
    if (Array.isArray(block.definitions) && index >= 0 && index < block.definitions.length) {
      block.definitions[index] = value;
    }
    return;
  }
  if (["content", "heading", "unit", "summary"].includes(field)) {
    block[field] = value;
  }
}

function applyLayoutUpdate({ blockId, layout, chartHeight, shapeSize }) {
  const block = blocks.value.find((item) => item.id === blockId);
  if (!block) return;
  if (layout) block.layout = { ...(block.layout ?? {}), ...layout };
  if (chartHeight && block.chart) block.chart.height = chartHeight;
  if (shapeSize && block.shape) {
    block.shape.width = shapeSize.width;
    block.shape.height = shapeSize.height;
  }
}

// 표 경계를 끌어 바꾼 열 너비(%) · 행 높이(px). null 이면 기본값으로 돌린다.
function applyTableResize({ blockId, columnWidths, row, height }) {
  const block = blocks.value.find((item) => item.id === blockId);
  if (block?.type !== "table") return;
  if (columnWidths !== undefined) {
    if (columnWidths) block.columnWidths = columnWidths;
    else delete block.columnWidths;
  }
  if (row !== undefined) {
    const target = block.rows?.[row];
    if (!target) return;
    if (height) target.height = height;
    else delete target.height;
  }
}

// ---------- 속성 패널 탭: 일반 / 데이터 바인딩 ----------
// 구분선·그림·도형은 DB 데이터를 쓰지 않으므로 데이터 바인딩 탭이 없다.
// 다른 요소를 골라도 마지막으로 연 탭을 유지한다(지원하지 않는 요소에서는 일반 탭을 보여 준다).
const propertyTab = ref("general");

function supportsDataBinding(block) {
  return Boolean(block) && !["divider", "image", "shape"].includes(block.type);
}

function hasActiveBinding(block) {
  return Boolean(block?.dataBinding?.enabled || block?.summaryBinding?.enabled);
}

const activePropertyTab = computed(() => {
  if (propertyTab.value === "data" && supportsDataBinding(selectedBlock.value)) return "data";
  if (propertyTab.value === "table" && selectedBlock.value?.type === "table") return "table";
  return "general";
});

// 화면에 보이는 요소 높이(px, 용지 기준). 높이를 '지정'으로 바꿀 때 시작값으로 쓴다.
function currentBlockHeight(block) {
  const element = document.querySelector(`.canvas-scroll [data-report-block-id="${block.id}"]`);
  if (!element) return null;
  const style = getComputedStyle(element);
  const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
    + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  return clampHeight(element.getBoundingClientRect().height / (zoom.value / 100) - padding);
}

// 용지 안의 빈 곳(요소·머리글·바닥글 밖)을 누르면 선택을 해제한다.
// 요소를 끌다가 빈 곳에서 놓은 경우는 해제하지 않도록 누른 곳과 뗀 곳이 모두 빈 곳일 때만 해제한다.
const CANVAS_INTERACTIVE_SELECTOR = ".report-element, .report-hf, .report-drag-ghost, button, input, select, textarea, a, [contenteditable]";
let canvasEmptyPress = false;

function handleCanvasPointerDown(event) {
  canvasEmptyPress = event.button === 0 && !event.target.closest(CANVAS_INTERACTIVE_SELECTOR);
}

function handleCanvasClick(event) {
  const empty = canvasEmptyPress && !event.target.closest(CANVAS_INTERACTIVE_SELECTOR);
  canvasEmptyPress = false;
  if (!empty || !selectedId.value) return;
  selectedId.value = "";
  selectedCells.value = [];
  cellSelectionAnchor.value = null;
  // 편집 중이던 글자 입력의 커서도 함께 해제한다.
  if (document.activeElement?.closest?.(".canvas-scroll")) document.activeElement.blur();
}

function splitSelected(presetId) {
  ribbonMenu.value = null;
  const index = blocks.value.findIndex((block) => block.id === selectedId.value);
  applySplit(blocks.value, index, presetId);
}

// 영역 배치 ↔ 자유 배치. 자유 배치로 바꿀 때는 지금 보이는 자리에 그대로 둔다.
function setLayoutMode(block, value) {
  const [mode, wrap = "front"] = value.split(":");
  if (mode === "free") {
    let { x, y, w } = getLayout(block);
    if (!isFree(block)) {
      const element = document.querySelector(`.canvas-scroll [data-report-block-id="${block.id}"]`);
      const article = element?.closest(".report");
      if (element && article) {
        const scale = zoom.value / 100;
        const rect = element.getBoundingClientRect();
        const paper = article.getBoundingClientRect();
        x = Math.round((rect.left - paper.left) / scale);
        y = Math.round((rect.top - paper.top) / scale);
        w = Math.round(rect.width / scale);
      }
    }
    const topZ = Math.max(0, ...blocks.value.filter(isFree).map((item) => getLayout(item).z));
    block.layout = { ...(block.layout ?? {}), mode: "free", x, y, w, wrap, z: isFree(block) ? getLayout(block).z : topZ + 1 };
  } else {
    block.layout = { ...(block.layout ?? {}), mode: "flow" };
  }
}

function changeZOrder(block, direction) {
  const free = blocks.value.filter(isFree);
  const zs = free.map((item) => getLayout(item).z);
  const z = direction > 0 ? Math.max(0, ...zs) + 1 : Math.min(0, ...zs) - 1;
  block.layout = { ...(block.layout ?? {}), z };
}

function layoutModeValue(block) {
  const layout = getLayout(block);
  return layout.mode === "free" ? `free:${layout.wrap}` : "flow";
}

// ---------- 리본 펼침 메뉴(분할 · 머리글 · 바닥글 · 페이지 번호) ----------

const ribbonMenu = ref(null); // { name, top, left }
const ribbonMenuPanel = ref(null);

function toggleRibbonMenu(name, event) {
  if (ribbonMenu.value?.name === name) {
    ribbonMenu.value = null;
    return;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  ribbonMenu.value = { name, top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)) };
  nextTick(() => ribbonMenuPanel.value?.querySelector("button:not(:disabled)")?.focus());
}

function handleRibbonMenuOutside(event) {
  if (ribbonMenu.value && !ribbonMenuPanel.value?.contains(event.target) && !event.target.closest?.("[data-ribbon-menu]")) {
    ribbonMenu.value = null;
  }
}

// ---------- 머리글 · 바닥글 · 페이지 번호 ----------

const headerFooterDialog = ref(null); // { tab }

function openHeaderFooterDialog(tab = "header") {
  ribbonMenu.value = null;
  headerFooterDialog.value = { tab };
}

function applyHeaderFooter(config) {
  headerFooterDialog.value = null;
  headerFooter.value = config;
}

function useHeaderFooterGallery(kind, galleryId) {
  ribbonMenu.value = null;
  headerFooter.value = applyGallery(headerFooter.value, kind, galleryId);
}

function removeHeaderFooterArea(kind) {
  ribbonMenu.value = null;
  headerFooter.value = clearArea(headerFooter.value, kind);
}

function addPageNumber(position, align) {
  ribbonMenu.value = null;
  headerFooter.value = insertPageNumber(headerFooter.value, position, align);
}

function deletePageNumbers() {
  ribbonMenu.value = null;
  headerFooter.value = removePageNumbers(headerFooter.value);
}

function beginCanvasCellSelection({ blockId, row, column, event }) {
  selectBlock(blockId);
  beginCellSelection(row, column, {
    button: event.button,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    preventDefault: () => {},
  });
}

// 키보드(Enter)로 셀을 옮겼을 때: 그 셀 하나만 선택한다.
function selectCanvasCell({ blockId, row, column }) {
  selectBlock(blockId);
  const cell = { row, column };
  selectedTableRow.value = row;
  selectedTableColumn.value = column;
  selectedCells.value = [cell];
  cellSelectionAnchor.value = cell;
  isCellDragging.value = false;
}

function extendCanvasCellSelection({ row, column }) {
  extendCellSelection(row, column);
}

function handleCanvasCellInput({ blockId, row, column, value }) {
  const table = blocks.value.find((block) => block.id === blockId);
  if (table?.type === "table") {
    ensureTableColumns(table);
    if (!table.rows[row]) {
      table.rows[row] = {
        cells: table.columns.map(() => ""),
        cellStyles: table.columns.map(() => ({ backgroundColor: "" })),
      };
    }
    table.rows[row].cells[column] = value;
  }
}

function applyShadeToSelectedCells(color) {
  setSelectedCellShade(color);
}

function blockLabel(block) {
  if (block.type === "title") {
    return block.content || "제목";
  }
  if (block.type === "date") {
    return "작성일";
  }
  if (block.type === "period") {
    return "관제 기간";
  }
  if (block.type === "subheading") {
    return block.content || "구분 제목";
  }
  if (block.type === "section") {
    return block.heading || "업무 항목";
  }
  if (block.type === "table") {
    return block.heading || "표";
  }
  if (block.type === "special") {
    return block.heading || "특이사항";
  }
  if (block.type === "divider") {
    return "구분선";
  }
  if (block.type === "image") {
    return block.content || block.image?.alt || "그림";
  }
  if (block.type === "shape") {
    return block.content || getShape(block.shape?.kind).label;
  }
  if (block.type === "chart") {
    return block.chart?.title || chartTypeLabel(block.chart);
  }
  return block.content || "텍스트";
}

function printReport() {
  printWithPageSetup(pageSetup.value);
}

// ---------- 차트 스타일 (Word 차트 디자인 › 차트 스타일·색 변경) ----------

// 글자를 캔버스에서 바로 고치는 요소(속성 패널에 입력란을 두지 않는다)
const INLINE_TEXT_TYPES = ["title", "subheading", "special", "section", "text"];

const CHART_BAR_CATEGORIES = new Set(["column", "bar", "combo", "histogram", "waterfall"]);
const CHART_LINE_CATEGORIES = new Set(["line", "area", "combo", "radar"]);
const CHART_ITEM_COLOR_CATEGORIES = new Set(["pie", "funnel", "treemap", "sunburst"]);
const CHART_FIXED_COLOR_CATEGORIES = new Set(["stock", "heatmap"]);

function chartStyleValue(block, key, fallback = "") {
  return block?.chart?.style?.[key] ?? fallback;
}

function setChartStyle(block, key, value) {
  if (!block?.chart) return;
  const { preset, ...rest } = block.chart.style ?? {};
  // 하나라도 직접 바꾸면 스타일 갤러리 선택 표시는 지운다.
  block.chart.style = { ...rest, [key]: value };
}

function applyChartStylePreset(block, presetId) {
  if (!block?.chart) return;
  block.chart.style = {
    ...chartStylePreset(presetId).style,
    preset: presetId,
    seriesColors: block.chart.style?.seriesColors ?? [],
  };
}

function activeChartPreset(block) {
  return block?.chart?.style?.preset ?? (block?.chart?.style ? "" : "default");
}

// 색을 고를 대상: 원형·깔때기 등은 항목별, 폭포는 증가·감소·합계, 나머지는 계열별
function chartColorTargets(block) {
  if (!block?.chart || CHART_FIXED_COLOR_CATEGORIES.has(block.chart.category)) return [];
  if (block.chart.category === "waterfall") return ["증가", "감소", "합계"];
  const data = resolveChartData(block);
  if (CHART_ITEM_COLOR_CATEGORIES.has(block.chart.category)) {
    const names = block.chart.category === "treemap" || block.chart.category === "sunburst"
      ? [...new Set(data.categories.map((path) => String(path).split("/")[0].trim()))]
      : data.categories;
    return names.slice(0, 12);
  }
  return data.series.map((item) => item.name).slice(0, 12);
}

function chartTargetColor(block, index) {
  return resolveChartColors(block.chart)[index];
}

function isChartColorCustom(block, index) {
  return Boolean(block?.chart?.style?.seriesColors?.[index]);
}

function setChartSeriesColor(block, index, color) {
  const colors = [...(block.chart.style?.seriesColors ?? [])];
  while (colors.length < index) colors.push("");
  colors[index] = color;
  setChartStyle(block, "seriesColors", colors);
}

function resetChartSeriesColor(block, index) {
  const colors = [...(block.chart.style?.seriesColors ?? [])];
  colors[index] = "";
  setChartStyle(block, "seriesColors", colors);
}

function resetChartStyle(block) {
  if (!block?.chart) return;
  delete block.chart.style;
  block.chart.palette = "office";
}

// 스타일 갤러리 미리보기: 팔레트 색 막대 3개에 프리셋의 배경·모서리·눈금선을 입힌다.
function chartPresetPreview(block, preset) {
  const colors = resolveChartColors(block.chart);
  const style = preset.style;
  return {
    background: style.backgroundColor || "#ffffff",
    border: style.borderColor || "#e1e5ec",
    grid: style.gridLines === false ? "" : style.gridColor || "#e6e8ec",
    radius: Math.min(4, (style.barRadius || 0) / 2),
    bars: [colors[0], colors[1], colors[2]],
  };
}

// ---------- 용지 크기·방향 (Word 레이아웃 › 크기 / 방향) ----------

function setPageSetup(next) {
  const normalized = normalizePageSetup(next);
  // A4 세로는 저장하지 않고 기본값(null)으로 둔다.
  pageSetup.value = isDefaultPageSetup(normalized) ? null : normalized;
  ribbonMenu.value = null;
}

function choosePaperSize(sizeId) {
  setPageSetup({ ...normalizePageSetup(pageSetup.value), size: sizeId });
}

function chooseOrientation(orientation) {
  setPageSetup({ ...normalizePageSetup(pageSetup.value), orientation });
}

function applyCustomPaper() {
  const { widthMm, heightMm } = customPaperDraft.value;
  setPageSetup({
    size: "custom",
    orientation: Number(widthMm) > Number(heightMm) ? "landscape" : "portrait",
    widthMm,
    heightMm,
  });
}

function openPaperMenu(event) {
  const current = normalizePageSetup(pageSetup.value);
  const paper = current.size === "custom" ? current : PAPER_SIZES.find((item) => item.id === current.size);
  const landscape = current.orientation === "landscape";
  const short = Math.min(paper.widthMm, paper.heightMm);
  const long = Math.max(paper.widthMm, paper.heightMm);
  customPaperDraft.value = landscape ? { widthMm: long, heightMm: short } : { widthMm: short, heightMm: long };
  toggleRibbonMenu("paper-size", event);
}

// ---------- AI 어시스턴트 ----------
// 어시스턴트 도구(src/assistant/editor-tools.js)가 에디터 상태를 바꿀 때 쓰는 함수 묶음.

const isAssistantOpen = ref(false);

function deletePage(index) {
  if (pages.value.length <= 1 || index < 0 || index >= pages.value.length) return;
  pages.value[currentPageIndex.value].blocks = blocks.value;
  pages.value.splice(index, 1);
  currentPageIndex.value = Math.min(currentPageIndex.value > index ? currentPageIndex.value - 1 : currentPageIndex.value, pages.value.length - 1);
  blocks.value = pages.value[currentPageIndex.value].blocks;
  selectedId.value = blocks.value[0]?.id ?? "";
}

function assistantPageBlocks(index) {
  return index === currentPageIndex.value ? blocks.value : pages.value[index].blocks;
}

async function assistantCreateTemplate({ label, group, layoutType }) {
  pages.value[currentPageIndex.value].blocks = blocks.value;
  const duplicate = customTemplates.value.some((item) => item.label === label && item.group === group);
  if (duplicate) throw new Error(`'${group}' 그룹에 같은 이름의 양식이 있습니다. 다른 이름을 정해 주세요.`);
  const templatePages = currentEditorPages().map((page) => ({ id: page.id, blocks: page.blocks }));
  const template = await createTemplate({
    label, group, layoutType, blocks: templatePages[0].blocks, pages: templatePages,
    headerFooter: headerFooter.value, pageSetup: pageSetup.value, access: { groups: [], users: [] },
  });
  customTemplates.value.push(template);
  scheduleRows.value = await getSchedules().catch(() => scheduleRows.value);
  // 새 양식으로 다시 열면 요소 id가 바뀌므로, 지금 편집 중인 페이지를 그대로 둔 채 저장 상태만 맞춘다.
  reportType.value = template.id;
  markEditorSaved();
  saveState.value = "saved";
  saveStatus.value = `AI 어시스턴트가 '${label}' 양식을 새로 저장했습니다.`;
  return template;
}

async function assistantSaveTemplate({ label, group, layoutType } = {}) {
  const template = activeTemplate.value;
  const nextLabel = label ?? template.label;
  const nextGroup = group ?? template.group;
  if ((label || group) && customTemplates.value.some((item) => item.id !== reportType.value && item.label === nextLabel && item.group === nextGroup)) {
    throw new Error(`'${nextGroup}' 그룹에 같은 이름의 양식이 있습니다.`);
  }
  pages.value[currentPageIndex.value].blocks = blocks.value;
  saveState.value = "saving";
  saveStatus.value = "보고서 양식을 저장하고 있습니다.";
  try {
    const updated = await updateTemplate(reportType.value, {
      label: nextLabel, group: nextGroup, layoutType: layoutType ?? activeLayoutType.value,
      blocks: blocks.value, pages: pages.value, headerFooter: headerFooter.value, pageSetup: pageSetup.value,
    });
    const index = customTemplates.value.findIndex((item) => item.id === updated.id);
    if (index >= 0) customTemplates.value[index] = updated;
    markEditorSaved();
    saveState.value = "saved";
    saveStatus.value = "AI 어시스턴트가 양식을 저장했습니다.";
    return updated;
  } catch (error) {
    saveState.value = "error";
    saveStatus.value = `양식을 저장하지 못했습니다: ${error.message}`;
    throw error;
  }
}

async function assistantDeleteTemplate(id) {
  await deleteTemplate(id);
  customTemplates.value = customTemplates.value.filter((item) => item.id !== id);
  scheduleRows.value = scheduleRows.value.filter((item) => item.templateId !== id);
  if (reportType.value === id) await changeReportType(firstTemplateId());
}

async function assistantSaveSchedule(id, schedule) {
  const saved = await saveSchedule(id, schedule);
  const index = scheduleRows.value.findIndex((item) => item.templateId === saved.templateId);
  if (index < 0) scheduleRows.value.push(saved);
  else scheduleRows.value[index] = saved;
  return saved;
}

async function assistantMailRequest(id, settings) {
  const response = await fetch(`/api/templates/${encodeURIComponent(id)}/mail`, {
    method: settings ? "PUT" : "GET",
    headers: { Accept: "application/json", ...(settings ? { "Content-Type": "application/json" } : {}) },
    ...(settings ? { body: JSON.stringify(settings) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `메일 설정 요청에 실패했습니다 (${response.status}).`);
  return result.settings;
}

async function assistantExecuteQuery(sql, parameters, datasourceId) {
  const reportPeriod = getReportPeriod(date.value, activeLayoutType.value);
  return executeDataQuery(sql, resolveScheduleParameters(parameters, reportPeriod), datasourceId || "");
}

// 되돌리기: 요청 직전의 편집 상태(페이지·머리글·용지)를 통째로 보관한다.
function assistantSnapshot() {
  return JSON.stringify({
    reportType: reportType.value, currentPageIndex: currentPageIndex.value,
    pages: currentEditorPages(), headerFooter: headerFooter.value, pageSetup: pageSetup.value,
  });
}

function assistantRestore(snapshot) {
  const value = JSON.parse(snapshot);
  if (value.reportType !== reportType.value) {
    return { ok: false, message: "그 사이 다른 양식을 열어 되돌릴 수 없습니다. 원래 양식을 열어 직접 수정해 주세요." };
  }
  pages.value = value.pages;
  currentPageIndex.value = Math.min(value.currentPageIndex, pages.value.length - 1);
  blocks.value = pages.value[currentPageIndex.value].blocks;
  headerFooter.value = value.headerFooter;
  pageSetup.value = value.pageSetup;
  selectedId.value = blocks.value[0]?.id ?? "";
  return { ok: true };
}

const assistantContext = {
  state: () => ({
    templateId: isCustomTemplateId(reportType.value) ? reportType.value : "",
    templateLabel: activeTemplate.value.label,
    templateGroup: activeTemplate.value.group,
    layoutType: activeLayoutType.value,
    unsaved: hasUnsavedEditorChanges.value,
    currentPage: currentPageIndex.value,
    selectedId: selectedId.value,
    pageSetup: pageSetup.value,
    headerFooter: headerFooter.value,
  }),
  pages: () => pages.value,
  pageBlocks: assistantPageBlocks,
  showPage: selectPage,
  addPage,
  deletePage,
  createBlock: createDefaultBlock,
  selectBlock,
  blockLabel,
  ensureBinding: ensureDataBinding,
  setPageSetup,
  setHeaderFooter: (config) => { headerFooter.value = config; },
  templates: () => customTemplates.value,
  schedules: () => scheduleRows.value,
  openTemplate: changeReportType,
  createTemplate: assistantCreateTemplate,
  saveTemplate: assistantSaveTemplate,
  deleteTemplate: assistantDeleteTemplate,
  saveSchedule: assistantSaveSchedule,
  getMailSettings: (id) => assistantMailRequest(id),
  saveMailSettings: (id, settings) => assistantMailRequest(id, settings),
  datasources: () => datasources.value,
  executeQuery: assistantExecuteQuery,
  setPreview: (open) => { isPreviewOpen.value = open; },
  print: printReport,
  snapshot: assistantSnapshot,
  restore: assistantRestore,
};

onMounted(async () => {
  markEditorSaved();
  window.addEventListener("beforeunload", handleBeforeUnload);
  scheduleClockTimer = setInterval(() => {
    scheduleClockTick.value = Date.now();
  }, 60_000);
  refreshEditorSchedules();
  refreshDatasources();
  try {
    await loadTemplateCatalog();
  } catch (error) {
    catalogError.value = `양식 목록을 불러오지 못했습니다: ${error.message}`;
  }
  // 마지막으로 작업한 양식을 열고, 없으면(처음이거나 삭제됨) 목록의 첫 양식, 양식이 하나도 없으면 새 양식으로 시작한다.
  if (!reportType.value) await changeReportType(readLastTemplateId() || firstTemplateId());
  loadDatabaseStatus();
  window.addEventListener("pointerup", endCellSelection);
  document.addEventListener("pointerdown", handleShapeMenuOutside);
  document.addEventListener("pointerdown", handleRibbonMenuOutside);
  window.addEventListener("keydown", handleEditorKeydown);
});

onUnmounted(() => {
  clearTimeout(managerNoticeTimer);
  clearInterval(scheduleClockTimer);
  window.removeEventListener("pointerup", endCellSelection);
  document.removeEventListener("pointerdown", handleShapeMenuOutside);
  document.removeEventListener("pointerdown", handleRibbonMenuOutside);
  window.removeEventListener("keydown", handleEditorKeydown);
  window.removeEventListener("beforeunload", handleBeforeUnload);
});
</script>

<template>
  <div class="designer">
    <header class="topbar">
      <div class="topbar-title">
        <a class="brand" href="/" aria-label="CODVILL 홈">
          <img class="brand-logo" src="/codvill-logo-white.png" alt="CODVILL" />
        </a>
        <span class="topbar-title-divider" aria-hidden="true"></span>
        <div class="viewer-header-heading topbar-heading">
          <p class="portal-eyebrow">REPORT EDITOR</p>
          <h1>리포트 에디터</h1>
        </div>
        <ToolNav :auth-user="props.authUser" current="editor" dark @select-tool="selectTool" />
      </div>
      <div class="topbar-actions">
        <button
          class="topbar-assistant-button"
          :class="{ active: isAssistantOpen }"
          type="button"
          :aria-pressed="isAssistantOpen"
          title="AI 어시스턴트: 말로 양식을 만들고 설정합니다"
          @click="isAssistantOpen = !isAssistantOpen"
        >
          <span aria-hidden="true">✦</span>
          AI 어시스턴트
        </button>
        <button class="topbar-viewer-button" type="button" @click="emit('help')">도움말</button>
        <button
          class="topbar-datasource-button"
          type="button"
          v-if="props.authUser.role === 'ADMIN'"
          title="리포트 설정"
          @click="openReportSettings"
        >
          <ActionIcon name="settings" />
          리포트 설정
        </button>
        <button class="topbar-viewer-button" type="button" @click="emit('logout')">로그아웃</button>
      </div>
    </header>

    <main ref="designerGrid" class="designer-grid" :style="designerGridStyle">
      <aside class="toolbox" aria-label="보고서 요소">
        <div
          class="panel-resizer panel-resizer-end"
          role="separator"
          aria-orientation="vertical"
          aria-label="페이지 패널 너비 조절"
          title="끌어서 너비 조절 · 두 번 클릭하면 기본 너비"
          tabindex="0"
          @pointerdown="startPanelResize('toolbox', $event)"
          @dblclick="resetPanelWidth('toolbox')"
          @keydown="resizePanelByKey('toolbox', $event)"
        ></div>
        <button
          class="template-management-button"
          type="button"
          @click="openTemplateManager"
        >
          <img src="/report-template-icon.png?v=2" alt="" aria-hidden="true" />
          보고서 양식 관리
        </button>
        <div class="panel-heading">
          <h1>{{ reportLabel }} · 보고서 탐색기</h1>
          <span class="panel-heading-icon" aria-hidden="true">⌄</span>
        </div>
        <div class="outline-list">
          <div class="outline-pages-heading">
            <p class="panel-caption">페이지</p>
            <button class="add-page-button" type="button" @click="addPage">
              <ActionIcon name="add" />
              페이지 추가
            </button>
          </div>
          <section
            v-for="(page, pageIndex) in pages"
            :key="page.id"
            class="outline-page"
          >
            <button
              type="button"
              class="outline-page-title"
              :class="{ 'outline-page-selected': currentPageIndex === pageIndex }"
              :aria-current="currentPageIndex === pageIndex ? 'page' : undefined"
              :aria-expanded="currentPageIndex === pageIndex"
              @click="selectPage(pageIndex)"
            >
              <span class="outline-page-caret" aria-hidden="true">{{ currentPageIndex === pageIndex ? "▾" : "▸" }}</span>
              <span class="outline-page-icon">▤</span>
              <span class="outline-page-name">페이지 {{ pageIndex + 1 }}</span>
              <span class="outline-page-count" :title="`요소 ${page.blocks.length}개`">{{ page.blocks.length }}</span>
            </button>
            <!-- 페이지 아래 요소를 트리 선으로 이어 페이지와 요소를 구분한다 -->
            <div v-if="currentPageIndex === pageIndex" class="outline-children" role="group" :aria-label="`페이지 ${pageIndex + 1} 요소`">
              <div v-for="block in page.blocks" :key="block.id" class="outline-node">
                <button
                  type="button"
                  class="outline-item"
                  :class="{ 'outline-item-selected': selectedId === block.id }"
                  :aria-current="selectedId === block.id ? 'true' : undefined"
                  @click="selectBlock(block.id)"
                >
                  <span class="outline-icon" aria-hidden="true">
                    <ChartTypeIcon v-if="block.type === 'chart'" :type="block.chart?.category ?? 'column'" />
                    <template v-else>
                      {{ block.type === "title" ? "T" : block.type === "divider" ? "—" : block.type === "date" ? "◷" : block.type === "image" ? "▨" : block.type === "shape" ? "◆" : block.type === "table" ? "▦" : "¶" }}
                    </template>
                  </span>
                  <span class="outline-name">{{ blockLabel(block) }}</span>
                </button>
              </div>
              <p v-if="!page.blocks.length" class="outline-node outline-empty">요소 없음</p>
            </div>
          </section>
        </div>
        <div class="template-transfer-actions">
          <button type="button" @click="isTransferOpen = true">양식 가져오기</button>
          <button type="button" @click="exportCurrentTemplate">양식 내보내기</button>
        </div>
        <div class="toolbox-footer">
          <strong :title="props.authUser.name">{{ props.authUser.name }}</strong>
          <span>{{ ROLE_LABELS[props.authUser.role] }}</span>
        </div>
      </aside>

      <section class="canvas-workspace" aria-label="보고서 편집 캔버스">
        <div class="editor-toolbar-row">
          <nav class="insert-toolbar" aria-label="보고서 항목 추가">
            <strong>보고서 항목</strong>
            <button
              v-for="item in insertableItems"
              :key="item.type"
              class="insert-tool-button"
              type="button"
              draggable="true"
              :aria-label="`${item.label} 요소 추가`"
              :title="`${item.label} 추가`"
              @click="addBlock(item.type)"
              @dragstart="startBlockDrag(item.type, $event)"
              @dragend="finishBlockDrag"
            >
              <span class="insert-tool-icon" aria-hidden="true">{{ item.icon }}</span>
              <span>{{ item.label }}</span>
            </button>
            <span class="insert-group-divider" aria-hidden="true"></span>
            <div class="illustration-group" role="group" aria-label="일러스트레이션">
              <button
                class="insert-tool-button illustration-button"
                type="button"
                draggable="true"
                title="그림 삽입 (PNG, JPG, GIF, WEBP)"
                aria-label="그림 삽입"
                @click="pickImage()"
                @dragstart="startBlockDrag('image', $event)"
                @dragend="finishBlockDrag"
              >
                <svg class="illustration-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="2.5" y="4" width="19" height="16" rx="1.5" fill="#e8f1fb" stroke="#2e75b6" stroke-width="1.4" />
                  <path d="m4 18 5.2-6.2 3.6 4 2.6-2.8L20 18z" fill="#4f8fd0" />
                  <circle cx="16.5" cy="8.5" r="1.8" fill="#f2a33a" />
                </svg>
                <span>그림</span>
              </button>
              <button
                ref="shapeMenuButton"
                class="insert-tool-button illustration-button"
                type="button"
                draggable="true"
                title="도형 삽입"
                aria-label="도형 삽입"
                aria-haspopup="menu"
                :aria-expanded="Boolean(shapeMenu)"
                @click="toggleShapeMenu"
                @dragstart="startBlockDrag('shape', $event)"
                @dragend="finishBlockDrag"
              >
                <svg class="illustration-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="2.5" y="3" width="12" height="12" fill="#4f8fd0" stroke="#2e75b6" stroke-width="1.2" />
                  <circle cx="15.5" cy="15" r="6" fill="#fff" stroke="#3a3f4b" stroke-width="1.4" />
                </svg>
                <span>도형<i class="illustration-caret" aria-hidden="true"></i></span>
              </button>
              <button
                class="insert-tool-button illustration-button"
                type="button"
                draggable="true"
                title="차트 삽입"
                aria-label="차트 삽입"
                @click="openChartInsert"
                @dragstart="startBlockDrag('chart', $event)"
                @dragend="finishBlockDrag"
              >
                <svg class="illustration-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 20.5h18" stroke="#3a3f4b" stroke-width="1.3" />
                  <rect x="4.5" y="12" width="4" height="8" fill="#a5a5a5" stroke="#6b6f78" stroke-width=".8" />
                  <rect x="10" y="5" width="4" height="15" fill="#fff" stroke="#3a3f4b" stroke-width="1.1" />
                  <rect x="15.5" y="9" width="4" height="11" fill="#4f8fd0" stroke="#2e75b6" stroke-width=".8" />
                </svg>
                <span>차트</span>
              </button>
            </div>
            <span class="insert-group-divider" aria-hidden="true"></span>
            <div class="illustration-group" role="group" aria-label="배치">
              <button
                class="insert-tool-button illustration-button"
                type="button"
                data-ribbon-menu
                title="선택한 요소부터 가로로 나눠 나란히 배치"
                aria-haspopup="menu"
                :aria-expanded="ribbonMenu?.name === 'split'"
                :disabled="!selectedBlock || isFree(selectedBlock)"
                @click="toggleRibbonMenu('split', $event)"
              >
                <svg class="illustration-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="2.5" y="4" width="8.5" height="16" rx="1" fill="#dbe7f7" stroke="#2e75b6" stroke-width="1.3" />
                  <rect x="13" y="4" width="8.5" height="16" rx="1" fill="#fde5d3" stroke="#d26b26" stroke-width="1.3" />
                </svg>
                <span>분할<i class="illustration-caret" aria-hidden="true"></i></span>
              </button>
              <button
                class="insert-tool-button illustration-button"
                :class="{ 'illustration-button-active': selectedBlock && isFree(selectedBlock) }"
                type="button"
                title="자유롭게 배치(다른 요소와 겹쳐 놓기) / 영역 배치로 되돌리기"
                :aria-pressed="Boolean(selectedBlock && isFree(selectedBlock))"
                :disabled="!selectedBlock"
                @click="setLayoutMode(selectedBlock, isFree(selectedBlock) ? 'flow' : 'free:front')"
              >
                <svg class="illustration-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="2.5" y="3" width="13" height="11" rx="1" fill="#e8eaee" stroke="#6b7385" stroke-width="1.2" />
                  <rect x="8.5" y="9" width="13" height="11" rx="1" fill="#4f8fd0" fill-opacity=".85" stroke="#2e75b6" stroke-width="1.2" />
                </svg>
                <span>자유 배치</span>
              </button>
            </div>
            <span class="insert-group-divider" aria-hidden="true"></span>
            <div class="illustration-group" role="group" aria-label="머리글/바닥글">
              <button
                class="insert-tool-button illustration-button"
                type="button"
                data-ribbon-menu
                title="머리글"
                aria-haspopup="menu"
                :aria-expanded="ribbonMenu?.name === 'header'"
                @click="toggleRibbonMenu('header', $event)"
              >
                <svg class="illustration-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 2.5h10l4 4v15H5z" fill="#fff" stroke="#3a3f4b" stroke-width="1.2" />
                  <rect x="7" y="5" width="9" height="3.5" fill="#f2a33a" />
                </svg>
                <span>머리글<i class="illustration-caret" aria-hidden="true"></i></span>
              </button>
              <button
                class="insert-tool-button illustration-button"
                type="button"
                data-ribbon-menu
                title="바닥글"
                aria-haspopup="menu"
                :aria-expanded="ribbonMenu?.name === 'footer'"
                @click="toggleRibbonMenu('footer', $event)"
              >
                <svg class="illustration-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 2.5h10l4 4v15H5z" fill="#fff" stroke="#3a3f4b" stroke-width="1.2" />
                  <rect x="7" y="15.5" width="10" height="3.5" fill="#f2a33a" />
                </svg>
                <span>바닥글<i class="illustration-caret" aria-hidden="true"></i></span>
              </button>
              <button
                class="insert-tool-button illustration-button"
                type="button"
                data-ribbon-menu
                title="페이지 번호"
                aria-haspopup="menu"
                :aria-expanded="ribbonMenu?.name === 'page-number'"
                @click="toggleRibbonMenu('page-number', $event)"
              >
                <svg class="illustration-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 2.5h10l4 4v15H5z" fill="#fff" stroke="#3a3f4b" stroke-width="1.2" />
                  <path d="M10.5 10.5 10 17.5M13.5 10.5 13 17.5M8.8 12.8h6M8.5 15.3h6" stroke="#2e75b6" stroke-width="1.3" />
                </svg>
                <span>페이지 번호<i class="illustration-caret" aria-hidden="true"></i></span>
              </button>
            </div>
            <span class="insert-group-divider" aria-hidden="true"></span>
            <div class="illustration-group" role="group" aria-label="페이지 설정">
              <button
                class="insert-tool-button illustration-button"
                type="button"
                data-ribbon-menu
                :title="`용지 방향 — 지금: ${pageDimensions.landscape ? '가로' : '세로'}`"
                aria-haspopup="menu"
                :aria-expanded="ribbonMenu?.name === 'orientation'"
                @click="toggleRibbonMenu('orientation', $event)"
              >
                <svg class="illustration-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="6.5" width="15" height="11" rx="1" fill="#fff" stroke="#6b7385" stroke-width="1.1" />
                  <rect x="9" y="2.5" width="11" height="15" rx="1" fill="#dbe7f7" stroke="#2e75b6" stroke-width="1.2" />
                  <path d="M5 21h6" stroke="#2e75b6" stroke-width="1.2" />
                </svg>
                <span>방향<i class="illustration-caret" aria-hidden="true"></i></span>
              </button>
              <button
                class="insert-tool-button illustration-button"
                type="button"
                data-ribbon-menu
                :title="`용지 크기 — 지금: ${pageSetupText}`"
                aria-haspopup="menu"
                :aria-expanded="ribbonMenu?.name === 'paper-size'"
                @click="openPaperMenu($event)"
              >
                <svg class="illustration-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 2.5h9l4 4v15H6z" fill="#fff" stroke="#3a3f4b" stroke-width="1.2" />
                  <path d="M3 5v14M2 6l1-1.2L4 6M2 18l1 1.2 1-1.2" stroke="#2e75b6" stroke-width="1.1" fill="none" />
                  <text x="12.5" y="16" font-size="6" font-weight="700" fill="#2e75b6" text-anchor="middle">A4</text>
                </svg>
                <span>크기<i class="illustration-caret" aria-hidden="true"></i></span>
              </button>
              <button
                class="insert-tool-button illustration-button"
                :class="{ 'illustration-button-active': showBoundaries }"
                type="button"
                title="편집 용지에 본문 영역(여백 안쪽) 경계를 점선으로 표시합니다. 인쇄·내보내기에는 나오지 않습니다."
                :aria-pressed="showBoundaries"
                @click="toggleBoundaries"
              >
                <svg class="illustration-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3.5" y="2.5" width="17" height="19" rx="1" fill="#fff" stroke="#3a3f4b" stroke-width="1.1" />
                  <rect x="7" y="6" width="10" height="12" fill="none" stroke="#2e75b6" stroke-width="1.1" stroke-dasharray="2 1.5" />
                </svg>
                <span>영역 표시</span>
              </button>
            </div>
            <input
              ref="imageFileInput"
              class="visually-hidden-input"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              tabindex="-1"
              aria-hidden="true"
              @change="handleImageFileChange"
            />
          </nav>
          <div class="toolbar" aria-label="도구 모음">
            <button
              class="tool-button"
              type="button"
              :disabled="!selectedBlock || blocks.findIndex((block) => block.id === selectedId) === 0"
              aria-label="위로 이동"
              title="위로 이동"
              @click="moveSelectedBlock(-1)"
            ><ActionIcon name="up" /><span>위로</span></button>
            <button
              class="tool-button"
              type="button"
              :disabled="!selectedBlock || blocks.findIndex((block) => block.id === selectedId) === blocks.length - 1"
              aria-label="아래로 이동"
              title="아래로 이동"
              @click="moveSelectedBlock(1)"
            ><ActionIcon name="down" /><span>아래로</span></button>
            <button
              class="tool-button tool-delete"
              type="button"
              :disabled="!selectedBlock"
              @click="deleteSelectedBlock"
            ><ActionIcon name="delete" /><span>삭제</span></button>
            <!-- 저장 상태: 화면 낭독기에만 알리고, 저장 실패일 때만 화면에 표시한다 -->
            <span class="toolbar-save-live" aria-live="polite">{{ saveStatus }}</span>
            <span
              v-if="saveState === 'error'"
              class="toolbar-save-error"
              :title="saveStatus"
            >저장 실패</span>
            <div class="toolbar-spacer"></div>
            <button
              class="preview-button"
              type="button"
              @click="isPreviewOpen = true"
            ><ActionIcon name="view" />미리보기</button>
            <button
              class="save-button"
              type="button"
              :disabled="saveState === 'saving'"
              @click="saveEditorTemplate"
            ><ActionIcon name="save" />{{ saveState === "saving" ? "저장 중..." : "양식 저장" }}</button>
          </div>
        </div>
        <FontToolbar
          :style-state="fontStyleState"
          :disabled="!fontFormatTarget"
          :target-label="fontTargetLabel"
          @apply="applyFontPatch"
          @toggle="toggleFontStyle"
          @font-size="setFontSize"
          @grow="stepFontSize(1)"
          @shrink="stepFontSize(-1)"
          @change-case="changeSelectionCase"
          @clear="clearFontFormatting"
          @align="setTextAlignment"
        />
        <div class="canvas-heading">
          <div>
            <span class="canvas-breadcrumb">보고서</span>
            <span class="breadcrumb-separator">/</span>
            <strong>{{ reportLabel }}</strong>
          </div>
          <div class="canvas-heading-controls">
            <button
              class="tool-button zoom-button"
              type="button"
              aria-label="축소"
              @click="zoom = Math.max(70, zoom - 10)"
            ><ActionIcon name="zoom-out" /></button>
            <span class="zoom-value">{{ zoom }}%</span>
            <button
              class="tool-button zoom-button"
              type="button"
              aria-label="확대"
              @click="zoom = Math.min(130, zoom + 10)"
            ><ActionIcon name="zoom-in" /></button>
            <span class="canvas-page-info" :title="pageSetupText">{{ pageSetupText }}</span>
          </div>
        </div>
        <div
          class="canvas-scroll"
          :class="{ 'canvas-drop-active': isDraggingBlock }"
          @dragover.prevent
          @drop="dropBlock"
          @pointerdown.capture="handleCanvasPointerDown"
          @click="handleCanvasClick"
        >
          <ReportCanvas
            :report-type="activeLayoutType"
            :date="date"
            :blocks="blocks"
            :selected-id="selectedId"
            :selected-cells="selectedCells"
            :zoom="zoom"
            :can-merge-cells="canMergeCells"
            :can-unmerge-cells="canUnmergeCells"
            :header-footer="headerFooter"
            :page-setup="pageSetup"
            :show-boundaries="showBoundaries"
            :page-index="currentPageIndex"
            :page-count="pages.length"
            :report-title="reportLabel"
            interactive
            @select="selectBlock"
            @layout-update="applyLayoutUpdate"
            @table-resize="applyTableResize"
            @edit-header-footer="openHeaderFooterDialog"
            @cell-pointerdown="beginCanvasCellSelection"
            @cell-pointerenter="extendCanvasCellSelection"
            @cell-input="handleCanvasCellInput"
            @field-input="handleCanvasFieldInput"
            @cell-field="setCellField"
            @cell-select="selectCanvasCell"
            @row-repeat="setRowRepeat"
            @cell-shade="applyShadeToSelectedCells"
            @cell-merge="mergeSelectedCells"
            @cell-unmerge="unmergeSelectedCells"
            @reorder="moveBlockByDrop"
            @insert-drop="insertBlockByDrop"
          />
        </div>
        <div class="status-bar">
          <div class="status-bar-left">
            <span><i class="status-dot"></i> 미리보기 업데이트됨</span>
            <span class="status-separator" aria-hidden="true"></span>
            <button
              class="status-schedule"
              :class="{ 'status-schedule-on': editorScheduleSummary.enabled }"
              type="button"
              :title="`${editorScheduleSummary.text} — 클릭하면 자동 생성 일정을 설정합니다`"
              @click="openScheduleSettings"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 4.8V8l2.2 1.4" /></svg>
              <span>{{ editorScheduleSummary.text }}</span>
            </button>
          </div>
          <span>페이지 {{ currentPageIndex + 1 }} / {{ pages.length }}</span>
        </div>
      </section>

      <aside class="properties-panel" aria-label="속성 패널">
        <div
          class="panel-resizer panel-resizer-start"
          role="separator"
          aria-orientation="vertical"
          aria-label="속성 패널 너비 조절"
          title="끌어서 너비 조절 · 두 번 클릭하면 기본 너비"
          tabindex="0"
          @pointerdown="startPanelResize('properties', $event)"
          @dblclick="resetPanelWidth('properties')"
          @keydown="resizePanelByKey('properties', $event)"
        ></div>
        <div class="panel-heading properties-heading">
          <h2>속성</h2>
          <span class="properties-context">{{ selectedBlock ? blockLabel(selectedBlock) : "선택 없음" }}</span>
        </div>
        <div v-if="selectedBlock" class="properties-content">
          <div class="property-tabs" role="tablist" aria-label="속성 분류">
            <button
              id="property-tab-general"
              type="button"
              role="tab"
              class="property-tab"
              :class="{ 'property-tab-active': activePropertyTab === 'general' }"
              :aria-selected="activePropertyTab === 'general'"
              aria-controls="property-panel-general"
              @click="propertyTab = 'general'"
            >일반</button>
            <button
              v-if="selectedBlock.type === 'table'"
              id="property-tab-table"
              type="button"
              role="tab"
              class="property-tab"
              :class="{ 'property-tab-active': activePropertyTab === 'table' }"
              :aria-selected="activePropertyTab === 'table'"
              aria-controls="property-panel-table"
              @click="propertyTab = 'table'"
            >표</button>
            <button
              id="property-tab-data"
              type="button"
              role="tab"
              class="property-tab"
              :class="{ 'property-tab-active': activePropertyTab === 'data' }"
              :aria-selected="activePropertyTab === 'data'"
              aria-controls="property-panel-data"
              :disabled="!supportsDataBinding(selectedBlock)"
              :title="supportsDataBinding(selectedBlock) ? undefined : `${blockLabel(selectedBlock)} 요소는 데이터 바인딩을 사용하지 않습니다`"
              @click="propertyTab = 'data'"
            >
              데이터 바인딩
              <i v-if="hasActiveBinding(selectedBlock)" class="property-tab-dot" title="DB 데이터 사용 중" aria-label="사용 중"></i>
            </button>
          </div>
          <div
            v-show="activePropertyTab === 'general'"
            id="property-panel-general"
            role="tabpanel"
            aria-labelledby="property-tab-general"
          >
          <section class="property-group">
            <h3>내용</h3>
            <p v-if="INLINE_TEXT_TYPES.includes(selectedBlock.type)" class="property-hint">
              글자는 캔버스에서 눌러 바로 고칩니다. DB 필드에 연결된 값은 ‘데이터 바인딩’ 탭에서 바꿉니다.
            </p>
            <template v-if="selectedBlock.type === 'period'">
              <label for="property-period-start">시작 시각</label>
              <input id="property-period-start" v-model="selectedBlock.start" type="datetime-local" />
              <label for="property-period-end">종료 시각</label>
              <input id="property-period-end" v-model="selectedBlock.end" type="datetime-local" />
            </template>
            <template v-else-if="selectedBlock.type === 'table'">
              <p class="property-hint">표 제목·단위·요약·셀 값은 캔버스에서 바로 고치고, 행·열, 제목행, 열 음영은 ‘표’ 탭에서 편집합니다.</p>
            </template>
            <template v-else-if="selectedBlock.type === 'date'">
              <p class="property-hint">보고서가 자동 생성되는 날짜가 표시됩니다.</p>
            </template>
            <template v-else-if="selectedBlock.type === 'image'">
              <div class="image-property-preview">
                <img v-if="selectedBlock.image?.src" :src="selectedBlock.image.src" alt="" />
                <span v-else>그림 없음</span>
              </div>
              <button class="binding-run-button" type="button" @click="pickImage(selectedBlock.id)">
                <ActionIcon name="open" />{{ selectedBlock.image?.src ? "그림 바꾸기" : "그림 선택" }}
              </button>
              <p v-if="imageMessage" class="binding-status binding-status-error">{{ imageMessage }}</p>
              <label for="property-image-width">너비 ({{ selectedBlock.image.widthPercent }}%)</label>
              <input id="property-image-width" v-model.number="selectedBlock.image.widthPercent" type="range" min="10" max="100" step="5" />
              <label for="property-image-align">정렬</label>
              <select id="property-image-align" v-model="selectedBlock.align">
                <option value="left">왼쪽</option>
                <option value="center">가운데</option>
                <option value="right">오른쪽</option>
              </select>
              <label class="binding-toggle"><input v-model="selectedBlock.image.border" type="checkbox" />테두리</label>
              <p class="property-hint">그림 설명(캡션)은 캔버스의 그림 아래에서 바로 입력합니다. 비워 두면 표시하지 않습니다.</p>
              <label for="property-image-alt">대체 텍스트</label>
              <input id="property-image-alt" v-model="selectedBlock.image.alt" placeholder="화면 낭독기용 설명" />
              <p v-if="selectedBlock.image?.naturalWidth" class="property-hint">
                원본 {{ selectedBlock.image.naturalWidth }} × {{ selectedBlock.image.naturalHeight }}px · 큰 그림은 긴 변 1600px로 줄여 저장합니다.
              </p>
            </template>
            <template v-else-if="selectedBlock.type === 'shape'">
              <label for="property-shape-kind">도형</label>
              <select id="property-shape-kind" :value="selectedBlock.shape.kind" @change="changeShapeKind(selectedBlock, $event.target.value)">
                <optgroup v-for="group in SHAPE_GROUPS" :key="group.label" :label="group.label">
                  <option v-for="shape in group.shapes" :key="shape.id" :value="shape.id">{{ shape.label }}</option>
                </optgroup>
              </select>
              <template v-if="!getShape(selectedBlock.shape.kind).line">
                <label for="property-shape-fill">채우기</label>
                <div class="shape-color-row">
                  <input id="property-shape-fill" type="color" :value="selectedBlock.shape.fill === 'none' ? '#ffffff' : selectedBlock.shape.fill" :disabled="selectedBlock.shape.fill === 'none'" @input="selectedBlock.shape.fill = $event.target.value" />
                  <label class="binding-toggle"><input type="checkbox" :checked="selectedBlock.shape.fill === 'none'" @change="selectedBlock.shape.fill = $event.target.checked ? 'none' : '#4472C4'" />채우기 없음</label>
                </div>
              </template>
              <label for="property-shape-stroke">선</label>
              <div class="shape-color-row">
                <input id="property-shape-stroke" type="color" :value="selectedBlock.shape.stroke === 'none' ? '#000000' : selectedBlock.shape.stroke" :disabled="selectedBlock.shape.stroke === 'none'" @input="selectedBlock.shape.stroke = $event.target.value" />
                <label v-if="!getShape(selectedBlock.shape.kind).line" class="binding-toggle"><input type="checkbox" :checked="selectedBlock.shape.stroke === 'none'" @change="selectedBlock.shape.stroke = $event.target.checked ? 'none' : '#2F528F'" />선 없음</label>
              </div>
              <label for="property-shape-stroke-width">선 두께 (px)</label>
              <input id="property-shape-stroke-width" v-model.number="selectedBlock.shape.strokeWidth" type="number" min="0" max="20" step="0.5" />
              <div class="shape-size-row">
                <label>너비<input v-model.number="selectedBlock.shape.width" type="number" min="8" max="479" step="1" /></label>
                <label>높이<input v-model.number="selectedBlock.shape.height" type="number" min="4" max="700" step="1" /></label>
              </div>
              <label for="property-shape-opacity">투명도 ({{ Math.round((1 - (selectedBlock.shape.opacity ?? 1)) * 100) }}%)</label>
              <input id="property-shape-opacity" type="range" min="0" max="0.9" step="0.05" :value="1 - (selectedBlock.shape.opacity ?? 1)" @input="selectedBlock.shape.opacity = Math.round((1 - Number($event.target.value)) * 100) / 100" />
              <label for="property-shape-align">정렬</label>
              <select id="property-shape-align" v-model="selectedBlock.align">
                <option value="left">왼쪽</option>
                <option value="center">가운데</option>
                <option value="right">오른쪽</option>
              </select>
              <p class="property-hint">도형 글자는 캔버스의 도형 안에서 바로 입력하고, 글꼴·크기·색은 위쪽 글꼴 도구에서 바꿉니다.</p>
            </template>
            <template v-else-if="selectedBlock.type === 'chart'">
              <label>차트 종류</label>
              <div class="chart-type-row">
                <span><ChartTypeIcon :type="selectedBlock.chart.category" />{{ chartTypeLabel(selectedBlock.chart) }}</span>
                <button class="binding-manage-button" type="button" @click="openChartTypeChange(selectedBlock)"><ActionIcon name="edit" />변경</button>
              </div>
              <label for="property-chart-title">차트 제목</label>
              <input id="property-chart-title" v-model="selectedBlock.chart.title" />
              <label class="binding-toggle"><input v-model="selectedBlock.chart.showTitle" type="checkbox" />제목 표시</label>
              <label for="property-chart-legend">범례</label>
              <select id="property-chart-legend" v-model="selectedBlock.chart.legend">
                <option value="bottom">아래쪽</option>
                <option value="top">위쪽</option>
                <option value="right">오른쪽</option>
                <option value="none">표시 안 함</option>
              </select>
              <label class="binding-toggle"><input v-model="selectedBlock.chart.showLabels" type="checkbox" />데이터 레이블 표시</label>
              <template v-if="CHART_AXIS_CATEGORIES.has(selectedBlock.chart.category)">
                <label for="property-chart-x">가로 축 제목</label>
                <input id="property-chart-x" v-model="selectedBlock.chart.xAxisTitle" placeholder="없음" />
                <label for="property-chart-y">세로 축 제목</label>
                <input id="property-chart-y" v-model="selectedBlock.chart.yAxisTitle" placeholder="없음" />
              </template>
              <template v-if="selectedBlock.chart.category === 'histogram'">
                <label for="property-chart-bins">구간 수 (0 = 자동)</label>
                <input id="property-chart-bins" v-model.number="selectedBlock.chart.histogramBins" type="number" min="0" max="50" />
              </template>
              <label for="property-chart-height">높이 (px)</label>
              <input id="property-chart-height" v-model.number="selectedBlock.chart.height" type="number" min="120" max="700" step="10" />
              <div class="chart-style-section">
                <div class="chart-style-heading">
                  <strong>차트 스타일</strong>
                  <button class="chart-style-reset" type="button" title="스타일과 색을 처음 상태로" @click="resetChartStyle(selectedBlock)">초기화</button>
                </div>
                <div class="chart-style-gallery" role="radiogroup" aria-label="차트 스타일">
                  <button
                    v-for="preset in CHART_STYLE_PRESETS"
                    :key="preset.id"
                    type="button"
                    role="radio"
                    class="chart-style-preset"
                    :class="{ 'chart-style-preset-active': activeChartPreset(selectedBlock) === preset.id }"
                    :aria-checked="activeChartPreset(selectedBlock) === preset.id"
                    :title="preset.label"
                    @click="applyChartStylePreset(selectedBlock, preset.id)"
                  >
                    <svg viewBox="0 0 40 28" aria-hidden="true">
                      <rect x=".5" y=".5" width="39" height="27" rx="2" :fill="chartPresetPreview(selectedBlock, preset).background" :stroke="chartPresetPreview(selectedBlock, preset).border" />
                      <template v-if="chartPresetPreview(selectedBlock, preset).grid">
                        <path d="M5 8.5h30M5 14.5h30M5 20.5h30" :stroke="chartPresetPreview(selectedBlock, preset).grid" stroke-width=".8" />
                      </template>
                      <rect
                        v-for="(color, index) in chartPresetPreview(selectedBlock, preset).bars"
                        :key="index"
                        :x="8 + index * 9"
                        :y="[12, 6, 15][index]"
                        width="6"
                        :height="[12, 18, 9][index]"
                        :rx="chartPresetPreview(selectedBlock, preset).radius"
                        :fill="color"
                      />
                    </svg>
                    <span>{{ preset.label }}</span>
                  </button>
                </div>

                <span class="chart-style-label">색 구성</span>
                <div class="chart-palette-list" role="radiogroup" aria-label="차트 색 구성">
                  <button
                    v-for="palette in CHART_PALETTES"
                    :key="palette.id"
                    type="button"
                    role="radio"
                    class="chart-palette-option"
                    :class="{ 'chart-palette-option-active': (selectedBlock.chart.palette || 'office') === palette.id }"
                    :aria-checked="(selectedBlock.chart.palette || 'office') === palette.id"
                    :title="palette.label"
                    @click="selectedBlock.chart.palette = palette.id"
                  >
                    <span class="chart-palette-swatches" aria-hidden="true">
                      <i v-for="color in palette.colors.slice(0, 6)" :key="color" :style="{ background: color }"></i>
                    </span>
                    <span class="chart-palette-name">{{ palette.label }}</span>
                  </button>
                </div>

                <template v-if="chartColorTargets(selectedBlock).length">
                  <span class="chart-style-label">{{ CHART_ITEM_COLOR_CATEGORIES.has(selectedBlock.chart.category) ? "항목별 색" : "계열별 색" }}</span>
                  <div class="chart-series-colors">
                    <div v-for="(name, index) in chartColorTargets(selectedBlock)" :key="`${index}-${name}`" class="chart-series-color">
                      <input
                        type="color"
                        :value="chartTargetColor(selectedBlock, index)"
                        :aria-label="`${name || index + 1} 색`"
                        @input="setChartSeriesColor(selectedBlock, index, $event.target.value)"
                      />
                      <span :title="name">{{ name || `계열 ${index + 1}` }}</span>
                      <button
                        v-if="isChartColorCustom(selectedBlock, index)"
                        type="button"
                        class="chart-series-color-reset"
                        :aria-label="`${name} 색을 색 구성대로 되돌리기`"
                        title="색 구성대로"
                        @click="resetChartSeriesColor(selectedBlock, index)"
                      >↺</button>
                    </div>
                  </div>
                </template>

                <div class="chart-style-colors">
                  <label v-for="item in [
                    { key: 'backgroundColor', label: '배경', fallback: '#ffffff' },
                    { key: 'textColor', label: '글자', fallback: '#3b4252' },
                    { key: 'borderColor', label: '테두리', fallback: '#9aa3b5' },
                  ]" :key="item.key" class="chart-style-color">
                    <span>{{ item.label }}</span>
                    <input
                      type="color"
                      :value="chartStyleValue(selectedBlock, item.key) || item.fallback"
                      :aria-label="`차트 ${item.label} 색`"
                      @input="setChartStyle(selectedBlock, item.key, $event.target.value)"
                    />
                    <button
                      type="button"
                      class="chart-style-none"
                      :class="{ 'chart-style-none-active': !chartStyleValue(selectedBlock, item.key) }"
                      :title="`${item.label} 색 없음(기본)`"
                      @click="setChartStyle(selectedBlock, item.key, '')"
                    >기본</button>
                  </label>
                </div>

                <template v-if="CHART_AXIS_CATEGORIES.has(selectedBlock.chart.category) || selectedBlock.chart.category === 'radar'">
                  <div class="chart-style-inline">
                    <label class="binding-toggle">
                      <input
                        type="checkbox"
                        :checked="chartStyleValue(selectedBlock, 'gridLines', true) !== false"
                        @change="setChartStyle(selectedBlock, 'gridLines', $event.target.checked)"
                      />눈금선
                    </label>
                    <input
                      type="color"
                      :value="chartStyleValue(selectedBlock, 'gridColor') || '#e6e8ec'"
                      aria-label="눈금선 색"
                      title="눈금선 색"
                      @input="setChartStyle(selectedBlock, 'gridColor', $event.target.value)"
                    />
                  </div>
                </template>
                <template v-if="CHART_BAR_CATEGORIES.has(selectedBlock.chart.category)">
                  <label for="property-chart-radius" class="chart-style-label">막대 모서리 ({{ Number(chartStyleValue(selectedBlock, 'barRadius', 0)) }}px)</label>
                  <input
                    id="property-chart-radius"
                    type="range"
                    min="0"
                    max="16"
                    step="1"
                    :value="Number(chartStyleValue(selectedBlock, 'barRadius', 0))"
                    @input="setChartStyle(selectedBlock, 'barRadius', Number($event.target.value))"
                  />
                </template>
                <template v-if="CHART_LINE_CATEGORIES.has(selectedBlock.chart.category)">
                  <label for="property-chart-line" class="chart-style-label">선 두께 ({{ Number(chartStyleValue(selectedBlock, 'lineWidth', 2)) }}px)</label>
                  <input
                    id="property-chart-line"
                    type="range"
                    min="1"
                    max="6"
                    step="1"
                    :value="Number(chartStyleValue(selectedBlock, 'lineWidth', 2))"
                    @input="setChartStyle(selectedBlock, 'lineWidth', Number($event.target.value))"
                  />
                </template>
              </div>
            </template>
            <p v-else-if="selectedBlock.type === 'divider'" class="property-hint">구분선 요소입니다.</p>
          </section>
          <section class="property-group">
            <h3>배치</h3>
            <label for="property-layout-mode">배치 방식</label>
            <select id="property-layout-mode" :value="layoutModeValue(selectedBlock)" @change="setLayoutMode(selectedBlock, $event.target.value)">
              <option value="flow">영역 배치 (기본)</option>
              <option value="free:front">자유 배치 · 텍스트 앞</option>
              <option value="free:behind">자유 배치 · 텍스트 뒤</option>
            </select>
            <template v-if="!isFree(selectedBlock)">
              <label for="property-layout-width">너비 (%)</label>
              <div class="layout-width-row">
                <select :value="WIDTH_PRESETS.includes(getLayout(selectedBlock).width) ? getLayout(selectedBlock).width : 'custom'" aria-label="너비 비율" @change="$event.target.value !== 'custom' && applyLayoutUpdate({ blockId: selectedBlock.id, layout: { width: Number($event.target.value) } })">
                  <option v-for="width in WIDTH_PRESETS" :key="width" :value="width">{{ width === 100 ? "전체" : width === 66.67 ? "2/3" : width === 33.33 ? "1/3" : `${width}%` }}</option>
                  <option value="custom" disabled>직접 지정</option>
                </select>
                <input
                  id="property-layout-width"
                  type="number"
                  min="10"
                  max="100"
                  step="1"
                  :value="getLayout(selectedBlock).width"
                  @change="applyLayoutUpdate({ blockId: selectedBlock.id, layout: { width: clampWidth($event.target.value) } })"
                />
              </div>
              <p class="property-hint">이어지는 요소의 너비 합이 100% 이하면 한 줄에 나란히 놓입니다. 툴바의 ‘분할’로 한 번에 나눌 수 있습니다.</p>
            </template>
            <template v-else>
              <div class="shape-size-row">
                <label>X (px)<input type="number" step="1" :value="getLayout(selectedBlock).x" @change="applyLayoutUpdate({ blockId: selectedBlock.id, layout: { x: Number($event.target.value) || 0 } })" /></label>
                <label>Y (px)<input type="number" step="1" min="0" :value="getLayout(selectedBlock).y" @change="applyLayoutUpdate({ blockId: selectedBlock.id, layout: { y: Math.max(0, Number($event.target.value) || 0) } })" /></label>
              </div>
              <label for="property-layout-free-width">너비 (px)</label>
              <input id="property-layout-free-width" type="number" min="40" :max="pageDimensions.widthPt" step="1" :value="getLayout(selectedBlock).w" @change="applyLayoutUpdate({ blockId: selectedBlock.id, layout: { w: Math.min(pageDimensions.widthPt, Math.max(40, Number($event.target.value) || 240)) } })" />
              <div class="layout-order-row">
                <button class="binding-manage-button" type="button" @click="changeZOrder(selectedBlock, 1)"><ActionIcon name="up" />앞으로 가져오기</button>
                <button class="binding-manage-button" type="button" @click="changeZOrder(selectedBlock, -1)"><ActionIcon name="down" />뒤로 보내기</button>
              </div>
              <p class="property-hint">이동 핸들(⠿)을 끌거나 방향키(Shift: 10px)로 옮깁니다. 다른 요소와 겹쳐 놓을 수 있습니다.</p>
            </template>
            <template v-if="heightTarget(selectedBlock) === 'layout'">
              <label for="property-layout-height">높이 (px)</label>
              <div class="layout-width-row">
                <select
                  :value="getLayout(selectedBlock).h ? 'fixed' : 'auto'"
                  aria-label="높이 방식"
                  @change="applyLayoutUpdate({ blockId: selectedBlock.id, layout: { h: $event.target.value === 'auto' ? null : currentBlockHeight(selectedBlock) } })"
                >
                  <option value="auto">자동</option>
                  <option value="fixed">지정</option>
                </select>
                <input
                  id="property-layout-height"
                  type="number"
                  :min="MIN_BLOCK_HEIGHT"
                  :max="MAX_BLOCK_HEIGHT"
                  step="1"
                  :value="getLayout(selectedBlock).h ?? ''"
                  :placeholder="String(currentBlockHeight(selectedBlock) || '자동')"
                  @change="applyLayoutUpdate({ blockId: selectedBlock.id, layout: { h: clampHeight($event.target.value) } })"
                />
              </div>
              <p class="property-hint">아래쪽 핸들(또는 오른쪽 아래 모서리)을 끌어 높이를 바꿉니다. 내용보다 작게 줄일 수는 없으며, 핸들을 두 번 클릭하면 자동 높이로 돌아갑니다.</p>
            </template>
          </section>
          <div class="property-tip">
            <span aria-hidden="true">i</span>
            글꼴·크기·정렬은 캔버스 위 글꼴 도구에서 바꿀 수 있습니다.
          </div>
          </div>
          <div
            v-if="selectedBlock.type === 'table'"
            v-show="activePropertyTab === 'table'"
            id="property-panel-table"
            role="tabpanel"
            aria-labelledby="property-tab-table"
          >
            <section class="property-group">
              <div class="table-editor-heading">
                <h3>표 편집</h3>
                <span>
                  {{ selectedBlock.rows.length }}행 ·
                  {{ selectedBlock.columns.length }}열 ·
                  제목행 {{ selectedBlock.rows.filter((row) => row.isTitleRow).length }}개
                </span>
              </div>
              <h4 class="property-subheading">행·열</h4>
              <div class="table-editor-toolbar">
                <button type="button" @click="addTableRow(selectedBlock)"><ActionIcon name="add" />행</button>
                <button
                  type="button"
                  :disabled="selectedBlock.rows.length === 0"
                  @click="removeTableRow(selectedBlock)"
                ><ActionIcon name="remove" />행</button>
                <span></span>
                <button type="button" @click="addTableColumn(selectedBlock)"><ActionIcon name="add" />열</button>
                <button
                  type="button"
                  :disabled="selectedBlock.columns.length === 0"
                  @click="removeTableColumn(selectedBlock)"
                ><ActionIcon name="remove" />열</button>
              </div>
              <p v-if="selectedBlock.rows.length === 0" class="property-hint">
                행 추가를 눌러 표에 데이터를 입력하세요.
              </p>
            </section>
            <section v-if="selectedBlock.rows.length" class="property-group">
              <h3>제목행</h3>
              <div class="table-title-row-settings">
                <label
                  v-for="(row, rowIndex) in selectedBlock.rows"
                  :key="`title-row-${rowIndex}`"
                >
                  <input
                    type="checkbox"
                    :checked="row.isTitleRow === true"
                    @change="setTableTitleRow(selectedBlock, rowIndex, $event.target.checked)"
                  />
                  {{ rowIndex + 1 }}행
                </label>
                <p>제목행은 직접 편집되며 DB 데이터 행으로 반복되지 않습니다.</p>
              </div>
            </section>
            <section v-if="selectedBlock.columns.length" class="property-group">
              <h3>열 서식</h3>
              <div class="table-column-controls">
                <label for="property-selected-column">서식 적용 열</label>
                <select
                  id="property-selected-column"
                  v-model.number="selectedTableColumn"
                >
                  <option
                    v-for="(column, columnIndex) in selectedBlock.columns"
                    :key="`column-option-${columnIndex}`"
                    :value="columnIndex"
                  >열 {{ columnIndex + 1 }}</option>
                </select>
                <label for="property-column-shade">열 음영</label>
                <div class="shade-control">
                  <input
                    id="property-column-shade"
                    type="color"
                    :value="selectedBlock.columnStyles?.[selectedTableColumn]?.backgroundColor || '#ffffff'"
                    @input="setTableColumnShade(selectedBlock, $event.target.value)"
                  />
                  <button
                    type="button"
                    class="clear-shade-button"
                    @click="setTableColumnShade(selectedBlock, '')"
                  ><ActionIcon name="clear" />색상 지우기</button>
                </div>
              </div>
            </section>
            <section class="property-group">
              <h3>셀</h3>
              <p class="cell-selection-help">
                모든 칸은 같은 셀입니다. 캔버스에서 칸을 눌러 값을 입력하고, 여러 칸을 끌어 선택하면 음영·셀 합치기·병합 해제를 할 수 있습니다.
              </p>
            </section>
          </div>
          <div
            v-if="supportsDataBinding(selectedBlock)"
            v-show="activePropertyTab === 'data'"
            id="property-panel-data"
            role="tabpanel"
            aria-labelledby="property-tab-data"
          >
          <section v-if="selectedBlock.type === 'chart'" class="property-group">
            <h3>차트 데이터</h3>
            <p class="binding-status" :class="{ 'binding-status-error': datasourceMissing(selectedBlock.dataBinding?.enabled ? selectedBlock.dataBinding.datasourceId : '') }">
              {{ chartDataSummary(selectedBlock) }}
            </p>
            <button class="binding-run-button" type="button" @click="openChartData(selectedBlock)">
              <ActionIcon name="edit" />데이터 편집·매핑
            </button>
            <p class="property-hint">값을 직접 입력하거나 DB 쿼리 결과의 필드를 항목·계열에 연결합니다. DB 쿼리를 쓰면 자동 생성 때 최신 값으로 그립니다.</p>
          </section>
          <section
            v-if="!['divider', 'image', 'shape', 'chart'].includes(selectedBlock.type)"
            class="property-group binding-property-group"
          >
            <h3>데이터 바인딩</h3>
            <label class="binding-toggle">
              <input
                type="checkbox"
                :checked="selectedBlock.dataBinding?.enabled ?? false"
                @change="toggleDataBinding(selectedBlock, $event.target.checked)"
              />
              DB 데이터 사용
            </label>
            <template v-if="selectedBlock.dataBinding?.enabled">
              <p
                class="binding-status"
                :class="{ 'binding-status-error': !databaseConfigured || bindingMessage.startsWith('데이터를 불러오지 못했습니다') || datasourceMissing(selectedBlock.dataBinding.datasourceId) }"
              >
                {{ datasourceMissing(selectedBlock.dataBinding.datasourceId)
                  ? "연결된 데이터소스를 찾을 수 없습니다. 다른 데이터소스를 선택하세요."
                  : bindingMessage || (databaseConfigured ? `${datasourceLabel(selectedBlock.dataBinding.datasourceId)} 사용` : "DB 연결 설정이 필요합니다.") }}
              </p>
              <label for="property-binding-datasource">데이터소스</label>
              <div class="binding-datasource-row">
                <select
                  id="property-binding-datasource"
                  :value="selectedBlock.dataBinding.datasourceId || ''"
                  @change="selectedBlock.dataBinding.datasourceId = $event.target.value; bindingMessage = ''"
                >
                  <option value="">리포트 DB (기본)</option>
                  <option
                    v-for="datasource in datasources"
                    :key="datasource.id"
                    :value="datasource.id"
                    :disabled="!datasource.enabled"
                  >{{ datasource.name }} · {{ getDatasourceType(datasource.type)?.label }}{{ datasource.enabled ? "" : " (미사용)" }}</option>
                  <option
                    v-if="datasourceMissing(selectedBlock.dataBinding.datasourceId)"
                    :value="selectedBlock.dataBinding.datasourceId"
                  >(찾을 수 없음)</option>
                </select>
                <button
                  v-if="props.authUser.role === 'ADMIN'"
                  class="binding-manage-button"
                  type="button"
                  title="접속정보 관리"
                  @click="openReportSettings"
                ><ActionIcon name="settings" />관리</button>
              </div>
              <label for="property-binding-query">읽기 전용 SELECT 쿼리</label>
              <textarea
                id="property-binding-query"
                v-model="selectedBlock.dataBinding.query"
                rows="5"
                placeholder="SELECT title, amount FROM report_data WHERE report_date = ?"
              ></textarea>
              <label for="property-binding-parameters">파라미터 (JSON 배열)</label>
              <input
                id="property-binding-parameters"
                v-model="selectedBlock.dataBinding.parametersText"
                placeholder='["{{reportDate}}"]'
              />
              <p class="property-hint">
                예약 실행 때 사용할 날짜 토큰: &#123;&#123;reportDate&#125;&#125; (실행일),
                &#123;&#123;previousDate&#125;&#125; (전날),
                &#123;&#123;periodStart&#125;&#125;~&#123;&#123;periodEnd&#125;&#125; (주기 시작/종료일)
              </p>
              <button
                class="binding-run-button"
                type="button"
                :disabled="bindingBusy || !databaseConfigured"
                @click="runDataBindingQuery(selectedBlock)"
              ><ActionIcon name="run" />{{ bindingBusy ? "쿼리 실행 중..." : "쿼리 실행 및 필드 불러오기" }}</button>
              <label
                v-for="field in getBindingFields(selectedBlock)"
                :key="`binding-field-${field.key}`"
              >
                {{ field.label }}에 연결할 필드
                <select v-model="selectedBlock.dataBinding.mappings.fields[field.key]">
                  <option value="">직접 입력한 값 사용</option>
                  <option
                    v-for="column in selectedBlock.dataBinding.columns"
                    :key="`field-${field.key}-${column}`"
                    :value="column"
                  >{{ column }}</option>
                </select>
              </label>
              <template v-if="selectedBlock.type === 'table'">
                <h4 class="property-subheading">필드 목록</h4>
                <div v-if="selectedBlock.dataBinding.columns?.length" class="binding-field-list">
                  <span
                    v-for="fieldName in selectedBlock.dataBinding.columns"
                    :key="`drag-field-${fieldName}`"
                    class="binding-field-chip"
                    draggable="true"
                    :title="`‘${fieldName}’을 표의 셀로 끌어다 놓으세요`"
                    @dragstart="startFieldDrag(fieldName, $event)"
                  >⠿ {{ fieldName }}</span>
                </div>
                <p v-else class="property-hint">쿼리를 실행하면 필드 목록이 나타납니다.</p>
                <p class="property-hint">
                  필드를 캔버스의 표 셀로 끌어다 놓으면 그 셀에 조회 결과 값이 들어갑니다(셀의 × 로 해제).
                  필드를 넣은 행 오른쪽의 <b>⟳ 반복</b> 버튼을 누르면 그 행을 조회 결과 행 수만큼 아래로 늘립니다(표에서 한 행만).
                  반복하지 않는 행의 필드는 조회 결과 첫 행 값으로 채웁니다.
                  <template v-if="cellFieldCount(selectedBlock)"> 현재 {{ cellFieldCount(selectedBlock) }}개 셀에 필드가 들어가 있습니다.</template>
                </p>
                <div v-if="usesLegacyColumnMapping(selectedBlock)" class="binding-legacy-note">
                  <p>이 표는 예전 방식(열마다 필드 연결)을 쓰고 있습니다. 필드를 셀에 끌어다 놓으면 새 방식으로 바뀝니다.</p>
                  <button class="binding-manage-button" type="button" @click="convertLegacyColumnMapping(selectedBlock)">지금 새 방식으로 바꾸기</button>
                </div>
                <label class="binding-toggle">
                  <input
                    type="checkbox"
                    :checked="Boolean(selectedBlock.dataBinding.repeatTable)"
                    @change="setRepeatTable(selectedBlock, $event.target.checked)"
                  />
                  표 반복 (조회 결과 한 행마다 표 하나)
                </label>
                <p v-if="selectedBlock.dataBinding.repeatTable" class="property-hint">
                  조회 결과 행마다 이 표를 하나씩 아래로 이어서 만들고, 표 안의 필드 셀을 그 행의 값으로 채웁니다. 표 반복 중에는 행 반복을 쓰지 않습니다.
                  표 제목·단위는 첫 표에, 요약은 마지막 표에 표시됩니다(표 제목을 필드에 연결하면 표마다 그 행의 값).
                  에디터에서는 표 하나만 보이고, 뷰어·인쇄·내보내기에서 반복됩니다.
                </p>
              </template>
            </template>
            <p v-else class="property-hint">
              직접 입력한 내용은 그대로 유지됩니다. 연결할 경우 선택한 항목만 DB 값으로 표시됩니다.
            </p>
          </section>
          <section
            v-if="selectedBlock.type === 'table'"
            class="property-group binding-property-group"
          >
            <h3>요약 데이터 바인딩</h3>
            <label class="binding-toggle">
              <input
                type="checkbox"
                :checked="selectedBlock.summaryBinding?.enabled ?? false"
                @change="toggleSummaryBinding(selectedBlock, $event.target.checked)"
              />
              요약을 별도 쿼리로 채우기
            </label>
            <template v-if="selectedBlock.summaryBinding?.enabled">
              <p
                class="binding-status"
                :class="{ 'binding-status-error': summaryBindingMessage.startsWith('데이터를 불러오지 못했습니다') || datasourceMissing(selectedBlock.summaryBinding.datasourceId) }"
              >
                {{ datasourceMissing(selectedBlock.summaryBinding.datasourceId)
                  ? "연결된 데이터소스를 찾을 수 없습니다. 다른 데이터소스를 선택하세요."
                  : summaryBindingMessage || `${datasourceLabel(selectedBlock.summaryBinding.datasourceId)} 사용 · 표와 다른 쿼리` }}
              </p>
              <label for="property-summary-datasource">데이터소스</label>
              <div class="binding-datasource-row">
                <select
                  id="property-summary-datasource"
                  :value="selectedBlock.summaryBinding.datasourceId || ''"
                  @change="selectedBlock.summaryBinding.datasourceId = $event.target.value; summaryBindingMessage = ''"
                >
                  <option value="">리포트 DB (기본)</option>
                  <option
                    v-for="datasource in datasources"
                    :key="datasource.id"
                    :value="datasource.id"
                    :disabled="!datasource.enabled"
                  >{{ datasource.name }} · {{ getDatasourceType(datasource.type)?.label }}{{ datasource.enabled ? "" : " (미사용)" }}</option>
                  <option
                    v-if="datasourceMissing(selectedBlock.summaryBinding.datasourceId)"
                    :value="selectedBlock.summaryBinding.datasourceId"
                  >(찾을 수 없음)</option>
                </select>
                <button
                  v-if="props.authUser.role === 'ADMIN'"
                  class="binding-manage-button"
                  type="button"
                  title="접속정보 관리"
                  @click="openReportSettings"
                ><ActionIcon name="settings" />관리</button>
              </div>
              <label for="property-summary-query">요약용 SELECT 쿼리</label>
              <textarea
                id="property-summary-query"
                v-model="selectedBlock.summaryBinding.query"
                rows="4"
                placeholder="SELECT SUM(status = 'WAIT') AS wait_cnt, SUM(status = 'DONE') AS done_cnt FROM incidents WHERE created_at BETWEEN ? AND ?"
              ></textarea>
              <label for="property-summary-parameters">파라미터 (JSON 배열)</label>
              <input
                id="property-summary-parameters"
                v-model="selectedBlock.summaryBinding.parametersText"
                placeholder='["{{periodStart}}", "{{periodEnd}}"]'
              />
              <button
                class="binding-run-button"
                type="button"
                :disabled="summaryBindingBusy || !databaseConfigured"
                @click="runDataBindingQuery(selectedBlock, 'summary')"
              ><ActionIcon name="run" />{{ summaryBindingBusy ? "쿼리 실행 중..." : "요약 쿼리 실행 및 필드 불러오기" }}</button>
              <label for="property-summary-template">요약 문구</label>
              <textarea
                id="property-summary-template"
                ref="summaryTemplateInput"
                v-model="selectedBlock.summaryBinding.template"
                rows="3"
                placeholder="(1) 회신 대기: {wait_cnt}건"
              ></textarea>
              <div v-if="selectedBlock.summaryBinding.columns?.length" class="summary-field-chips" aria-label="요약 문구에 넣을 필드">
                <button
                  v-for="column in selectedBlock.summaryBinding.columns"
                  :key="`summary-field-${column}`"
                  type="button"
                  :title="`요약 문구에 {${column}} 넣기`"
                  @click="insertSummaryField(selectedBlock, column)"
                ><ActionIcon name="add" />{{ column }}</button>
              </div>
              <p class="property-hint">
                {필드명} 자리에 요약 쿼리 결과 첫 행의 값이 들어갑니다. 필드를 누르면 커서 위치에 넣습니다.
              </p>
              <template v-if="summaryPreview(selectedBlock)">
                <label>미리보기</label>
                <p class="summary-preview">{{ summaryPreview(selectedBlock) }}</p>
              </template>
            </template>
            <p v-else class="property-hint">
              켜면 표 아래 요약을 표 쿼리와 다른 쿼리·데이터소스의 결과로 채웁니다.
            </p>
          </section>
          </div>
        </div>
        <div v-else class="empty-properties">
          <span class="empty-properties-icon">▤</span>
          <p>요소를 선택하면<br />속성을 편집할 수 있습니다.</p>
        </div>
      </aside>
    </main>
    <div
      v-if="isTemplateManagerOpen"
      class="modal-backdrop"
    >
      <section
        class="editor-modal tm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-modal-title"
      >
        <header class="tm-header popup-titlebar">
          <div>
            <p class="portal-eyebrow">REPORT TEMPLATES</p>
            <div class="popup-title-line">
              <h2 id="template-modal-title">보고서 양식 관리</h2>
              <p>양식을 찾아 열고, 복제·이름 변경·자동 생성 일정을 한 곳에서 관리합니다.</p>
            </div>
          </div>
          <button
            class="modal-close-button"
            type="button"
            aria-label="닫기"
            @click="closeTemplateManager"
          >×</button>
        </header>

        <div class="tm-body">
          <aside class="tm-sidebar" aria-label="양식 목록">
            <div class="tm-sidebar-top">
              <div class="tm-search">
                <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
                <input
                  ref="templateSearchInput"
                  v-model="templateSearch"
                  type="search"
                  placeholder="양식 이름 검색"
                  aria-label="양식 검색"
                  @keydown="handleTemplateSearchKeydown"
                />
              </div>
            </div>
            <p v-if="catalogError" class="tm-banner tm-banner-error tm-sidebar-banner" role="alert">{{ catalogError }}</p>
            <div
              class="tm-list"
              role="listbox"
              aria-label="보고서 양식"
              @keydown="handleTemplateListKeydown"
            >
              <section v-for="group in filteredTemplateGroups" :key="group.name" class="tm-group">
                <button
                  v-if="group.name"
                  class="tm-group-heading"
                  type="button"
                  :aria-expanded="isTemplateGroupOpen(group.name)"
                  @click="toggleTemplateGroup(group.name)"
                >
                  <span class="tm-chevron" :class="{ 'tm-chevron-open': isTemplateGroupOpen(group.name) }" aria-hidden="true">›</span>
                  <strong>{{ group.name }}</strong>
                  <small>{{ group.templates.length }}</small>
                </button>
                <div v-if="!group.name || isTemplateGroupOpen(group.name)" class="tm-group-items">
                  <button
                    v-for="template in group.templates"
                    :key="template.id"
                    :data-template-id="template.id"
                    type="button"
                    role="option"
                    class="tm-item"
                    :class="{ 'tm-item-selected': managerMode === 'detail' && pendingReportType === template.id }"
                    :aria-selected="pendingReportType === template.id"
                    :tabindex="pendingReportType === template.id ? 0 : -1"
                    :title="`${template.label} — 더블클릭하면 엽니다`"
                    @click="selectManagerTemplate(template.id)"
                    @dblclick="requestOpenTemplate(template.id)"
                  >
                    <span class="tm-report-icon" aria-hidden="true">
                      <img src="/report-template-icon.png?v=2" alt="" draggable="false" />
                      <i :class="`tm-report-icon-tag tm-type-${template.layoutType}`">{{ templateInitial(template) }}</i>
                    </span>
                    <span class="tm-item-text">
                      <strong>{{ template.label }}</strong>
                      <small>
                        <i class="tm-dot" :class="{ 'tm-dot-on': isScheduleEnabled(template.id) }" aria-hidden="true"></i>
                        {{ describeSchedule(template.id) }}
                      </small>
                    </span>
                    <span v-if="template.id === reportType" class="tm-badge tm-badge-current">편집 중</span>
                  </button>
                </div>
              </section>
              <div v-if="!allTemplateCount" class="tm-empty">
                <strong>양식이 없습니다</strong>
                <span>아래 [새 양식 만들기] 버튼으로 양식을 만들어 주세요.</span>
              </div>
              <div v-else-if="!filteredTemplateGroups.length" class="tm-empty">
                <strong>일치하는 양식이 없습니다</strong>
                <span>다른 검색어를 입력해 보세요.</span>
                <button
                  class="tm-link-button"
                  type="button"
                  @click="templateSearch = ''"
                ><ActionIcon name="reset" />검색 초기화</button>
              </div>
            </div>
            <footer class="tm-sidebar-footer">
              <span>전체 {{ allTemplateCount }}개 양식</span>
              <button
                class="tm-create-button"
                :class="{ 'tm-create-button-active': managerMode === 'create' }"
                type="button"
                @click="startCreateTemplate()"
              ><ActionIcon name="create" />새 양식 만들기</button>
            </footer>
          </aside>

          <section class="tm-detail">
            <form
              v-if="managerMode === 'create'"
              class="tm-detail-scroll"
              @submit.prevent="saveNewTemplate"
            >
              <div class="tm-detail-head">
                <span class="tm-type-icon tm-type-icon-lg tm-type-new" aria-hidden="true"><ActionIcon name="create" /></span>
                <div class="tm-detail-title">
                  <h3>새 양식 만들기</h3>
                  <p>시작할 내용을 고르고 양식 이름과 그룹을 정하세요.</p>
                </div>
              </div>
              <p v-if="templateError" class="tm-banner tm-banner-info" role="status">{{ templateError }}</p>

              <fieldset class="tm-fieldset">
                <legend class="tm-section-label">시작 방식</legend>
                <div class="tm-source-cards">
                  <label
                    class="tm-source-card"
                    :class="{ 'tm-source-card-selected': newTemplateDraft.source === 'current' }"
                  >
                    <input v-model="newTemplateDraft.source" type="radio" value="current" />
                    <strong>현재 편집 내용으로</strong>
                    <span>{{ reportLabel }} · {{ pages.length }}페이지 · 요소 {{ currentBlockCount }}개를 그대로 저장하고 바로 편집을 이어갑니다.</span>
                  </label>
                  <label
                    class="tm-source-card"
                    :class="{ 'tm-source-card-selected': newTemplateDraft.source === 'blank' }"
                  >
                    <input v-model="newTemplateDraft.source" type="radio" value="blank" />
                    <strong>빈 양식</strong>
                    <span>제목·작성일·구분선만 있는 양식을 만듭니다. 지금 편집 중인 내용은 그대로 유지됩니다.</span>
                  </label>
                </div>
              </fieldset>

              <div class="tm-form-grid">
                <label class="tm-field">
                  <span>양식 이름 <em aria-hidden="true">*</em></span>
                  <input
                    id="new-template-label"
                    v-model="newTemplateDraft.label"
                    maxlength="120"
                    required
                    placeholder="예: 주간 보안관제 보고"
                    :aria-invalid="newTemplateDuplicate"
                  />
                  <small v-if="newTemplateDuplicate" class="tm-field-error">같은 그룹에 이미 같은 이름의 양식이 있습니다.</small>
                  <small v-else class="tm-field-hint">{{ newTemplateDraft.label.length }}/120</small>
                </label>
                <label class="tm-field">
                  <span>그룹 <em aria-hidden="true">*</em></span>
                  <input
                    v-model="newTemplateDraft.group"
                    list="template-group-options"
                    maxlength="120"
                    required
                  />
                  <small class="tm-field-hint">기존 그룹을 고르거나 새 이름을 입력하세요.</small>
                </label>
              </div>

              <div class="tm-field">
                <span>보고서 유형</span>
                <div class="tm-segmented" role="radiogroup" aria-label="보고서 유형">
                  <button
                    v-for="(label, value) in layoutTypeLabels"
                    :key="value"
                    type="button"
                    role="radio"
                    :aria-checked="newTemplateDraft.layoutType === value"
                    :class="{ 'tm-segmented-active': newTemplateDraft.layoutType === value }"
                    @click="newTemplateDraft.layoutType = value"
                  ><ActionIcon :name="value === 'daily' ? 'day' : value === 'weekly' ? 'week' : 'month'" />{{ label }}</button>
                </div>
              </div>

              <fieldset class="tm-fieldset tm-access-fieldset">
                <legend class="tm-section-label">생성 결과 열람 권한</legend>
                <p class="tm-field-hint">
                  선택한 그룹 구성원 또는 개별 사용자는 결과를 볼 수 있습니다. 둘 다 지정하면 어느 한쪽에 해당해도 허용됩니다.
                  선택하지 않으면 모든 사용자가 열람할 수 있습니다.
                </p>
                <p v-if="templateAccessError" class="tm-banner tm-banner-error" role="alert">{{ templateAccessError }}</p>
                <p v-else-if="!templateAccessLoaded" role="status">결과 열람 권한 목록을 불러오고 있습니다.</p>
                <div class="tm-access-options">
                  <section>
                    <strong>그룹</strong>
                    <label v-for="group in templateAccessOptions.groups" :key="group.id">
                      <input v-model="newTemplateDraft.access.groups" type="checkbox" :value="group.id" />
                      {{ group.name }}
                    </label>
                    <small v-if="templateAccessLoaded && !templateAccessOptions.groups.length">등록된 그룹이 없습니다.</small>
                  </section>
                  <section>
                    <strong>사용자</strong>
                    <label v-for="user in templateAccessOptions.users" :key="user.id">
                      <input v-model="newTemplateDraft.access.users" type="checkbox" :value="user.id" />
                      {{ user.name }} ({{ user.userId }})
                    </label>
                    <small v-if="templateAccessLoaded && !templateAccessOptions.users.length">등록된 사용자가 없습니다.</small>
                  </section>
                </div>
              </fieldset>

              <label class="tm-switch-row">
                <input v-model="newTemplateDraft.scheduleEnabled" class="tm-switch-input" type="checkbox" />
                <span class="tm-switch" aria-hidden="true"></span>
                <span class="tm-switch-text">
                  <strong>자동 생성 사용</strong>
                  <small>{{ newTemplateScheduleText }}(한국시간)에 보고서를 자동으로 만듭니다. 만든 뒤 일정 탭에서 바꿀 수 있습니다.</small>
                </span>
              </label>

              <div class="tm-inline-actions tm-detail-actions">
                <button class="modal-secondary-button" type="button" @click="cancelCreateTemplate"><ActionIcon name="cancel" />취소</button>
                <button
                  class="tm-primary"
                  type="submit"
                  :disabled="templateSaveBusy || !templateAccessLoaded || !newTemplateDraft.label.trim() || !newTemplateDraft.group.trim() || newTemplateDuplicate"
                ><ActionIcon name="create" />{{ templateSaveBusy ? "만드는 중..." : "양식 만들기" }}</button>
              </div>
            </form>

            <div v-else-if="managerTemplate" class="tm-detail-scroll">
              <div class="tm-detail-head">
                <span class="tm-report-icon tm-report-icon-lg" aria-hidden="true">
                  <img src="/report-template-icon.png?v=2" alt="" draggable="false" />
                  <i :class="`tm-report-icon-tag tm-type-${managerTemplate.layoutType}`">{{ templateInitial(managerTemplate) }}</i>
                </span>
                <div class="tm-detail-title">
                  <h3>{{ managerTemplate.label }}</h3>
                  <div class="tm-badges">
                    <span class="tm-badge">{{ layoutTypeLabels[managerTemplate.layoutType] ?? "일간" }} 보고서</span>
                    <span v-if="pendingReportType === reportType" class="tm-badge tm-badge-current">편집 중</span>
                    <span
                      v-if="pendingReportType === reportType && hasUnsavedEditorChanges"
                      class="tm-badge tm-badge-warn"
                    >저장하지 않은 변경</span>
                  </div>
                </div>
                <div class="tm-detail-tools">
                  <button
                    class="tm-tool"
                    type="button"
                    :disabled="managerBusy"
                    title="이 양식을 복사해 새 사용자 양식을 만듭니다"
                    @click="duplicateManagerTemplate"
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M13 4.5V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h.5" /></svg>
                    복제
                  </button>
                  <template v-if="managerTemplateIsCustom">
                    <button
                      class="tm-tool"
                      type="button"
                      :disabled="managerBusy"
                      @click="startRenameTemplate"
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 16h3l8.5-8.5a2.1 2.1 0 0 0-3-3L4 13z" /></svg>
                      이름 변경
                    </button>
                    <button
                      class="tm-tool tm-tool-danger"
                      type="button"
                      :disabled="managerBusy"
                      @click="requestDeleteTemplate"
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6" /></svg>
                      삭제
                    </button>
                  </template>
                </div>
              </div>

              <div
                v-if="managerConfirm?.kind === 'delete'"
                class="tm-confirm tm-confirm-danger"
                role="alertdialog"
                aria-labelledby="tm-delete-title"
              >
                <strong id="tm-delete-title">'{{ managerTemplate.label }}' 양식을 삭제할까요?</strong>
                <p>
                  자동 생성 일정도 함께 삭제되며 되돌릴 수 없습니다. 이미 생성된 보고서는 뷰어에 그대로 남습니다.
                  <template v-if="managerConfirm.templateId === reportType">
                    지금 편집 중인 양식이므로 삭제 후 편집기는 일일업무보고로 전환됩니다.
                  </template>
                </p>
                <div class="tm-inline-actions">
                  <button class="modal-secondary-button" type="button" @click="managerConfirm = null"><ActionIcon name="cancel" />취소</button>
                  <button
                    class="tm-danger"
                    type="button"
                    :disabled="managerBusy"
                    @click="confirmDeleteTemplate"
                  ><ActionIcon name="delete" />{{ managerBusy ? "삭제 중..." : "삭제" }}</button>
                </div>
              </div>
              <p v-if="templateError" class="tm-banner tm-banner-error" role="alert">{{ templateError }}</p>

              <div class="tm-tabs" role="tablist" aria-label="양식 상세">
                <button
                  type="button"
                  role="tab"
                  :aria-selected="managerTab === 'info'"
                  :class="{ 'tm-tab-active': managerTab === 'info' }"
                  @click="managerTab = 'info'"
                ><ActionIcon name="details" />정보</button>
                <button
                  type="button"
                  role="tab"
                  :aria-selected="managerTab === 'schedule'"
                  :class="{ 'tm-tab-active': managerTab === 'schedule' }"
                  @click="managerTab = 'schedule'"
                >
                  <ActionIcon name="schedule" />
                  자동 생성 일정
                  <i class="tm-dot" :class="{ 'tm-dot-on': isScheduleEnabled(pendingReportType) }" aria-hidden="true"></i>
                </button>
                <button
                  type="button"
                  role="tab"
                  :aria-selected="managerTab === 'access'"
                  :class="{ 'tm-tab-active': managerTab === 'access' }"
                  @click="managerTab = 'access'"
                ><ActionIcon name="lock" />결과 권한</button>
                <button
                  type="button"
                  role="tab"
                  :aria-selected="managerTab === 'mail'"
                  :class="{ 'tm-tab-active': managerTab === 'mail' }"
                  @click="managerTab = 'mail'"
                ><ActionIcon name="mail" />메일 전송</button>
              </div>

              <TemplateMailSettings v-if="managerTab === 'mail' && managerTemplateIsCustom"
                :key="pendingReportType" :template-id="pendingReportType"
                :template-label="managerTemplate?.label || ''"
                :users="templateAccessOptions.users" :users-loaded="templateAccessLoaded" />
              <div v-else-if="managerTab === 'mail'" class="tm-panel">
                <p class="tm-banner tm-banner-info">양식을 저장한 뒤 메일 전송을 설정할 수 있습니다.</p>
              </div>
              <div v-if="managerTab === 'info'" class="tm-panel" role="tabpanel">
                <form v-if="renameDraft" class="tm-rename" @submit.prevent="saveRenameTemplate">
                  <div class="tm-form-grid">
                    <label class="tm-field">
                      <span>양식 이름</span>
                      <input
                        id="rename-template-label"
                        v-model="renameDraft.label"
                        maxlength="120"
                        required
                        :aria-invalid="renameDuplicate"
                      />
                    </label>
                    <label class="tm-field">
                      <span>그룹</span>
                      <input
                        v-model="renameDraft.group"
                        list="template-group-options"
                        maxlength="120"
                        required
                      />
                    </label>
                  </div>
                  <small v-if="renameDuplicate" class="tm-field-error">같은 그룹에 이미 같은 이름의 양식이 있습니다.</small>
                  <div class="tm-inline-actions">
                    <button class="modal-secondary-button" type="button" @click="renameDraft = null"><ActionIcon name="cancel" />취소</button>
                    <button
                      class="tm-primary"
                      type="submit"
                      :disabled="managerBusy || !renameDraft.label.trim() || !renameDraft.group.trim() || renameDuplicate"
                    ><ActionIcon name="save" />{{ managerBusy ? "저장 중..." : "변경 저장" }}</button>
                  </div>
                </form>

                <dl v-if="managerTemplateStats" class="tm-info-grid">
                  <div><dt>그룹</dt><dd>{{ templateGroupLabel(managerTemplate.group) }}</dd></div>
                  <div><dt>보고서 유형</dt><dd>{{ layoutTypeLabels[managerTemplate.layoutType] ?? "일간" }} 보고서</dd></div>
                  <div><dt>구성</dt><dd>{{ managerTemplateStats.pageCount }}페이지 · 요소 {{ managerTemplateStats.blockCount }}개</dd></div>
                  <div>
                    <dt>데이터 연결</dt>
                    <dd>{{ managerTemplateStats.bindingCount ? `DB 연결 요소 ${managerTemplateStats.bindingCount}개` : "없음" }}</dd>
                  </div>
                  <div><dt>자동 생성</dt><dd>{{ describeSchedule(pendingReportType) }}</dd></div>
                  <div v-if="managerTemplateIsCustom"><dt>최근 수정</dt><dd>{{ formatDateTime(managerTemplate.updatedAt) }}</dd></div>
                </dl>

                <div v-if="managerTemplateStats?.composition.length" class="tm-composition">
                  <span class="tm-section-label">요소 구성</span>
                  <div class="tm-composition-list">
                    <div v-for="item in managerTemplateStats.composition" :key="item.type" class="tm-composition-item">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <template v-if="item.type === 'title'">
                          <path d="M5 5h14v14H5zM8 9h8M8 12h8" />
                        </template>
                        <template v-else-if="item.type === 'text'">
                          <path d="M5 6h14M5 10h14M5 14h10M5 18h12" />
                        </template>
                        <template v-else-if="item.type === 'section'">
                          <path d="M5 6.5h2v2H5zM9 7.5h10M5 12h2v2H5zM9 13h10M5 17.5h2v2H5zM9 18.5h10" />
                        </template>
                        <template v-else-if="item.type === 'table'">
                          <path d="M4.5 5.5h15v13h-15zM4.5 10h15M10 5.5v13M15 5.5v13" />
                        </template>
                        <template v-else-if="item.type === 'special'">
                          <path d="m12 4 9 16H3zM12 9v5M12 17.2v.1" />
                        </template>
                        <template v-else-if="item.type === 'subheading'">
                          <path d="M5 6h14M5 10h8M7 15h12M7 18h9" />
                        </template>
                        <template v-else-if="item.type === 'period'">
                          <circle cx="12" cy="12" r="8" />
                          <path d="M12 7v5l3 2" />
                        </template>
                        <template v-else-if="item.type === 'date'">
                          <path d="M5 6h14v14H5zM8 4v4M16 4v4M5 10h14M8 13h2M13 13h2M8 16h2" />
                        </template>
                        <template v-else>
                          <path d="M5 12h14" />
                        </template>
                      </svg>
                      <span>{{ item.label }}</span>
                      <b>{{ item.count }}</b>
                    </div>
                  </div>
                </div>
                <p v-if="pendingReportType === reportType" class="tm-note">
                  편집 중인 양식은 아직 저장하지 않은 편집 내용까지 반영해 표시합니다.
                </p>
              </div>

              <div v-else-if="managerTab === 'schedule'" class="tm-panel" role="tabpanel">
                <template v-if="managerTemplateIsCustom && scheduleDraft">
                  <label class="tm-switch-row">
                    <input v-model="scheduleDraft.enabled" class="tm-switch-input" type="checkbox" />
                    <span class="tm-switch" aria-hidden="true"></span>
                    <span class="tm-switch-text">
                      <strong>예약 시간에 보고서 자동 생성</strong>
                      <small>지정한 시각(한국시간)에 보고서를 만들어 뷰어에 저장합니다.</small>
                    </span>
                  </label>

                  <fieldset class="tm-schedule-fields" :disabled="!scheduleDraft.enabled">
                    <div class="tm-field">
                      <span>주기</span>
                      <div class="tm-segmented" role="radiogroup" aria-label="생성 주기">
                        <button
                          v-for="option in [
                            { value: 'daily', label: '매일', icon: 'day' },
                            { value: 'weekly', label: '매주', icon: 'week' },
                            { value: 'monthly', label: '매월', icon: 'month' },
                          ]"
                          :key="option.value"
                          type="button"
                          role="radio"
                          :aria-checked="scheduleDraft.frequency === option.value"
                          :class="{ 'tm-segmented-active': scheduleDraft.frequency === option.value }"
                          @click="scheduleDraft.frequency = option.value"
                        ><ActionIcon :name="option.icon" />{{ option.label }}</button>
                      </div>
                    </div>
                    <div v-if="scheduleDraft.frequency === 'weekly'" class="tm-field">
                      <span>요일</span>
                      <div class="tm-weekdays" role="radiogroup" aria-label="생성 요일">
                        <button
                          v-for="day in [1, 2, 3, 4, 5, 6, 0]"
                          :key="day"
                          type="button"
                          role="radio"
                          :aria-checked="Number(scheduleDraft.weekday) === day"
                          :class="{
                            'tm-weekday-active': Number(scheduleDraft.weekday) === day,
                            'tm-weekday-weekend': day === 0 || day === 6,
                          }"
                          @click="scheduleDraft.weekday = day"
                        >{{ weekdayLabels[day] }}</button>
                      </div>
                    </div>
                    <div class="tm-form-grid">
                      <label v-if="scheduleDraft.frequency === 'monthly'" class="tm-field">
                        <span>날짜</span>
                        <select v-model.number="scheduleDraft.dayOfMonth">
                          <option v-for="day in 31" :key="day" :value="day">매월 {{ day }}일</option>
                        </select>
                        <small v-if="scheduleDraft.dayOfMonth > 28" class="tm-field-hint">해당 날짜가 없는 달에는 말일에 생성합니다.</small>
                      </label>
                      <label class="tm-field">
                        <span>실행 시각 (한국시간)</span>
                        <input v-model="scheduleDraft.time" type="time" required />
                      </label>
                    </div>
                  </fieldset>

                  <div class="tm-next-run" :class="{ 'tm-next-run-off': !nextScheduleRun }">
                    <span class="tm-section-label">다음 생성 예정</span>
                    <strong>{{ nextScheduleRun ? formatNextRun(nextScheduleRun) : "자동 생성이 꺼져 있습니다" }}</strong>
                    <small>서버가 켜져 있을 때만 생성되며, 꺼져 있는 동안 놓친 일정은 다음 예약 시각까지 기다립니다.</small>
                  </div>
                  <p v-if="scheduleError" class="tm-banner tm-banner-error" role="alert">{{ scheduleError }}</p>
                  <div class="tm-inline-actions">
                    <span v-if="scheduleDirty" class="tm-dirty">저장하지 않은 변경사항</span>
                    <button
                      class="modal-secondary-button"
                      type="button"
                      :disabled="!scheduleDirty || scheduleBusy"
                      @click="loadPendingSchedule"
                    ><ActionIcon name="reset" />되돌리기</button>
                    <button
                      class="tm-primary"
                      type="button"
                      :disabled="!scheduleDirty || scheduleBusy"
                      @click="persistSchedule"
                    ><ActionIcon name="save" />{{ scheduleBusy ? "저장 중..." : "일정 저장" }}</button>
                  </div>
                </template>
              </div>

              <div v-else-if="managerTab === 'access'" class="tm-panel tm-access-panel" role="tabpanel">
                <template v-if="managerTemplateIsCustom">
                  <div class="tm-access-explainer">
                    <strong>보고서 생성 결과를 열람할 대상을 선택하세요.</strong>
                    <span>선택한 그룹의 구성원 또는 선택한 사용자가 열람할 수 있습니다. 둘 다 지정하면 대상이 합쳐집니다.</span>
                    <span>대상을 선택하지 않으면 모든 사용자가 열람할 수 있습니다.</span>
                  </div>
                  <p v-if="templateAccessError" class="tm-banner tm-banner-error" role="alert">{{ templateAccessError }}</p>
                  <p v-else-if="!templateAccessLoaded" role="status">결과 열람 권한 목록을 불러오고 있습니다.</p>
                  <div class="tm-access-options">
                    <section>
                      <strong>그룹별 권한</strong>
                      <label v-for="group in templateAccessOptions.groups" :key="group.id">
                        <input v-model="templateAccessDraft.groups" type="checkbox" :value="group.id" />
                        {{ group.name }}
                      </label>
                      <small v-if="templateAccessLoaded && !templateAccessOptions.groups.length">등록된 그룹이 없습니다. 리포트 설정에서 그룹을 추가하세요.</small>
                    </section>
                    <section>
                      <strong>사용자별 권한</strong>
                      <label v-for="user in templateAccessOptions.users" :key="user.id">
                        <input v-model="templateAccessDraft.users" type="checkbox" :value="user.id" />
                        {{ user.name }} ({{ user.userId }})
                      </label>
                      <small v-if="templateAccessLoaded && !templateAccessOptions.users.length">등록된 사용자가 없습니다. 리포트 설정에서 사용자를 추가하세요.</small>
                    </section>
                  </div>
                  <div class="tm-inline-actions tm-access-actions">
                    <button class="tm-primary" type="button" :disabled="managerBusy || !templateAccessLoaded" @click="persistTemplateAccess">
                      <ActionIcon name="save" />{{ managerBusy ? "저장 중..." : "결과 권한 저장" }}
                    </button>
                  </div>
                </template>
              </div>
            </div>

            <div v-else class="tm-empty tm-empty-panel">
              <strong>양식을 선택하세요</strong>
              <span>왼쪽 목록에서 양식을 고르면 상세 정보가 표시됩니다.</span>
            </div>
          </section>
        </div>

        <datalist id="template-group-options">
          <option v-for="name in customTemplateGroupNames" :key="name" :value="name" />
        </datalist>

        <footer class="tm-footer">
          <div
            v-if="managerConfirm?.kind === 'discard'"
            class="tm-confirm tm-confirm-warn tm-footer-confirm"
            role="alertdialog"
            aria-labelledby="tm-discard-title"
          >
            <p>
              <strong id="tm-discard-title">저장하지 않은 변경사항이 있습니다.</strong>
              다른 양식을 열면 '{{ reportLabel }}'의 편집 내용이 사라집니다.
            </p>
            <div class="tm-inline-actions">
              <button class="modal-secondary-button" type="button" @click="managerConfirm = null"><ActionIcon name="edit" />계속 편집</button>
              <button
                class="tm-danger"
                type="button"
                @click="openTemplateInEditor(managerConfirm.templateId)"
              ><ActionIcon name="open" />저장하지 않고 열기</button>
            </div>
          </div>
          <template v-else>
            <span class="tm-footer-hint">
              <kbd>↑</kbd><kbd>↓</kbd> 이동 · <kbd>Enter</kbd> 열기 · <kbd>Esc</kbd> 닫기
            </span>
            <div class="tm-inline-actions">
              <button class="modal-secondary-button" type="button" @click="closeTemplateManager"><ActionIcon name="cancel" />닫기</button>
              <button
                class="tm-primary"
                type="button"
                :disabled="managerMode === 'create' || !managerTemplate || managerBusy"
                @click="requestOpenTemplate()"
              ><ActionIcon :name="pendingReportType === reportType ? 'edit' : 'open'" />{{ pendingReportType === reportType ? "편집 계속하기" : "이 양식 열기" }}</button>
            </div>
          </template>
        </footer>

        <div
          v-if="managerNotice"
          class="tm-toast"
          :class="`tm-toast-${managerNotice.type}`"
          role="status"
        >{{ managerNotice.text }}</div>
      </section>
    </div>
    <TemplateTransferDialog v-if="isTransferOpen" @close="isTransferOpen = false" @import="appendImportedPages" />
    <AssistantPanel :open="isAssistantOpen" :context="assistantContext" :auth-user="props.authUser" @close="isAssistantOpen = false" />
    <Teleport to="body">
      <div
        v-if="shapeMenu"
        ref="shapeMenuPanel"
        class="shape-menu"
        role="menu"
        aria-label="도형"
        :style="{ top: `${shapeMenu.top}px`, left: `${shapeMenu.left}px` }"
      >
        <section v-for="group in SHAPE_GROUPS" :key="group.label" class="shape-menu-group">
          <h4>{{ group.label }}</h4>
          <div class="shape-menu-grid">
            <button
              v-for="shape in group.shapes"
              :key="shape.id"
              type="button"
              role="menuitem"
              :title="shape.label"
              :aria-label="shape.label"
              @click="insertShape(shape.id)"
            >
              <!-- eslint-disable-next-line vue/no-v-html -- 고정된 도형 목록으로 만든 SVG -->
              <span v-html="shapePreviewMarkup(shape.id)"></span>
            </button>
          </div>
        </section>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="ribbonMenu"
        ref="ribbonMenuPanel"
        class="ribbon-menu"
        role="menu"
        :style="{ top: `${ribbonMenu.top}px`, left: `${ribbonMenu.left}px` }"
      >
        <template v-if="ribbonMenu.name === 'split'">
          <p class="ribbon-menu-title">선택한 요소부터 나란히 배치</p>
          <button v-for="preset in SPLIT_PRESETS" :key="preset.id" type="button" role="menuitem" class="ribbon-menu-item" @click="splitSelected(preset.id)">
            <span class="split-preview" aria-hidden="true">
              <i v-for="(width, index) in preset.widths" :key="index" :style="{ flexBasis: `${width}%` }"></i>
            </span>
            {{ preset.label }}
          </button>
          <p class="ribbon-menu-hint">요소의 오른쪽 가장자리를 끌어 너비를 직접 바꿀 수도 있습니다.</p>
        </template>
        <template v-else-if="ribbonMenu.name === 'header' || ribbonMenu.name === 'footer'">
          <p class="ribbon-menu-title">기본 제공</p>
          <button
            v-for="item in ribbonMenu.name === 'header' ? HEADER_GALLERY : FOOTER_GALLERY"
            :key="item.id"
            type="button"
            role="menuitem"
            class="ribbon-menu-item ribbon-menu-gallery"
            @click="useHeaderFooterGallery(ribbonMenu.name, item.id)"
          >
            <span class="hf-gallery-preview" aria-hidden="true"><i>{{ item.slots.left }}</i><i>{{ item.slots.center }}</i><i>{{ item.slots.right }}</i></span>
            {{ item.label }}
          </button>
          <div class="ribbon-menu-separator"></div>
          <button type="button" role="menuitem" class="ribbon-menu-item" @click="openHeaderFooterDialog(ribbonMenu.name)">
            <ActionIcon name="edit" />{{ ribbonMenu.name === "header" ? "머리글 편집" : "바닥글 편집" }}
          </button>
          <button type="button" role="menuitem" class="ribbon-menu-item" @click="removeHeaderFooterArea(ribbonMenu.name)">
            <ActionIcon name="delete" />{{ ribbonMenu.name === "header" ? "머리글 제거" : "바닥글 제거" }}
          </button>
        </template>
        <template v-else-if="ribbonMenu.name === 'page-number'">
          <p class="ribbon-menu-title">페이지 위쪽</p>
          <div class="ribbon-menu-row">
            <button v-for="align in ['left', 'center', 'right']" :key="`top-${align}`" type="button" role="menuitem" class="page-number-option" @click="addPageNumber('top', align)">
              <span class="page-number-preview" :class="`page-number-${align}`" aria-hidden="true"><b>1</b></span>
              {{ align === "left" ? "왼쪽" : align === "center" ? "가운데" : "오른쪽" }}
            </button>
          </div>
          <p class="ribbon-menu-title">페이지 아래쪽</p>
          <div class="ribbon-menu-row">
            <button v-for="align in ['left', 'center', 'right']" :key="`bottom-${align}`" type="button" role="menuitem" class="page-number-option" @click="addPageNumber('bottom', align)">
              <span class="page-number-preview page-number-bottom" :class="`page-number-${align}`" aria-hidden="true"><b>1</b></span>
              {{ align === "left" ? "왼쪽" : align === "center" ? "가운데" : "오른쪽" }}
            </button>
          </div>
          <div class="ribbon-menu-separator"></div>
          <button type="button" role="menuitem" class="ribbon-menu-item" @click="openHeaderFooterDialog('options')">
            <ActionIcon name="settings" />페이지 번호 서식...
          </button>
          <button type="button" role="menuitem" class="ribbon-menu-item" :disabled="!hasPageNumber(headerFooter)" @click="deletePageNumbers">
            <ActionIcon name="delete" />페이지 번호 제거
          </button>
        </template>
        <template v-else-if="ribbonMenu.name === 'orientation'">
          <p class="ribbon-menu-title">용지 방향</p>
          <button
            v-for="option in [{ id: 'portrait', label: '세로' }, { id: 'landscape', label: '가로' }]"
            :key="option.id"
            type="button"
            role="menuitemradio"
            class="ribbon-menu-item paper-menu-item"
            :class="{ 'paper-menu-item-active': (pageDimensions.landscape ? 'landscape' : 'portrait') === option.id }"
            :aria-checked="(pageDimensions.landscape ? 'landscape' : 'portrait') === option.id"
            @click="chooseOrientation(option.id)"
          >
            <span class="paper-orientation-preview" :class="`paper-orientation-${option.id}`" aria-hidden="true"><i></i></span>
            {{ option.label }}
          </button>
        </template>
        <template v-else-if="ribbonMenu.name === 'paper-size'">
          <p class="ribbon-menu-title">용지 크기</p>
          <div class="paper-menu-list">
            <button
              v-for="paper in PAPER_SIZES"
              :key="paper.id"
              type="button"
              role="menuitemradio"
              class="ribbon-menu-item paper-menu-item"
              :class="{ 'paper-menu-item-active': normalizePageSetup(pageSetup).size === paper.id }"
              :aria-checked="normalizePageSetup(pageSetup).size === paper.id"
              @click="choosePaperSize(paper.id)"
            >
              <span class="paper-size-icon" aria-hidden="true"></span>
              <span class="paper-menu-copy">
                <strong>{{ paper.label }}</strong>
                <small>{{ paperDimensionText(paper) }}</small>
              </span>
            </button>
          </div>
          <div class="ribbon-menu-separator"></div>
          <form class="paper-custom-form" @submit.prevent="applyCustomPaper">
            <p class="ribbon-menu-title">기타 용지 크기 (mm)</p>
            <div class="paper-custom-row">
              <label>너비<input v-model.number="customPaperDraft.widthMm" type="number" :min="CUSTOM_SIZE_LIMITS.minMm" :max="CUSTOM_SIZE_LIMITS.maxMm" step="0.1" required /></label>
              <span aria-hidden="true">×</span>
              <label>높이<input v-model.number="customPaperDraft.heightMm" type="number" :min="CUSTOM_SIZE_LIMITS.minMm" :max="CUSTOM_SIZE_LIMITS.maxMm" step="0.1" required /></label>
            </div>
            <button type="submit" class="paper-custom-apply">사용자 지정 크기 적용</button>
            <p class="ribbon-menu-hint">{{ CUSTOM_SIZE_LIMITS.minMm }}~{{ CUSTOM_SIZE_LIMITS.maxMm }}mm. 너비가 높이보다 크면 가로 방향이 됩니다. 현재: {{ pageSetupText }}</p>
          </form>
        </template>
      </div>
    </Teleport>
    <HeaderFooterDialog
      v-if="headerFooterDialog"
      :config="headerFooter"
      :initial-tab="headerFooterDialog.tab"
      :title="reportLabel"
      @apply="applyHeaderFooter"
      @close="headerFooterDialog = null"
    />
    <ChartInsertDialog
      v-if="chartDialog"
      :current="chartDialog.mode === 'change' ? chartDialog.current : null"
      @confirm="handleChartDialogConfirm"
      @close="chartDialog = null"
    />
    <ChartDataDialog
      v-if="chartDataBlock"
      :block="chartDataBlock"
      :datasources="datasources"
      :can-manage-datasources="props.authUser.role === 'ADMIN'"
      :database-configured="databaseConfigured"
      :run-query="runChartQuery"
      @apply="applyChartData"
      @close="chartDataBlockId = ''"
      @manage-datasources="openReportSettings"
    />
    <ReportSettings
      v-if="isReportSettingsOpen"
      :auth-user="props.authUser"
      @close="isReportSettingsOpen = false"
      @changed="datasources = $event"
    />
    <div
      v-if="isPreviewOpen"
      class="modal-backdrop preview-backdrop"
    >
      <section
        class="editor-modal preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-modal-title"
      >
        <header class="editor-modal-header preview-modal-header popup-titlebar">
          <div>
            <p class="portal-eyebrow">LIVE PREVIEW</p>
            <div class="popup-title-line">
              <h2 id="preview-modal-title">{{ reportLabel }} 미리보기</h2>
              <p>현재 편집 내용을 저장하지 않고 미리 봅니다.</p>
            </div>
          </div>
          <button
            class="modal-close-button"
            type="button"
            aria-label="미리보기 닫기"
            @click="isPreviewOpen = false"
          >×</button>
        </header>
        <div class="preview-canvas">
          <ReportCanvas
            v-for="(page, pageIndex) in pages"
            :key="page.id"
            :report-type="activeLayoutType"
            :date="date"
            :blocks="pageIndex === currentPageIndex ? blocks : page.blocks"
            :header-footer="headerFooter"
            :page-setup="pageSetup"
            :page-index="pageIndex"
            :page-count="pages.length"
            :report-title="reportLabel"
            :aria-label="`미리보기 페이지 ${pageIndex + 1}`"
          />
        </div>
      </section>
    </div>
  </div>
</template>
