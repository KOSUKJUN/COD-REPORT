<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import ChartDataDialog from "./components/ChartDataDialog.vue";
import FontToolbar from "./components/FontToolbar.vue";
import ReportCanvas from "./components/ReportCanvas.vue";
import ToolNav from "./components/ToolNav.vue";
import { ensureTableColumns, useTextFormatting } from "./composables/useTextFormatting.js";
import { materializeReport } from "./data-binding.js";
import { downloadBlob } from "./report-export/download.js";
import { exportFileName } from "./report-export/document-model.js";
import {
  generateReportNow,
  getTemplates,
  getReport,
  getReportInstance,
  getSavedReports,
  normalizeTableBlock,
  updateReportInstance,
} from "./reports-api.js";
import { getKoreaDateTimeInput, getScheduleClock } from "./report-scheduler.js";
import { printWithPageSetup } from "./page-setup.js";

const props = defineProps({
  authUser: { type: Object, required: true },
});
const emit = defineEmits(["logout", "help", "select-tool"]);

const report = ref(null);
const reports = ref([]);
// 목록에서 고른 항목(selected)과 화면에 표시 중인 리포트(displayed)를 구분한다.
// 목록에서 항목을 고르면 바로 그 리포트를 불러와 표시한다.
const selectedReportKey = ref("");
const displayedReportKey = ref("");
// 저장(덮어쓰기)할 대상 리포트 id
const displayedReportId = ref(null);
const loadingContent = ref(false);
// 목록을 빠르게 연달아 눌렀을 때 늦게 도착한 이전 응답이 화면을 덮지 않게 한다.
let reportLoadToken = 0;
const selectedTemplateType = ref("");
const templatePickerSelection = ref("");
const templateCatalog = ref([]);
const loading = ref(true);
const errorMessage = ref("");
const generationNotice = ref("");
const isTemplatePickerOpen = ref(false);
const isSample = ref(false);
const pageViewMode = ref("single");
const currentPageIndex = ref(0);
const isGenerationFormOpen = ref(false);
const generating = ref(false);
const generationError = ref("");
const generationTitle = ref("");
const generationStart = ref(`${getScheduleClock().date}T00:00`);
const generationEnd = ref(getKoreaDateTimeInput());
const reportLabel = computed(() =>
  report.value
    ? report.value.reportTitle ||
      report.value.templateName ||
      templateCatalog.value.find((template) => template.id === report.value.type)?.label ||
      "보고서"
    : templateCatalog.value.find((template) => template.id === selectedTemplateType.value)?.label ||
      "보고서 양식"
);
const selectedTemplateLabel = computed(() =>
  templateCatalog.value.find((template) => template.id === selectedTemplateType.value)?.label ||
  report.value?.templateName ||
  "양식 선택"
);
const reportOriginLabel = computed(() =>
  isSample.value
    ? "샘플 JSON"
    : report.value?.generationRange
      ? "즉시 생성"
      : "저장된 보고서",
);
// ---------- 리포트 값 수정 ----------
// 수정을 시작하면 화면 값(DB 바인딩 결과 포함)을 일반 값으로 고정한 사본(editDraft)을 고친다.
// 저장하면 같은 리포트에 덮어쓰고, 취소하면 사본을 버린다. 요소·행 추가/삭제/이동은 할 수 없다.
const isEditing = ref(false);
const editDraft = ref(null);
const editSnapshot = ref("");
const editSaving = ref(false);
const editError = ref("");
const pendingLeave = ref(null); // 저장하지 않은 수정이 있을 때 확인할 다음 동작
function canLeave() {
  if (editSaving.value) {
    window.alert("리포트 저장이 완료된 후 이동해 주세요.");
    return false;
  }
  return !isEditing.value || window.confirm("편집 중인 내용이 있습니다. 이동하면 저장하지 않은 수정 내용이 사라질 수 있습니다. 이동하시겠습니까?");
}
defineExpose({ canLeave });
const editSelectedId = ref("");
const editSelectedCells = ref([]);
let cellAnchor = null;
let cellDragging = false;

const activeReport = computed(() => (isEditing.value ? editDraft.value : report.value));
const activeLayoutType = computed(
  () => activeReport.value?.layoutType || activeReport.value?.type || "daily",
);
const canEditReport = computed(
  () => Boolean(report.value) &&
    Boolean(displayedReportId.value) &&
    !isSample.value &&
    ["ADMIN", "EDITOR"].includes(props.authUser.role),
);

function draftPages(draft) {
  return draft?.pages?.length ? draft.pages : [{ blocks: draft?.blocks ?? [] }];
}

function serializeDraft(draft) {
  return JSON.stringify(draftPages(draft).map((page) => page.blocks));
}

const isEditDirty = computed(
  () => isEditing.value && Boolean(editDraft.value) && serializeDraft(editDraft.value) !== editSnapshot.value,
);

function findDraftBlock(id) {
  if (!id || !editDraft.value) return null;
  for (const page of draftPages(editDraft.value)) {
    const block = page.blocks.find((item) => item.id === id);
    if (block) return block;
  }
  return null;
}

const editSelectedBlock = computed(() => findDraftBlock(editSelectedId.value));

// 차트 값 수정: 뷰어에서는 직접 입력 데이터만 고친다(DB 연결은 에디터에서).
const chartEditBlockId = ref("");
const chartEditBlock = computed(() => findDraftBlock(chartEditBlockId.value));

function openChartEdit(blockId) {
  chartEditBlockId.value = blockId;
}

function applyChartEdit(payload) {
  const block = chartEditBlock.value;
  chartEditBlockId.value = "";
  if (block) block.chartData = payload.chartData;
}

const {
  fontStyleState,
  fontFormatTarget,
  fontTargetLabel,
  handleFontShortcut,
  toolbarHandlers,
} = useTextFormatting({
  selectedBlock: editSelectedBlock,
  selectedCells: editSelectedCells,
  layoutType: activeLayoutType,
});

const reportPages = computed(() => (activeReport.value ? draftPages(activeReport.value) : []));
const visiblePages = computed(() => {
  const pageCount = pageViewMode.value === "double" ? 2 : 1;
  return reportPages.value.slice(currentPageIndex.value, currentPageIndex.value + pageCount);
});
const templateOptions = computed(() => templateCatalog.value);
const groupedTemplateOptions = computed(() => {
  const groups = new Map();
  for (const template of templateOptions.value) {
    if (!groups.has(template.group)) groups.set(template.group, []);
    groups.get(template.group).push(template);
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }));
});
const selectedTemplateReports = computed(() =>
  reports.value.filter((item) => item.type === selectedTemplateType.value),
);
const selectedReportItem = computed(() =>
  selectedTemplateReports.value.find(
    (item) => getReportKey(item) === selectedReportKey.value,
  ) ?? null,
);
const hasSelectedReport = computed(() => Boolean(selectedReportItem.value));

// ---------- 리포트 목록 페이징 ----------
// 한 번에 보여줄 개수는 브라우저에 기억해 둔다.
const LIST_PAGE_SIZES = [10, 20, 50, 100];
const LIST_PAGE_SIZE_KEY = "cod-report.viewer.listPageSize";
function readListPageSize() {
  try {
    const saved = Number(localStorage.getItem(LIST_PAGE_SIZE_KEY));
    return LIST_PAGE_SIZES.includes(saved) ? saved : 10;
  } catch {
    return 10;
  }
}
const listPageSize = ref(readListPageSize());
const listPage = ref(0);
const listPageCount = computed(() =>
  Math.max(1, Math.ceil(selectedTemplateReports.value.length / listPageSize.value)),
);
const pagedReports = computed(() =>
  selectedTemplateReports.value.slice(
    listPage.value * listPageSize.value,
    (listPage.value + 1) * listPageSize.value,
  ),
);
const listRangeText = computed(() => {
  const total = selectedTemplateReports.value.length;
  if (!total) return "0건";
  const start = listPage.value * listPageSize.value + 1;
  const end = Math.min(total, start + listPageSize.value - 1);
  return `${start}–${end} / ${total}건`;
});

function changeListPageSize(size) {
  listPageSize.value = size;
  try {
    localStorage.setItem(LIST_PAGE_SIZE_KEY, String(size));
  } catch {
    // 저장할 수 없어도 이번 화면에서는 적용한다.
  }
  showSelectedInList();
}

function goListPage(page) {
  listPage.value = Math.min(listPageCount.value - 1, Math.max(0, page));
}

// 고른 리포트가 있는 페이지로 목록을 옮긴다(없으면 범위 안으로만 맞춘다).
function showSelectedInList() {
  const index = selectedTemplateReports.value.findIndex(
    (item) => getReportKey(item) === selectedReportKey.value,
  );
  goListPage(index >= 0 ? Math.floor(index / listPageSize.value) : listPage.value);
}

watch([selectedTemplateType, selectedReportKey], showSelectedInList);
watch(() => selectedTemplateReports.value.length, () => goListPage(listPage.value));

// 표시 중인 리포트가 없을 때 고른 양식의 내용을 '샘플' 워터마크와 함께 미리 보여준다.
const sampleTemplate = computed(() => {
  if (report.value || loading.value || loadingContent.value) return null;
  const template = templateCatalog.value.find((item) => item.id === selectedTemplateType.value);
  if (!template) return null;
  const pages = draftPages(template)
    .filter((page) => page.blocks?.length)
    .map((page) => ({
      ...page,
      blocks: page.blocks.map((block) => (block.type === "table" ? normalizeTableBlock(block) : block)),
    }));
  return pages.length ? { ...template, pages } : null;
});
const sampleDate = getScheduleClock().date;

function getReportKey(item) {
  return item.id ? `id:${item.id}` : `${item.type}:${item.date}`;
}

function reportOptionLabel(item) {
  if (item.reportTitle) {
    return item.reportTitle;
  }
  if (item.rangeStart && item.rangeEnd) {
    return `${item.date} · ${item.rangeStart.slice(0, 16)}–${item.rangeEnd.slice(0, 16)}`;
  }
  return item.date;
}

function reportDateLabel(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${date}T00:00:00`));
}

function openTemplatePicker() {
  templatePickerSelection.value = selectedTemplateType.value;
  isTemplatePickerOpen.value = true;
}

// 양식을 바꾸면 그 양식으로 만든 가장 최근 리포트를 보여주고, 없으면 양식 샘플과 생성 안내를 보여준다.
// 수정 중이면 먼저 확인한다.
function applySelectedTemplate() {
  const nextType = templatePickerSelection.value;
  isTemplatePickerOpen.value = false;
  if (nextType === selectedTemplateType.value) return;
  if (isEditing.value) {
    if (isEditDirty.value) {
      pendingLeave.value = { kind: "template", templateId: nextType };
      return;
    }
    finishEditing();
  }
  switchTemplate(nextType);
}

function switchTemplate(type) {
  selectedTemplateType.value = type;
  // 목록은 최신순이므로 첫 항목이 가장 최근 리포트다.
  const latest = reports.value.find((item) => item.type === type);
  if (latest) {
    selectedReportKey.value = getReportKey(latest);
    loadSelectedReport();
    return;
  }
  reportLoadToken += 1;
  loadingContent.value = false;
  errorMessage.value = "";
  selectedReportKey.value = "";
  report.value = null;
  displayedReportKey.value = "";
  displayedReportId.value = null;
  currentPageIndex.value = 0;
}

// 목록에서 고르면 바로 그 리포트를 표시한다. 수정 중이면 먼저 확인한다.
function selectReport(item) {
  const key = getReportKey(item);
  if (isEditing.value) {
    if (key === displayedReportKey.value) return;
    if (isEditDirty.value) {
      pendingLeave.value = { kind: "report", item };
      return;
    }
    finishEditing();
  }
  selectedReportKey.value = key;
  if (key === displayedReportKey.value && report.value) return;
  loadSelectedReport();
}

async function loadSelectedReport() {
  const selected = selectedReportItem.value;
  if (!selected) {
    return;
  }

  const token = ++reportLoadToken;
  loadingContent.value = true;
  errorMessage.value = "";
  generationNotice.value = "";
  try {
    const loaded = selected.id
      ? await getReportInstance(selected.id)
      : await getReport(selected.type, selected.date);
    if (token !== reportLoadToken) return;
    if (!loaded) {
      throw new Error("선택한 보고서가 목록에서 삭제되었습니다. 목록을 새로고침해 주세요.");
    }
    report.value = loaded;
    displayedReportKey.value = getReportKey(selected);
    displayedReportId.value = selected.id ?? null;
    isSample.value = false;
    currentPageIndex.value = 0;
  } catch (error) {
    if (token !== reportLoadToken) return;
    // 불러오기에 실패해도 기존에 보던 리포트는 유지한다.
    errorMessage.value = `보고서를 불러오지 못했습니다: ${error.message}`;
  } finally {
    if (token === reportLoadToken) loadingContent.value = false;
  }
}

// ---------- 리포트 값 수정 동작 ----------

function startEditing() {
  if (!canEditReport.value || isEditing.value) return;
  editDraft.value = materializeReport(report.value);
  editSnapshot.value = serializeDraft(editDraft.value);
  editError.value = "";
  editSelectedId.value = "";
  editSelectedCells.value = [];
  pendingLeave.value = null;
  isEditing.value = true;
  isExportMenuOpen.value = false;
}

function finishEditing() {
  chartEditBlockId.value = "";
  isEditing.value = false;
  editDraft.value = null;
  editSnapshot.value = "";
  editError.value = "";
  editSelectedId.value = "";
  editSelectedCells.value = [];
  pendingLeave.value = null;
  cellAnchor = null;
  cellDragging = false;
}

function cancelEditing() {
  if (isEditDirty.value) {
    pendingLeave.value = { kind: "cancel" };
    return;
  }
  finishEditing();
}

// 입력 중인 칸(날짜 입력 등 change 시점에 반영되는 칸)의 값을 먼저 반영한다.
async function flushActiveInput() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest(".viewer-report-scroll")) {
    active.blur();
    await nextTick();
  }
}

async function saveEdits() {
  if (!isEditing.value || editSaving.value) return false;
  await flushActiveInput();
  if (!isEditDirty.value) {
    finishEditing();
    showExportToast("변경한 내용이 없어 수정을 마쳤습니다.");
    return true;
  }
  editSaving.value = true;
  editError.value = "";
  try {
    const draft = JSON.parse(JSON.stringify(editDraft.value));
    // 첫 페이지 요소는 blocks 에도 함께 저장한다(예전 형식 호환).
    if (draft.pages?.length) draft.blocks = draft.pages[0].blocks;
    const saved = await updateReportInstance(displayedReportId.value, draft);
    report.value = saved;
    finishEditing();
    showExportToast("수정한 내용을 리포트에 저장했습니다.");
    return true;
  } catch (error) {
    editError.value = `저장하지 못했습니다: ${error.message}`;
    return false;
  } finally {
    editSaving.value = false;
  }
}

// 저장하지 않은 수정이 있을 때 나가기 확인 결과 처리
async function resolvePendingLeave(action) {
  const pending = pendingLeave.value;
  if (!pending) return;
  if (action === "stay") {
    pendingLeave.value = null;
    return;
  }
  if (action === "save") {
    const saved = await saveEdits();
    if (!saved) {
      pendingLeave.value = null;
      return;
    }
  } else {
    finishEditing();
  }
  pendingLeave.value = null;
  if (pending.kind === "report") selectReport(pending.item);
  else if (pending.kind === "template") switchTemplate(pending.templateId);
}

function selectEditBlock(id) {
  if (editSelectedId.value === id) return;
  editSelectedId.value = id;
  const block = findDraftBlock(id);
  if (block?.type === "table" && block.rows?.length && block.columns?.length) {
    editSelectedCells.value = [{ row: 0, column: 0 }];
    cellAnchor = { row: 0, column: 0 };
  } else {
    editSelectedCells.value = [];
    cellAnchor = null;
  }
}

function handleFieldInput({ blockId, field, value, index }) {
  const block = findDraftBlock(blockId);
  if (!block) return;
  if (field === "definitions") {
    if (Array.isArray(block.definitions) && index >= 0 && index < block.definitions.length) {
      block.definitions[index] = value;
    }
    return;
  }
  // 값만 바꿀 수 있도록 허용한 필드만 받는다.
  if (["content", "heading", "unit", "summary", "start", "end", "date"].includes(field)) {
    block[field] = value;
  }
}

function handleCellInput({ blockId, row, column, value }) {
  const block = findDraftBlock(blockId);
  if (block?.type !== "table" || !block.rows?.[row]) return;
  ensureTableColumns(block);
  block.rows[row].cells[column] = value;
}

function selectCellRange(start, end) {
  const cells = [];
  for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
    for (let column = Math.min(start.column, end.column); column <= Math.max(start.column, end.column); column += 1) {
      cells.push({ row, column });
    }
  }
  editSelectedCells.value = cells;
}

// 셀 선택: 클릭(한 칸), 드래그·Shift+클릭(범위), Ctrl+클릭(추가/해제)
function handleCellPointerDown({ blockId, row, column, event }) {
  if (editSelectedId.value !== blockId) {
    editSelectedId.value = blockId;
    cellAnchor = null;
  }
  if (event.button !== 0) return;
  const cell = { row, column };
  if (event.shiftKey && cellAnchor) {
    selectCellRange(cellAnchor, cell);
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    const exists = editSelectedCells.value.some((item) => item.row === row && item.column === column);
    editSelectedCells.value = exists
      ? editSelectedCells.value.filter((item) => item.row !== row || item.column !== column)
      : [...editSelectedCells.value, cell];
    cellAnchor = cell;
    return;
  }
  cellAnchor = cell;
  editSelectedCells.value = [cell];
  cellDragging = true;
}

// 키보드(Enter)로 셀을 옮겼을 때: 그 셀 하나만 선택한다.
function handleCellSelect({ blockId, row, column }) {
  editSelectedId.value = blockId;
  cellAnchor = { row, column };
  editSelectedCells.value = [{ row, column }];
  cellDragging = false;
}

function handleCellPointerEnter({ row, column }) {
  if (cellDragging && cellAnchor) selectCellRange(cellAnchor, { row, column });
}

function endCellDrag() {
  cellDragging = false;
}

function handleEditKeydown(event) {
  if (!isEditing.value) return;
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveEdits();
    return;
  }
  if (pendingLeave.value) {
    if (event.key === "Escape") resolvePendingLeave("stay");
    return;
  }
  if (chartEditBlockId.value) return;
  if (handleFontShortcut(event)) event.preventDefault();
}

function handleBeforeUnload(event) {
  if (isEditDirty.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}

async function generateReport() {
  if (!selectedTemplateType.value || generating.value) {
    return;
  }
  generating.value = true;
  generationError.value = "";
  generationNotice.value = "";
  try {
    const generated = await generateReportNow({
      type: selectedTemplateType.value,
      start: generationStart.value,
      end: generationEnd.value,
      title: generationTitle.value.trim(),
    });
    reportLoadToken += 1;
    report.value = generated;
    selectedReportKey.value = getReportKey(generated);
    displayedReportKey.value = getReportKey(generated);
    displayedReportId.value = generated.id ?? null;
    isSample.value = false;
    currentPageIndex.value = 0;
    try {
      reports.value = await getSavedReports();
      isGenerationFormOpen.value = false;
    } catch (error) {
      generationNotice.value = `보고서는 생성했지만 목록을 새로고침하지 못했습니다: ${error.message}`;
      isGenerationFormOpen.value = false;
    }
  } catch (error) {
    generationError.value = `새 보고서를 생성하지 못했습니다: ${error.message}`;
  } finally {
    generating.value = false;
  }
}

// 처음 들어오면 가장 최근에 저장된 리포트(목록은 최신순)의 양식을 고르고 내용까지 바로 표시한다.
// 에디터의 '뷰어' 버튼이 남긴 양식 id 를 한 번만 꺼내 쓴다.
const VIEWER_OPEN_TEMPLATE_KEY = "cod-report.viewer.openTemplate";

function takeEditorTemplateId() {
  try {
    const id = sessionStorage.getItem(VIEWER_OPEN_TEMPLATE_KEY) ?? "";
    sessionStorage.removeItem(VIEWER_OPEN_TEMPLATE_KEY);
    return id;
  } catch {
    return "";
  }
}

async function loadInitialReport() {
  await refreshReportList({ initial: true });
  if (selectedReportItem.value) {
    await loadSelectedReport();
  }
}

// 목록 새로고침: 목록과 양식만 다시 불러오고 고른 항목·표시 중인 리포트는 유지한다.
async function refreshReportList({ initial = false } = {}) {
  loading.value = true;
  errorMessage.value = "";
  generationNotice.value = "";

  try {
    const [savedReports, catalog] = await Promise.all([getSavedReports(), getTemplates()]);
    reports.value = savedReports;
    templateCatalog.value = catalog;

    if (initial || !selectedTemplateType.value) {
      // 에디터에서 넘어왔으면 편집하던 양식을, 아니면 가장 최근 리포트의 양식을 고른다.
      // 삭제된 양식이면 목록의 첫 양식을 고른다.
      const catalogIds = new Set(catalog.map((template) => template.id));
      const fromEditor = initial ? takeEditorTemplateId() : "";
      selectedTemplateType.value = (catalogIds.has(fromEditor) && fromEditor)
        || savedReports.find((item) => catalogIds.has(item.type))?.type
        || catalog[0]?.id
        || "";
    }
    const stillListed = selectedTemplateReports.value.some(
      (item) => getReportKey(item) === selectedReportKey.value,
    );
    if (initial || !stillListed) {
      const latest = selectedTemplateReports.value[0];
      selectedReportKey.value = latest ? getReportKey(latest) : "";
    }
  } catch (error) {
    errorMessage.value = `보고서 목록을 불러오지 못했습니다: ${error.message}`;
  } finally {
    loading.value = false;
  }
}

function openGenerationForm() {
  if (!selectedTemplateType.value) return;
  const now = getKoreaDateTimeInput();
  generationStart.value = `${now.slice(0, 10)}T00:00`;
  generationEnd.value = now;
  generationTitle.value = "";
  generationError.value = "";
  generationNotice.value = "";
  isGenerationFormOpen.value = true;
}

function changePageView(mode) {
  pageViewMode.value = mode;
  if (mode === "double") {
    currentPageIndex.value = Math.floor(currentPageIndex.value / 2) * 2;
  }
}

function movePages(direction) {
  const step = pageViewMode.value === "double" ? 2 : 1;
  const lastPageIndex = reportPages.value.length - 1;
  const maxStartIndex = pageViewMode.value === "double"
    ? Math.floor(lastPageIndex / 2) * 2
    : lastPageIndex;
  currentPageIndex.value = Math.max(
    0,
    Math.min(currentPageIndex.value + direction * step, maxStartIndex),
  );
}

function printReport() {
  printWithPageSetup(report.value?.pageSetup);
}

// ---------- 내보내기 ----------

const EXPORT_FORMATS = [
  { id: "pdf", label: "PDF", extension: "pdf", description: "화면과 똑같은 모양으로 저장 (보관·공유용)" },
  { id: "docx", label: "MS Word", extension: "docx", description: "Word에서 열어 편집할 수 있는 문서" },
  { id: "hwpx", label: "한글", extension: "hwpx", description: "한글 2014 이상에서 열어 편집할 수 있는 문서" },
  { id: "xlsx", label: "Excel", extension: "xlsx", description: "표를 셀·숫자로 옮겨 Excel에서 계산·편집 (페이지별 시트)" },
];

const isExportMenuOpen = ref(false);
const exportBusy = ref("");
const exportProgress = ref("");
const exportToast = ref(null);
const exportMenuRoot = ref(null);
const exportRenderRoot = ref(null);
const isExportRendering = ref(false);
let exportToastTimer;

// ---------- 메일 전송 ----------
// 지금 보고 있는 보고서를 PDF로 만들어 양식의 메일 받는 사람에게 보낸다.
// 받는 사람·제목·본문은 에디터 › 보고서 양식 관리 › 메일 전송에서 정한다.
const mailBusy = ref(false);
const canSendMail = computed(() => canEditReport.value);

async function mailRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `요청에 실패했습니다 (${response.status}).`);
  return result;
}

async function sendReportMail() {
  if (!canSendMail.value || mailBusy.value || isEditing.value) return;
  const reportId = displayedReportId.value;
  const title = report.value.reportTitle || reportLabel.value;
  const base = `/api/templates/${encodeURIComponent(report.value.type)}/mail`;
  mailBusy.value = true;
  try {
    const { settings } = await mailRequest(base);
    const count = new Set([...settings.recipients.map((address) => address.toLowerCase()), ...settings.users]).size;
    if (!count) {
      showExportToast("이 양식에 메일 받는 사람이 없습니다. 에디터 › 보고서 양식 관리 › 메일 전송에서 받는 사람을 지정하세요.", "error");
      return;
    }
    if (!window.confirm(`‘${title}’ 보고서를 PDF로 만들어 받는 사람 ${count}명에게 메일로 보내시겠습니까?`)) return;
    exportProgress.value = "보고서를 PDF로 만들어 메일을 보내는 중입니다...";
    await mailRequest(`${base}/send`, { method: "POST", body: JSON.stringify({ reportId }) });
    exportProgress.value = "";
    showExportToast("메일 서버가 전송 요청을 수락했습니다.");
  } catch (error) {
    exportProgress.value = "";
    showExportToast(`메일을 보내지 못했습니다: ${error.message}`, "error");
  } finally {
    mailBusy.value = false;
  }
}

function showExportToast(text, type = "success") {
  clearTimeout(exportToastTimer);
  exportToast.value = { text, type };
  exportToastTimer = setTimeout(() => {
    exportToast.value = null;
  }, type === "error" ? 7000 : 4000);
}

function toggleExportMenu() {
  if (exportBusy.value) return;
  isExportMenuOpen.value = !isExportMenuOpen.value;
}

function handleDocumentPointerDown(event) {
  if (isExportMenuOpen.value && !exportMenuRoot.value?.contains(event.target)) {
    isExportMenuOpen.value = false;
  }
}

function handleDocumentKeydown(event) {
  if (event.key === "Escape") isExportMenuOpen.value = false;
  handleEditKeydown(event);
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

// 차트는 차트 엔진을 불러온 뒤 그려지므로 모두 그려질 때까지 기다린다(최대 8초).
async function waitForCharts(root, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const charts = [...(root?.querySelectorAll(".report-chart") ?? [])];
    if (charts.every((chart) => chart.dataset.chartReady === "true")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await nextFrame();
}

// PDF는 화면에 그려진 모습을 그대로 찍으므로, 보이지 않는 곳에 모든 페이지를 한 번에 그린다.
async function renderAllPagesForExport() {
  isExportRendering.value = true;
  await nextTick();
  await document.fonts?.ready;
  await nextFrame();
  await waitForCharts(exportRenderRoot.value);
  return [...(exportRenderRoot.value?.querySelectorAll(".report") ?? [])];
}

// Word·한글에는 차트·도형을 그려진 모습 그대로 그림(PNG)으로 넣는다.
async function rasterizeIllustrations() {
  const { toPng } = await import("html-to-image");
  const images = {};
  const elements = exportRenderRoot.value?.querySelectorAll("[data-report-block-id]") ?? [];
  for (const element of elements) {
    // 자유 배치 요소는 종류와 관계없이 요소 전체를 그림으로 떠서 같은 좌표에 띄운다.
    const target = element.dataset.layout === "free"
      ? element
      : element.querySelector(":scope > .report-chart-block > .report-chart, :scope > .report-shape");
    if (!target) continue;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    images[element.dataset.reportBlockId] = {
      src: await toPng(target, {
        pixelRatio: 2,
        skipFonts: true,
        backgroundColor: target.classList.contains("report-chart") ? "#ffffff" : undefined,
        // 자유 배치 요소는 위치 지정 스타일을 빼고 내용만 찍는다.
        style: element.dataset.layout === "free" ? { position: "static", left: "0", top: "0", margin: "0" } : undefined,
      }),
      width: rect.width,
      height: rect.height,
    };
  }
  return images;
}

async function exportReport(format) {
  // 수정 중에는 저장된 내용과 화면이 다를 수 있으므로 내보내지 않는다(버튼도 비활성).
  if (!report.value || exportBusy.value || isEditing.value) return;
  isExportMenuOpen.value = false;
  exportBusy.value = format.id;
  exportProgress.value = `${format.label} 파일을 만드는 중...`;
  const fileName = exportFileName(report.value, format.extension);
  try {
    let blob;
    if (format.id === "pdf") {
      const [{ exportElementsToPdf }, elements] = await Promise.all([
        import("./report-export/pdf-export.js"),
        renderAllPagesForExport(),
      ]);
      blob = await exportElementsToPdf(elements, {
        title: report.value.reportTitle || reportLabel.value,
        pageSetup: report.value.pageSetup,
        onProgress: (page, total) => {
          exportProgress.value = `PDF 만드는 중... ${page}/${total} 페이지`;
        },
      });
    } else {
      // 차트·도형이 있으면 화면 밖에 그린 뒤 그림으로 떠서 넣는다.
      const hasIllustrations = reportPages.value.some((page) =>
        (page.blocks ?? []).some((block) => block.type === "chart" || block.type === "shape" || block.layout?.mode === "free"),
      );
      let images = {};
      if (hasIllustrations) {
        exportProgress.value = "차트·도형을 그림으로 변환하는 중...";
        await renderAllPagesForExport();
        images = await rasterizeIllustrations();
      }
      exportProgress.value = `${format.label} 파일을 만드는 중...`;
      if (format.id === "docx") {
        const { exportReportToDocx } = await import("./report-export/docx-export.js");
        blob = await exportReportToDocx(report.value, { images });
      } else if (format.id === "xlsx") {
        const { exportReportToXlsx } = await import("./report-export/xlsx-export.js");
        blob = await exportReportToXlsx(report.value, { images });
      } else {
        const { exportReportToHwpx } = await import("./report-export/hwpx-export.js");
        blob = await exportReportToHwpx(report.value, { images });
      }
    }
    downloadBlob(blob, fileName);
    showExportToast(`'${fileName}' 파일을 저장했습니다.`);
  } catch (error) {
    console.error(error);
    showExportToast(`${format.label} 파일을 만들지 못했습니다: ${error.message}`, "error");
  } finally {
    isExportRendering.value = false;
    exportBusy.value = "";
    exportProgress.value = "";
  }
}

onMounted(() => {
  loadInitialReport();
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeydown);
  window.addEventListener("pointerup", endCellDrag);
  window.addEventListener("beforeunload", handleBeforeUnload);
});

onUnmounted(() => {
  clearTimeout(exportToastTimer);
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeydown);
  window.removeEventListener("pointerup", endCellDrag);
  window.removeEventListener("beforeunload", handleBeforeUnload);
});
</script>

<template>
  <div class="viewer">
    <header class="viewer-header">
      <div class="viewer-header-title">
        <a class="brand" href="/" aria-label="CODVILL 홈">
          <img class="brand-logo" src="/codvill-logo-dark.png" alt="CODVILL" />
        </a>
        <span class="viewer-header-divider" aria-hidden="true"></span>
        <div class="viewer-header-heading">
          <p class="portal-eyebrow">REPORT VIEWER</p>
          <h1>리포트 뷰어</h1>
        </div>
        <ToolNav :auth-user="props.authUser" current="viewer" @select-tool="emit('select-tool', $event)" />
      </div>
      <div class="viewer-header-actions">
        <button class="topbar-link" type="button" @click="emit('help')">도움말</button>
        <button class="topbar-link viewer-logout" type="button" @click="emit('logout')">로그아웃</button>
      </div>
    </header>

    <div v-if="exportProgress || exportToast" class="export-toast" :class="{ 'export-toast-error': exportToast?.type === 'error' && !exportProgress }" role="status" aria-live="polite">
      <span v-if="exportProgress" class="export-spinner" aria-hidden="true"></span>
      {{ exportProgress || exportToast?.text }}
    </div>

    <!-- PDF 내보내기용: 화면 밖에 모든 페이지를 실제 크기로 그린다 -->
    <div v-if="isExportRendering && report" ref="exportRenderRoot" class="export-render-root" aria-hidden="true">
      <ReportCanvas
        v-for="(page, pageIndex) in reportPages"
        :key="page.id || pageIndex"
        :report-type="report.layoutType || report.type"
        :date="report.date"
        :blocks="page.blocks"
        :header-footer="report.headerFooter"
        :page-setup="report.pageSetup"
        :page-index="pageIndex"
        :page-count="reportPages.length"
        :report-title="report.reportTitle || reportLabel"
      />
    </div>

    <main class="viewer-main">
      <div class="viewer-workspace">
        <aside class="viewer-report-sidebar" aria-label="저장된 보고서 목록">
          <div class="viewer-sidebar-heading viewer-sidebar-heading-stack">
            <button
              class="viewer-template-select"
              type="button"
              :disabled="loading"
              aria-haspopup="dialog"
              title="양식 선택"
              @click="openTemplatePicker"
            >
              <span class="viewer-template-select-copy">
                <span>양식</span>
                <strong>{{ selectedTemplateLabel }}</strong>
              </span>
              <span class="viewer-report-count" :title="`저장된 리포트 ${selectedTemplateReports.length}개`">{{ selectedTemplateReports.length }}</span>
              <i class="viewer-template-caret" aria-hidden="true"></i>
            </button>
            <button
              class="generate-report-button viewer-sidebar-generate"
              type="button"
              :disabled="loading || !selectedTemplateType || isEditing"
              :title="isEditing ? '수정을 저장하거나 취소한 뒤 사용할 수 있습니다' : '선택한 양식으로 새 리포트를 생성합니다'"
              @click="openGenerationForm"
            >＋ 새 리포트 생성</button>
          </div>
          <div class="viewer-list-heading">
            <span>리포트 목록</span>
            <button
              class="viewer-list-refresh"
              :class="{ 'viewer-list-refresh-busy': loading }"
              type="button"
              :disabled="loading"
              :aria-label="loading ? '목록을 불러오는 중' : '목록 새로고침'"
              :title="loading ? '목록을 불러오는 중...' : '목록 새로고침 (리포트 목록과 양식을 다시 불러옵니다)'"
              @click="refreshReportList()"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M13.2 6.4A5.4 5.4 0 0 0 3.3 4.6M2.8 9.6a5.4 5.4 0 0 0 9.9 1.8" />
                <path d="M3 2v2.9h2.9M13 14v-2.9h-2.9" />
              </svg>
            </button>
          </div>
          <div class="viewer-report-list" aria-label="보고서 목록">
            <button
              v-for="item in pagedReports"
              :key="getReportKey(item)"
              class="viewer-report-list-item"
              :class="{ 'viewer-report-list-item-selected': selectedReportKey === getReportKey(item) }"
              type="button"
              :aria-pressed="selectedReportKey === getReportKey(item)"
              :aria-busy="loadingContent && selectedReportKey === getReportKey(item)"
              @click="selectReport(item)"
            >
              <span class="viewer-report-list-icon" aria-hidden="true">▤</span>
              <span class="viewer-report-list-copy">
                <strong>{{ reportOptionLabel(item) }}</strong>
                <small>
                  {{ item.rangeStart && item.rangeEnd
                    ? `${item.rangeStart.slice(0, 16)} – ${item.rangeEnd.slice(0, 16)}`
                    : reportDateLabel(item.date) }}
                </small>
              </span>
              <span
                v-if="loadingContent && selectedReportKey === getReportKey(item) && displayedReportKey !== getReportKey(item)"
                class="viewer-report-loading-badge"
              ><i class="export-spinner" aria-hidden="true"></i>여는 중</span>
              <span
                v-else-if="report && displayedReportKey === getReportKey(item)"
                class="viewer-report-displayed-badge"
              >{{ isEditing ? "수정 중" : "보는 중" }}</span>
            </button>
            <p v-if="!loading && !selectedTemplateReports.length" class="viewer-empty-list">
              이 양식으로 저장된 리포트가 없습니다.
            </p>
            <p v-if="loading" class="viewer-empty-list">목록을 불러오고 있습니다.</p>
          </div>
          <footer v-if="selectedTemplateReports.length" class="viewer-list-pager" aria-label="리포트 목록 페이지">
            <div class="viewer-list-pager-row">
              <label class="viewer-list-size">
                <span>표시</span>
                <select
                  :value="listPageSize"
                  aria-label="한 페이지에 표시할 리포트 수"
                  @change="changeListPageSize(Number($event.target.value))"
                >
                  <option v-for="size in LIST_PAGE_SIZES" :key="size" :value="size">{{ size }}개</option>
                </select>
              </label>
              <span class="viewer-list-range">{{ listRangeText }}</span>
            </div>
            <div v-if="listPageCount > 1" class="viewer-list-pager-row viewer-list-pager-nav">
              <button type="button" aria-label="첫 페이지" :disabled="listPage === 0" @click="goListPage(0)">«</button>
              <button type="button" aria-label="이전 페이지" :disabled="listPage === 0" @click="goListPage(listPage - 1)">‹</button>
              <span aria-live="polite">{{ listPage + 1 }} / {{ listPageCount }}</span>
              <button type="button" aria-label="다음 페이지" :disabled="listPage >= listPageCount - 1" @click="goListPage(listPage + 1)">›</button>
              <button type="button" aria-label="마지막 페이지" :disabled="listPage >= listPageCount - 1" @click="goListPage(listPageCount - 1)">»</button>
            </div>
          </footer>
        </aside>

        <section class="viewer-report-stage" aria-label="리포트 내용">
          <div v-if="report" class="viewer-stage-heading">
            <div v-if="report">
              <span>
                {{ reportOriginLabel }}
                <template v-if="report.editedAt"> · 수동 수정됨</template>
              </span>
              <h2>{{ report.reportTitle || reportLabel }}</h2>
            </div>
            <div v-else></div>
            <!-- 순서: 수정 · 페이지 보기 · 페이지 넘기기 · 인쇄 · 내보내기 -->
            <div class="viewer-page-toolbar">
              <template v-if="report">
              <button
                v-if="!isEditing"
                class="viewer-edit-button"
                type="button"
                :disabled="!canEditReport || loadingContent"
                :title="canEditReport ? '리포트의 값과 글꼴을 직접 수정합니다' : '저장된 리포트만 수정할 수 있습니다'"
                @click="startEditing"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13h2.5l7-7a1.8 1.8 0 0 0-2.5-2.5l-7 7z" /></svg>
                수정
              </button>
              <div class="page-view-toggle" role="group" aria-label="페이지 보기 방식">
                <button
                  type="button"
                  :aria-pressed="pageViewMode === 'single'"
                  :class="{ 'page-view-active': pageViewMode === 'single' }"
                  @click="changePageView('single')"
                >1페이지씩 보기</button>
                <button
                  type="button"
                  :aria-pressed="pageViewMode === 'double'"
                  :class="{ 'page-view-active': pageViewMode === 'double' }"
                  @click="changePageView('double')"
                >2페이지씩 보기</button>
              </div>
              <div class="page-navigation">
                <button
                  type="button"
                  aria-label="이전 페이지"
                  :disabled="currentPageIndex === 0"
                  @click="movePages(-1)"
                >‹</button>
                <span>
                  {{ currentPageIndex + 1 }}–{{ Math.min(currentPageIndex + visiblePages.length, reportPages.length) }}
                  / {{ reportPages.length }} 페이지
                </span>
                <button
                  type="button"
                  aria-label="다음 페이지"
                  :disabled="currentPageIndex + visiblePages.length >= reportPages.length"
                  @click="movePages(1)"
                >›</button>
              </div>
              <span class="viewer-toolbar-separator" aria-hidden="true"></span>
              <button
                class="print-button"
                type="button"
                :disabled="isEditing"
                :title="isEditing ? '수정을 저장하거나 취소한 뒤 인쇄할 수 있습니다' : undefined"
                @click="printReport"
              >인쇄</button>
              <div ref="exportMenuRoot" class="export-menu-anchor">
                <button
                  class="export-button"
                  type="button"
                  :disabled="Boolean(exportBusy) || isEditing"
                  :title="isEditing ? '수정을 저장하거나 취소한 뒤 내보낼 수 있습니다' : undefined"
                  aria-haspopup="menu"
                  :aria-expanded="isExportMenuOpen"
                  @click="toggleExportMenu"
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7.5M4.8 7 8 10.2 11.2 7M3 12.5h10" /></svg>
                  {{ exportBusy ? "내보내는 중..." : "내보내기" }}
                  <i class="export-caret" aria-hidden="true"></i>
                </button>
                <div v-if="isExportMenuOpen" class="export-menu" role="menu" aria-label="파일로 내보내기">
                  <p class="export-menu-title">파일로 내보내기</p>
                  <button
                    v-for="format in EXPORT_FORMATS"
                    :key="format.id"
                    class="export-menu-item"
                    type="button"
                    role="menuitem"
                    @click="exportReport(format)"
                  >
                    <span class="export-file-icon" :class="`export-file-${format.id}`" aria-hidden="true">{{ format.extension.toUpperCase() }}</span>
                    <span class="export-menu-copy">
                      <strong>{{ format.label }} <small>.{{ format.extension }}</small></strong>
                      <span>{{ format.description }}</span>
                    </span>
                  </button>
                </div>
              </div>
              <button
                v-if="canSendMail"
                class="viewer-mail-button"
                type="button"
                :disabled="mailBusy || isEditing"
                :title="isEditing ? '수정을 저장하거나 취소한 뒤 보낼 수 있습니다' : '이 보고서를 PDF로 만들어 양식의 받는 사람에게 메일로 보냅니다'"
                @click="sendReportMail"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="12" height="9" rx="1.5" /><path d="m2.8 4.6 5.2 4 5.2-4" /></svg>
                {{ mailBusy ? "보내는 중..." : "메일 전송" }}
              </button>
              </template>
            </div>
          </div>
          <p v-if="generationNotice" class="viewer-notice" role="status">
            {{ generationNotice }}
          </p>
          <div v-if="errorMessage && report" class="viewer-notice viewer-notice-error" role="alert">
            {{ errorMessage }} 이전에 보던 리포트를 계속 표시합니다.
          </div>
          <div v-if="errorMessage && !report" class="viewer-message viewer-error" role="alert">
            <p>{{ errorMessage }}</p>
            <button class="refresh-button" type="button" @click="loadInitialReport">다시 시도</button>
          </div>
          <template v-else-if="sampleTemplate">
            <div class="viewer-sample-guide" role="status">
              <span class="viewer-sample-badge">샘플</span>
              <p>
                <strong>{{ selectedTemplateLabel }}</strong> 양식의 미리보기입니다.
                {{ hasSelectedReport
                  ? "왼쪽 목록에서 리포트를 선택하거나 ‘새 리포트 생성’으로 리포트를 생성하세요."
                  : "아직 생성된 리포트가 없습니다. ‘새 리포트 생성’ 버튼을 눌러 리포트를 생성하세요." }}
              </p>
              <button
                class="generate-report-button"
                type="button"
                :disabled="loading || !selectedTemplateType"
                @click="openGenerationForm"
              >리포트 생성</button>
            </div>
            <div class="viewer-report-scroll">
              <div class="viewer-page viewer-page-single" aria-label="양식 샘플 미리보기">
                <div
                  v-for="(page, pageIndex) in sampleTemplate.pages"
                  :key="page.id || pageIndex"
                  class="viewer-sample-sheet viewer-report-page-single"
                >
                  <ReportCanvas
                    :report-type="sampleTemplate.layoutType || 'daily'"
                    :date="sampleDate"
                    :blocks="page.blocks"
                    :header-footer="sampleTemplate.headerFooter"
                    :page-setup="sampleTemplate.pageSetup"
                    :page-index="pageIndex"
                    :page-count="sampleTemplate.pages.length"
                    :report-title="sampleTemplate.label"
                  />
                  <span class="viewer-sample-watermark" aria-hidden="true">SAMPLE · 샘플</span>
                </div>
              </div>
            </div>
          </template>
          <div v-else-if="!report" class="viewer-stage-empty" role="status">
            <span aria-hidden="true">▤</span>
            <h2>{{ loading || loadingContent ? "리포트를 불러오고 있습니다." : "리포트를 선택해 주세요." }}</h2>
            <p>{{ loading || loadingContent
              ? "가장 최근에 저장된 리포트를 가져오는 중입니다."
              : hasSelectedReport
                ? "왼쪽 목록에서 리포트를 누르면 바로 표시됩니다."
                : "이 양식으로 저장된 리포트가 없습니다. ‘새 리포트 생성’ 버튼을 눌러 리포트를 생성하세요." }}</p>
          </div>
          <template v-else>
            <div v-if="isEditing" class="viewer-edit-panel">
              <div class="viewer-edit-bar">
                <span class="viewer-edit-badge">수정 중</span>
                <span class="viewer-edit-hint">
                  글자를 눌러 값을 고치고, 요소나 표 셀을 선택해 글꼴을 바꿀 수 있습니다. 요소·행 추가와 삭제는 에디터에서 합니다.
                </span>
                <span v-if="isEditDirty" class="viewer-edit-dirty">저장하지 않은 변경</span>
                <button class="modal-secondary-button" type="button" :disabled="editSaving" @click="cancelEditing">취소</button>
                <button
                  class="viewer-save-button"
                  type="button"
                  :disabled="editSaving"
                  title="저장 (Ctrl+S)"
                  @click="saveEdits"
                >{{ editSaving ? "저장 중..." : "저장" }}</button>
              </div>
              <p v-if="editError" class="viewer-notice viewer-notice-error" role="alert">{{ editError }}</p>
              <FontToolbar
                :style-state="fontStyleState"
                :disabled="!fontFormatTarget"
                :target-label="fontTargetLabel"
                @apply="toolbarHandlers.onApply"
                @toggle="toolbarHandlers.onToggle"
                @font-size="toolbarHandlers.onFontSize"
                @grow="toolbarHandlers.onGrow"
                @shrink="toolbarHandlers.onShrink"
                @change-case="toolbarHandlers.onChangeCase"
                @clear="toolbarHandlers.onClear"
                @align="toolbarHandlers.onAlign"
              />
            </div>
            <div class="viewer-report-scroll" :class="{ 'viewer-report-scroll-editing': isEditing }">
              <div
                class="viewer-page"
                :class="`viewer-page-${pageViewMode}`"
                :aria-label="isEditing ? '수정 중인 보고서' : '저장된 보고서'"
              >
                <ReportCanvas
                  v-for="(page, pageIndex) in visiblePages"
                  :key="page.id || currentPageIndex + pageIndex"
                  :report-type="activeLayoutType"
                  :date="activeReport.date"
                  :blocks="page.blocks"
                  :header-footer="activeReport.headerFooter"
                  :page-setup="activeReport.pageSetup"
                  :page-index="currentPageIndex + pageIndex"
                  :page-count="reportPages.length"
                  :report-title="activeReport.reportTitle || reportLabel"
                  :interactive="isEditing"
                  edit-mode="values"
                  :selected-id="editSelectedId"
                  :selected-cells="editSelectedCells"
                  :class="`viewer-report-page viewer-report-page-${pageViewMode}`"
                  @select="selectEditBlock"
                  @field-input="handleFieldInput"
                  @cell-input="handleCellInput"
                  @cell-pointerdown="handleCellPointerDown"
                  @cell-pointerenter="handleCellPointerEnter"
                  @cell-select="handleCellSelect"
                  @chart-edit="openChartEdit"
                />
              </div>
            </div>
          </template>
        </section>
      </div>
    </main>

    <ChartDataDialog
      v-if="chartEditBlock"
      :block="chartEditBlock"
      :allow-database="false"
      @apply="applyChartEdit"
      @close="chartEditBlockId = ''"
    />

    <div
      v-if="pendingLeave"
      class="viewer-modal-backdrop"
    >
      <section
        class="viewer-modal viewer-leave-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="viewer-leave-title"
        aria-describedby="viewer-leave-description"
      >
        <header class="viewer-modal-header popup-titlebar">
          <div>
            <h2 id="viewer-leave-title">저장하지 않은 수정 내용이 있습니다</h2>
            <p id="viewer-leave-description">
              {{ pendingLeave.kind === "report"
                ? "다른 리포트를 열면 지금 수정한 내용이 사라집니다."
                : pendingLeave.kind === "template"
                  ? "다른 양식으로 바꾸면 지금 수정한 내용이 사라집니다."
                  : "수정을 취소하면 지금 수정한 내용이 사라집니다." }}
            </p>
          </div>
        </header>
        <footer class="viewer-modal-actions">
          <button class="modal-secondary-button" type="button" @click="resolvePendingLeave('stay')">계속 수정</button>
          <button class="viewer-discard-button" type="button" :disabled="editSaving" @click="resolvePendingLeave('discard')">저장하지 않고 {{ pendingLeave.kind === "cancel" ? "취소" : "이동" }}</button>
          <button class="viewer-save-button" type="button" :disabled="editSaving" @click="resolvePendingLeave('save')">
            {{ editSaving ? "저장 중..." : pendingLeave.kind === "cancel" ? "저장" : "저장 후 이동" }}
          </button>
        </footer>
      </section>
    </div>

    <div
      v-if="isTemplatePickerOpen"
      class="viewer-modal-backdrop"
    >
      <section class="viewer-modal" role="dialog" aria-modal="true" aria-labelledby="viewer-template-title">
        <header class="viewer-modal-header popup-titlebar">
          <div>
            <p class="portal-eyebrow">REPORT TEMPLATES</p>
            <h2 id="viewer-template-title">양식 선택</h2>
          </div>
          <button
            class="modal-close-button"
            type="button"
            aria-label="닫기"
            @click="isTemplatePickerOpen = false"
          >×</button>
        </header>
        <div class="viewer-template-groups">
          <section v-for="group in groupedTemplateOptions" :key="group.name">
            <h3>{{ group.name }}</h3>
            <button
              v-for="template in group.items"
              :key="template.id"
              type="button"
              class="viewer-template-choice"
              :class="{ 'viewer-template-choice-selected': templatePickerSelection === template.id }"
              @click="templatePickerSelection = template.id"
            >
              <span>{{ template.label }}</span>
              <span v-if="templatePickerSelection === template.id" aria-hidden="true">✓</span>
            </button>
          </section>
        </div>
        <footer class="viewer-modal-actions">
          <button class="modal-secondary-button" type="button" @click="isTemplatePickerOpen = false">취소</button>
          <button class="generate-report-button" type="button" @click="applySelectedTemplate">양식 선택</button>
        </footer>
      </section>
    </div>

    <div
      v-if="isGenerationFormOpen"
      class="viewer-modal-backdrop"
    >
      <form
        class="viewer-modal viewer-generation-modal"
        @submit.prevent="generateReport"
      >
        <header class="viewer-modal-header popup-titlebar">
          <div>
            <p class="portal-eyebrow">GENERATE REPORT</p>
            <div class="popup-title-line">
              <h2>새 리포트 생성</h2>
              <p>{{ selectedTemplateLabel }} 양식으로 생성합니다.</p>
            </div>
          </div>
          <button
            class="modal-close-button"
            type="button"
            aria-label="닫기"
            :disabled="generating"
            @click="isGenerationFormOpen = false"
          >×</button>
        </header>
        <div class="viewer-generation-fields">
          <label>
            리포트 제목
            <input
              v-model="generationTitle"
              maxlength="160"
              placeholder="비워두면 양식명-YYYY-MM-DD로 지정"
            />
          </label>
          <label>
            시작 날짜시간 (한국시간)
            <input v-model="generationStart" type="datetime-local" required />
          </label>
          <label>
            종료 날짜시간 (한국시간)
            <input v-model="generationEnd" type="datetime-local" required />
          </label>
          <p v-if="generationError" class="viewer-generation-error" role="alert">{{ generationError }}</p>
        </div>
        <footer class="viewer-modal-actions">
          <button
            class="modal-secondary-button"
            type="button"
            :disabled="generating"
            @click="isGenerationFormOpen = false"
          >취소</button>
          <button class="generate-report-button" type="submit" :disabled="generating">
            {{ generating ? "생성 중..." : "리포트 생성" }}
          </button>
        </footer>
      </form>
    </div>
  </div>
</template>
