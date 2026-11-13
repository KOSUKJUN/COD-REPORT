<script setup>
import { computed, onUnmounted, ref } from "vue";
import ReportText from "./ReportText.vue";
import ReportChart from "./ReportChart.vue";
import ActionIcon from "./ActionIcon.vue";
import { shapeSvgMarkup } from "../shapes.js";
import { clampHeight, getLayout, heightTarget, isFree, snapWidth } from "../layout.js";
import { hasContent, normalizeHeaderFooter, resolveSlots } from "../header-footer.js";
import {
  expandRepeatedBlocks,
  getBoundFieldValue,
  getTableMerges,
  getTableRows,
  getTableSummary,
  hasCellFields,
  isFieldBound,
  isRepeatingTable,
} from "../data-binding.js";
import { formatReportDate, formatReportPeriod } from "../report-format.js";
import { textStyleToCss } from "../text-style.js";
import { getPageDimensions } from "../page-setup.js";
import { clampRowHeight, getColumnWidths, moveColumnBoundary, resolvedColumnWidths, rowHeight } from "../table-size.js";

const props = defineProps({
  reportType: {
    type: String,
    required: true,
  },
  date: {
    type: String,
    required: true,
  },
  blocks: {
    type: Array,
    required: true,
  },
  selectedId: {
    type: String,
    default: "",
  },
  zoom: {
    type: Number,
    default: 100,
  },
  interactive: {
    type: Boolean,
    default: false,
  },
  selectedCells: {
    type: Array,
    default: () => [],
  },
  canMergeCells: {
    type: Boolean,
    default: false,
  },
  canUnmergeCells: {
    type: Boolean,
    default: false,
  },
  // design: 에디터(양식 편집 — 요소 이동·추가, 셀 병합 등)
  // values: 뷰어 수정(값과 글꼴만 — 구조는 바꿀 수 없음)
  editMode: {
    type: String,
    default: "design",
    validator: (value) => ["design", "values"].includes(value),
  },
  // 머리글·바닥글과 페이지 번호
  headerFooter: { type: Object, default: null },
  pageIndex: { type: Number, default: 0 },
  pageCount: { type: Number, default: 1 },
  reportTitle: { type: String, default: "" },
  // 용지 크기·방향 (없으면 A4 세로)
  pageSetup: { type: Object, default: null },
  // 본문 영역(여백 안쪽) 경계를 점선으로 표시 — Word의 '텍스트 경계 표시'
  showBoundaries: { type: Boolean, default: false },
});

const pageDimensions = computed(() => getPageDimensions(props.pageSetup));
const pageStyle = computed(() => ({
  "--canvas-zoom": `${props.zoom / 100}`,
  "--page-width": `${pageDimensions.value.widthPt}px`,
  "--page-height": `${pageDimensions.value.heightPt}px`,
}));

const emit = defineEmits([
  "select",
  "cell-pointerdown",
  "cell-pointerenter",
  "cell-input",
  "cell-field",
  "row-repeat",
  "cell-select",
  "cell-shade",
  "cell-merge",
  "cell-unmerge",
  "reorder",
  "insert-drop",
  "field-input",
  "chart-edit",
  "layout-update",
  "table-resize",
  "edit-header-footer",
]);

// ---------- 머리글·바닥글 ----------

const headerFooterConfig = computed(() => (props.headerFooter ? normalizeHeaderFooter(props.headerFooter) : null));
const headerFooterInfo = computed(() => ({
  pageIndex: props.pageIndex,
  pageCount: props.pageCount,
  title: props.reportTitle,
  date: formatReportDate(props.date),
}));

function areaSlots(kind) {
  return headerFooterConfig.value ? resolveSlots(headerFooterConfig.value, kind, headerFooterInfo.value) : { left: "", center: "", right: "" };
}

// 에디터에서는 비어 있어도 여백을 두 번 눌러 편집할 수 있게 영역을 둔다.
function showArea(kind) {
  return designMode.value || hasContent(areaSlots(kind));
}

function areaStyle(kind) {
  const config = headerFooterConfig.value ?? normalizeHeaderFooter(null);
  return {
    [kind === "header" ? "top" : "bottom"]: `${config[kind === "header" ? "headerDistance" : "footerDistance"]}px`,
    fontSize: `${config.fontSize}px`,
    color: config.color,
  };
}

function areaHasDivider(kind) {
  return Boolean(headerFooterConfig.value?.[kind === "header" ? "headerDivider" : "footerDivider"]);
}

// ---------- 배치(영역 배치 너비 / 자유 배치) ----------

function layoutClass(block) {
  const layout = getLayout(block);
  const classes = [];
  if (layout.h && heightTarget(block) === "layout") classes.push("report-element-sized");
  if (layout.mode === "free") return [...classes, "report-element-free", `report-element-free-${layout.wrap}`];
  return layout.width < 100 ? [...classes, "report-element-split"] : classes;
}

function shapeMarkup(block) {
  return shapeSvgMarkup(block.shape ?? {});
}

function shapeBoxStyle(block) {
  const width = Number(block.shape?.width) || 160;
  const height = Number(block.shape?.height) || 90;
  return { width: `${width}px`, height: `${height}px` };
}

const designMode = computed(() => props.interactive && props.editMode === "design");

// 에디터(양식 편집)에서는 반복 표를 한 번만 보여 주고, 뷰어·인쇄에서는 조회 결과만큼 표를 이어서 그린다.
const renderBlocks = computed(() => (designMode.value ? props.blocks : expandRepeatedBlocks(props.blocks)));
const valuesEditable = computed(() => props.interactive && props.editMode === "values");

// 캔버스에서 글자를 바로 고칠 수 있는지. 에디터에서는 DB 필드에 연결된 값(쿼리 결과가 보이는 값)과
// 요약 쿼리를 쓰는 요약은 연결 설정에서 바꾸도록 직접 편집을 막는다.
function canEdit(block, field) {
  if (!props.interactive) return false;
  if (valuesEditable.value) return true;
  if (field === "summary" && block.summaryBinding?.enabled) return false;
  return !isFieldBound(block, field);
}

// 뷰어 수정: 요소의 텍스트 값 변경을 알린다. definitions 는 index 로 항목을 지정한다.
function emitField(block, field, value, index) {
  emit("field-input", { blockId: block.id, field, value, index });
}

// datetime-local / date 입력 형식으로 맞춘다.
function toDateTimeInput(value) {
  const text = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text) ? text.slice(0, 16).replace(" ", "T") : "";
}

function toDateInput(value) {
  const text = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

// 요소 자체에 포커스가 있을 때만 Enter/Space 로 선택한다(안쪽 입력칸의 공백 입력은 막지 않는다).
function handleElementKeydown(block, event) {
  if (!props.interactive || event.target !== event.currentTarget) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    emit("select", block.id);
  }
}

const BLOCK_DRAG_TYPE = "application/x-cod-report-block";
const DRAG_START_DISTANCE = 4;
const AUTO_SCROLL_EDGE = 56;
const AUTO_SCROLL_MAX_SPEED = 18;

const articleRef = ref(null);
const draggingId = ref("");
const dropIndicator = ref(null);
// 끌고 있는 요소의 복제본(고스트). TransitionGroup 이 목록 항목의 transform 을
// 초기화하므로 원본을 움직이지 않고 복제본이 마우스를 따라가게 한다.
const dragGhost = ref(null);
// 크기 조정 중 요소 옆에 보여 줄 크기 { blockId, text }
const resizeHint = ref(null);
let dragState = null;

function formattedDate(value = props.date) {
  return formatReportDate(value);
}

function formatPeriod(value) {
  return formatReportPeriod(value);
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
  if (block.type === "section" || block.type === "table" || block.type === "special") {
    return block.heading || "업무 항목";
  }
  if (block.type === "divider") {
    return "구분선";
  }
  if (block.type === "image") {
    return block.content || "그림";
  }
  if (block.type === "shape") {
    return block.content || "도형";
  }
  if (block.type === "chart") {
    return block.chart?.title || "차트";
  }
  return block.content || "텍스트";
}

function cellStyle(block, row, columnIndex) {
  const backgroundColor =
    row?.cellStyles?.[columnIndex]?.backgroundColor ||
    block.columnStyles?.[columnIndex]?.backgroundColor;
  const textAlign = row?.cellStyles?.[columnIndex]?.textAlign;
  if (!backgroundColor && !textAlign) return undefined;
  return {
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(textAlign ? { textAlign } : {}),
  };
}

function textCss(block) {
  // textStyle.fontSize 는 CSS 고정 크기를 쓰는 요소(날짜·기간·특이사항)에만 저장된다.
  return textStyleToCss(block.textStyle, { includeFontSize: true });
}

function cellTextCss(row, columnIndex) {
  const style = row?.cellStyles?.[columnIndex];
  const css = textStyleToCss(style, { includeFontSize: true });
  return style?.textAlign ? { ...css, textAlign: style.textAlign } : css;
}

function tableRows(block) {
  return getTableRows(block, { showMappedFieldNames: designMode.value });
}

function isBoundTableCell(block, row, columnIndex) {
  if (cellField(block, row, columnIndex)) return true;
  return Boolean(
    block.dataBinding?.enabled &&
      !hasCellFields(block) &&
      !row.isTitleRow &&
      block.dataBinding.mappings?.columns?.[columnIndex],
  );
}

// ---------- 셀 필드(필드 목록에서 끌어다 놓기) ----------

const FIELD_DRAG_TYPE = "application/x-cod-report-field";
const fieldDropTarget = ref("");

function cellField(block, row, columnIndex) {
  return block.dataBinding?.enabled ? row?.fields?.[columnIndex] || "" : "";
}

function acceptsFieldDrop(event) {
  return designMode.value && [...(event.dataTransfer?.types ?? [])].includes(FIELD_DRAG_TYPE);
}

function handleFieldDragOver(block, rowIndex, columnIndex, event) {
  if (!acceptsFieldDrop(event)) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = "copy";
  fieldDropTarget.value = `${block.id}:${rowIndex}:${columnIndex}`;
}

function handleFieldDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) fieldDropTarget.value = "";
}

function handleFieldDrop(block, rowIndex, columnIndex, event) {
  if (!acceptsFieldDrop(event)) return;
  event.preventDefault();
  event.stopPropagation();
  fieldDropTarget.value = "";
  const field = event.dataTransfer.getData(FIELD_DRAG_TYPE);
  if (field) emit("cell-field", { blockId: block.id, row: rowIndex, column: columnIndex, field });
}

// 행 반복 버튼은 그 행에서 보이는 마지막 셀 오른쪽 바깥에 둔다.
function lastVisibleColumn(block, rowIndex, row) {
  for (let column = (row.cells?.length ?? 0) - 1; column >= 0; column -= 1) {
    if (!isCellCovered(block, rowIndex, column)) return column;
  }
  return -1;
}

function showRowRepeatToggle(block, row) {
  return designMode.value && props.selectedId === block.id && block.dataBinding?.enabled
    && !block.dataBinding.repeatTable && (row.repeat || row.fields?.some(Boolean));
}

function tableSummary(block) {
  return getTableSummary(block, { showFieldNames: designMode.value });
}

// 뷰어 수정 중에는 값이 비어 있어도 해당 표를 선택하면 입력할 수 있게 보여 준다.
function showOptionalField(block, value) {
  return Boolean(value) || (props.interactive && props.selectedId === block.id);
}

function boundField(block, field, fallback = block[field] ?? "") {
  return getBoundFieldValue(block, field, fallback);
}

function isCellSelected(row, column) {
  return props.selectedCells.some(
    (cell) => cell.row === row && cell.column === column,
  );
}

function handleCellPointerDown(block, row, column, event) {
  emit("cell-pointerdown", {
    blockId: block.id,
    row,
    column,
    event,
  });
}

function handleCellPointerEnter(row, column) {
  emit("cell-pointerenter", { row, column });
}

function handleCellInput(block, row, column, event) {
  emit("cell-input", {
    blockId: block.id,
    row,
    column,
    value: event.currentTarget.value,
  });
}

// 에디터에서는 양식의 행 그대로, 뷰어에서는 반복으로 늘어난 행에 맞춘 병합을 쓴다.
function tableMerges(block) {
  return designMode.value ? block.merges ?? [] : getTableMerges(block);
}

// ---------- 표 셀 키보드 ----------
// Enter: 오른쪽 셀로(줄 끝이면 다음 행 첫 셀), Shift+Enter: 반대 방향.
// Delete: 선택한 셀(여러 개면 모두)의 내용을 지운다. 글자 하나씩 지울 때는 Backspace.

function cellInputs(block) {
  return [...(articleRef.value?.querySelectorAll(`[data-cell-block="${CSS.escape(block.id)}"]`) ?? [])];
}

function focusNextCell(block, rowIndex, columnIndex, backward) {
  const inputs = cellInputs(block);
  const index = inputs.findIndex((input) => Number(input.dataset.row) === rowIndex && Number(input.dataset.column) === columnIndex);
  const next = inputs[index + (backward ? -1 : 1)];
  if (!next) {
    inputs[index]?.blur();
    return;
  }
  next.focus();
  next.select();
  emit("cell-select", { blockId: block.id, row: Number(next.dataset.row), column: Number(next.dataset.column) });
}

function isCellEditable(block, row, columnIndex) {
  return !(designMode.value && isBoundTableCell(block, row, columnIndex));
}

function handleCellKeydown(block, rowIndex, columnIndex, event) {
  // 한글 조합 중 Enter 는 글자 확정이므로 넘기지 않는다.
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter" && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    event.stopPropagation();
    focusNextCell(block, rowIndex, columnIndex, event.shiftKey);
    return;
  }
  if (event.key === "Delete" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    event.stopPropagation();
    const rows = tableRows(block);
    const targets = props.selectedId === block.id && props.selectedCells.length
      ? props.selectedCells
      : [{ row: rowIndex, column: columnIndex }];
    if (!targets.some((cell) => cell.row === rowIndex && cell.column === columnIndex)) {
      targets.push({ row: rowIndex, column: columnIndex });
    }
    for (const cell of targets) {
      const row = rows[cell.row];
      if (!row || !row.cells?.[cell.column] || !isCellEditable(block, row, cell.column)) continue;
      emit("cell-input", { blockId: block.id, row: cell.row, column: cell.column, value: "" });
    }
    event.currentTarget.value = "";
  }
}

function cellMerge(block, row, column) {
  return tableMerges(block).find(
    (merge) => merge.row === row && merge.column === column,
  );
}

function isCellCovered(block, row, column) {
  return tableMerges(block).some(
    (merge) =>
      (row !== merge.row || column !== merge.column) &&
      row >= merge.row &&
      row < merge.row + merge.rowspan &&
      column >= merge.column &&
      column < merge.column + merge.colspan,
  ) ?? false;
}

// ---------- 요소 배치: 삽입 위치 계산 ----------
// 마우스 아래 요소가 아니라 모든 요소의 세로 중앙선을 기준으로 위치를 정하므로
// 요소 사이 여백이나 요소 가장자리에 놓아도 항상 가장 가까운 자리로 배치된다.

function getScale() {
  return props.zoom / 100;
}

// 영역 배치 요소만(자유 배치 요소는 위치를 좌표로 정하므로 제외)
function getBlockElements(excludeId) {
  if (!articleRef.value) return [];
  return [...articleRef.value.querySelectorAll("[data-report-block-id][data-layout='flow']")].filter(
    (element) => element.dataset.reportBlockId !== excludeId,
  );
}

// 놓을 자리를 "어느 요소 앞(beforeId)"으로 계산한다. (null = 맨 끝)
// 가로로 나눈 줄 위에서는 좌우 위치로, 그 밖에서는 위아래 중앙선으로 판단한다.
function computeInsertion(clientX, clientY, excludeId) {
  const article = articleRef.value;
  if (!article) return null;
  const scale = getScale();
  const articleRect = article.getBoundingClientRect();
  const items = getBlockElements(excludeId).map((element) => ({
    id: element.dataset.reportBlockId,
    rect: element.getBoundingClientRect(),
  }));
  const local = (value, origin) => (value - origin) / scale;
  const list = article.querySelector(".report-block-list")?.getBoundingClientRect() ?? articleRect;

  const row = items.filter(({ rect }) => clientY >= rect.top && clientY <= rect.bottom);
  const splitRow = row.length > 1 || (row.length === 1 && row[0].rect.width < list.width - 8);
  if (splitRow) {
    row.sort((a, b) => a.rect.left - b.rect.left);
    const target = row.find(({ rect }) => clientX < rect.left + rect.width / 2);
    const last = row[row.length - 1];
    const beforeId = target ? target.id : items[items.indexOf(last) + 1]?.id ?? null;
    const lineX = target ? target.rect.left - 3 * scale : last.rect.right + 3 * scale;
    const top = Math.min(...row.map(({ rect }) => rect.top));
    const bottom = Math.max(...row.map(({ rect }) => rect.bottom));
    return {
      beforeId,
      vertical: true,
      left: local(lineX, articleRect.left),
      top: local(top, articleRect.top),
      height: (bottom - top) / scale,
    };
  }

  const index = items.findIndex(({ rect }) => clientY < rect.top + rect.height / 2);
  const beforeId = index < 0 ? null : items[index].id;
  let lineY;
  if (!items.length) {
    lineY = articleRect.top + 48 * scale;
  } else if (index === 0) {
    lineY = items[0].rect.top - 4 * scale;
  } else if (index < 0) {
    lineY = items[items.length - 1].rect.bottom + 4 * scale;
  } else {
    lineY = (items[index - 1].rect.bottom + items[index].rect.top) / 2;
  }
  return {
    beforeId,
    vertical: false,
    top: local(lineY, articleRect.top),
    left: local(list.left, articleRect.left),
    width: list.width / scale,
  };
}

// 이동하지 않는 위치인지(자기 바로 다음 요소 앞)
function isSamePosition(blockId, beforeId) {
  const flow = props.blocks.filter((block) => !isFree(block));
  const index = flow.findIndex((block) => block.id === blockId);
  return (flow[index + 1]?.id ?? null) === beforeId;
}

// ---------- 기존 요소 이동 (포인터 드래그) ----------

function snapshotElement(element) {
  const clone = element.cloneNode(true);
  const sourceInputs = element.querySelectorAll("input");
  clone.querySelectorAll("input").forEach((input, index) => {
    input.setAttribute("value", sourceInputs[index]?.value ?? "");
    input.setAttribute("tabindex", "-1");
  });
  clone.querySelectorAll(".element-drag-handle, .element-tag, .canvas-cell-toolbar, .resize-handle, .resize-hint, .table-col-resizer, .table-row-resizer").forEach((node) => node.remove());
  return clone.innerHTML;
}

function beginElementDrag(block, event) {
  if (!props.interactive || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  emit("select", block.id);
  const scroller = articleRef.value?.closest(".canvas-scroll") ?? null;
  const element = event.currentTarget.closest("[data-report-block-id]");
  const scale = getScale();
  const articleRect = articleRef.value.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  dragState = {
    id: block.id,
    type: block.type,
    free: isFree(block),
    freeOrigin: isFree(block) ? { x: getLayout(block).x, y: getLayout(block).y } : null,
    html: snapshotElement(element),
    originTop: (elementRect.top - articleRect.top) / scale,
    originLeft: (elementRect.left - articleRect.left) / scale,
    width: elementRect.width / scale,
    originalIndex: props.blocks.findIndex((item) => item.id === block.id),
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    scroller,
    startScroll: scroller?.scrollTop ?? 0,
    active: false,
    insertion: null,
    frame: 0,
  };
  window.addEventListener("pointermove", handleDragMove);
  window.addEventListener("pointerup", handleDragEnd);
  window.addEventListener("pointercancel", cancelDrag);
  window.addEventListener("keydown", handleDragKeydown, true);
}

function handleDragMove(event) {
  if (!dragState) return;
  dragState.lastX = event.clientX;
  dragState.lastY = event.clientY;
  if (!dragState.active) {
    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
    if (distance < DRAG_START_DISTANCE) return;
    dragState.active = true;
    draggingId.value = dragState.id;
    document.body.classList.add("report-reordering");
    dragState.frame = requestAnimationFrame(autoScrollStep);
  }
  updateDragPosition();
}

function updateDragPosition() {
  if (!dragState?.active) return;
  const scale = getScale();
  const scrollDelta = (dragState.scroller?.scrollTop ?? 0) - dragState.startScroll;
  dragGhost.value = {
    type: dragState.type,
    html: dragState.html,
    width: dragState.width,
    left: dragState.originLeft + (dragState.lastX - dragState.startX) / scale,
    top: dragState.originTop + (dragState.lastY - dragState.startY + scrollDelta) / scale,
  };
  // 자유 배치 요소는 끌어 놓은 좌표로 옮긴다(안내선 없음).
  if (dragState.free) {
    dropIndicator.value = null;
    return;
  }
  const insertion = computeInsertion(dragState.lastX, dragState.lastY, dragState.id);
  // 원래 자리와 같으면 배치할 곳이 없는 것으로 보고 안내선을 숨긴다.
  dragState.insertion = insertion && !isSamePosition(dragState.id, insertion.beforeId) ? insertion : null;
  dropIndicator.value = dragState.insertion;
}

function autoScrollStep() {
  if (!dragState?.active) return;
  const scroller = dragState.scroller;
  if (scroller) {
    const rect = scroller.getBoundingClientRect();
    let speed = 0;
    if (dragState.lastY < rect.top + AUTO_SCROLL_EDGE) {
      speed = -AUTO_SCROLL_MAX_SPEED * Math.min(1, (rect.top + AUTO_SCROLL_EDGE - dragState.lastY) / AUTO_SCROLL_EDGE);
    } else if (dragState.lastY > rect.bottom - AUTO_SCROLL_EDGE) {
      speed = AUTO_SCROLL_MAX_SPEED * Math.min(1, (dragState.lastY - rect.bottom + AUTO_SCROLL_EDGE) / AUTO_SCROLL_EDGE);
    }
    if (speed) {
      scroller.scrollTop += speed;
      updateDragPosition();
    }
  }
  dragState.frame = requestAnimationFrame(autoScrollStep);
}

function handleDragEnd() {
  if (!dragState) return;
  const { active, insertion, id, free, freeOrigin } = dragState;
  const ghost = dragGhost.value;
  stopDrag();
  if (!active) return;
  if (free && ghost) {
    // 용지 밖으로 완전히 나가지 않게 제한한다.
    emit("layout-update", {
      blockId: id,
      layout: {
        x: Math.round(Math.min(560, Math.max(-ghost.width + 24, ghost.left))),
        y: Math.round(Math.min(820, Math.max(0, ghost.top))),
      },
      from: freeOrigin,
    });
  } else if (insertion) {
    emit("reorder", { id, beforeId: insertion.beforeId });
  }
}

function handleDragKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelDrag();
  }
}

function cancelDrag() {
  stopDrag();
}

function stopDrag() {
  if (dragState?.frame) cancelAnimationFrame(dragState.frame);
  dragState = null;
  draggingId.value = "";
  dragGhost.value = null;
  dropIndicator.value = null;
  document.body.classList.remove("report-reordering");
  window.removeEventListener("pointermove", handleDragMove);
  window.removeEventListener("pointerup", handleDragEnd);
  window.removeEventListener("pointercancel", cancelDrag);
  window.removeEventListener("keydown", handleDragKeydown, true);
}

// 키보드로도 이동할 수 있게 한다.
// 영역 배치: ↑/↓ 로 순서 이동. 자유 배치: 방향키로 1px(Shift 10px) 이동.
function handleHandleKeydown(block, event) {
  if (isFree(block)) {
    const step = event.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const layout = getLayout(block);
    emit("layout-update", { blockId: block.id, layout: { x: layout.x + delta[0], y: Math.max(0, layout.y + delta[1]) } });
    return;
  }
  const flow = props.blocks.filter((item) => !isFree(item));
  const index = flow.findIndex((item) => item.id === block.id);
  if (event.key === "ArrowUp" && index > 0) {
    event.preventDefault();
    emit("reorder", { id: block.id, beforeId: flow[index - 1].id });
  } else if (event.key === "ArrowDown" && index < flow.length - 1) {
    event.preventDefault();
    emit("reorder", { id: block.id, beforeId: flow[index + 2]?.id ?? null });
  }
}

function elementStyle(block) {
  const style = { textAlign: block.align, fontSize: `${block.fontSize}px` };
  const layout = getLayout(block);
  if (layout.h && heightTarget(block) === "layout") style.minHeight = `${layout.h}px`;
  if (layout.mode === "free") {
    return {
      ...style,
      position: "absolute",
      left: `${layout.x}px`,
      top: `${layout.y}px`,
      width: `${layout.w}px`,
      zIndex: layout.wrap === "behind" ? 0 : 3 + layout.z,
      margin: 0,
    };
  }
  return { ...style, flex: `0 0 ${layout.width}%`, maxWidth: `${layout.width}%` };
}

// ---------- 크기 조정 핸들 ----------
// width: 영역 배치 너비(%) 또는 자유 배치 너비(px), height: 차트 높이, corner: 도형 크기

let resizeState = null;

function beginResize(block, kind, event) {
  if (!designMode.value || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const element = event.currentTarget.closest("[data-report-block-id]");
  const list = articleRef.value.querySelector(".report-block-list");
  const scale = getScale();
  const elementRect = element.getBoundingClientRect();
  // 요소 테두리 안쪽 여백(위아래)을 빼야 min-height 와 화면 높이가 맞는다.
  const computed = getComputedStyle(element);
  const verticalPadding = (parseFloat(computed.paddingTop) || 0) + (parseFloat(computed.paddingBottom) || 0)
    + (parseFloat(computed.borderTopWidth) || 0) + (parseFloat(computed.borderBottomWidth) || 0);
  resizeState = {
    block,
    kind,
    startX: event.clientX,
    startY: event.clientY,
    scale,
    elementLeft: elementRect.left,
    listWidth: list.getBoundingClientRect().width,
    startHeight: Number(block.chart?.height) || 260,
    startShape: { width: Number(block.shape?.width) || 160, height: Number(block.shape?.height) || 90 },
    startFreeWidth: getLayout(block).w,
    // 높이를 처음 조정할 때는 지금 보이는 높이에서 시작한다.
    startBlockHeight: getLayout(block).h ?? Math.round(elementRect.height / scale - verticalPadding),
    verticalPadding,
  };
  resizeHint.value = { blockId: block.id, text: "" };
  document.body.classList.add(kind === "height" ? "report-resizing-row" : kind === "width" ? "report-resizing-col" : "report-resizing-corner");
  window.addEventListener("pointermove", handleResizeMove);
  window.addEventListener("pointerup", endResize);
  window.addEventListener("pointercancel", endResize);
}

function handleResizeMove(event) {
  if (!resizeState) return;
  const { block, kind, scale } = resizeState;
  const dx = (event.clientX - resizeState.startX) / scale;
  const dy = (event.clientY - resizeState.startY) / scale;
  const hints = [];
  if (kind === "width" || kind === "both") {
    if (isFree(block)) {
      const w = Math.round(Math.min(pageDimensions.value.widthPt, Math.max(40, resizeState.startFreeWidth + dx)));
      emit("layout-update", { blockId: block.id, layout: { w } });
      hints.push(`너비 ${w}px`);
    } else {
      const widthPx = event.clientX - resizeState.elementLeft;
      const width = snapWidth((widthPx / resizeState.listWidth) * 100);
      emit("layout-update", { blockId: block.id, layout: { width } });
      hints.push(`너비 ${Math.round(width * 10) / 10}%`);
    }
  }
  if (kind === "height" || kind === "both") {
    const target = heightTarget(block);
    if (target === "chart") {
      const height = Math.round(Math.min(800, Math.max(100, resizeState.startHeight + dy)));
      emit("layout-update", { blockId: block.id, chartHeight: height });
      hints.push(`높이 ${height}px`);
    } else if (target === "shape") {
      const height = Math.round(Math.min(800, Math.max(4, resizeState.startShape.height + dy)));
      emit("layout-update", { blockId: block.id, shapeSize: { width: Number(block.shape?.width) || resizeState.startShape.width, height } });
      hints.push(`높이 ${height}px`);
    } else if (target === "layout") {
      const height = clampHeight(resizeState.startBlockHeight + dy);
      emit("layout-update", { blockId: block.id, layout: { h: height } });
      hints.push(`높이 ${height}px`);
    }
  }
  if (hints.length) resizeHint.value = { blockId: block.id, text: hints.join(" × ") };
  if (kind === "corner") {
    emit("layout-update", {
      blockId: block.id,
      shapeSize: {
        width: Math.round(Math.min(pageDimensions.value.widthPt, Math.max(8, resizeState.startShape.width + dx))),
        height: Math.round(Math.min(800, Math.max(4, resizeState.startShape.height + dy))),
      },
    });
  }
}

function endResize() {
  resizeState = null;
  resizeHint.value = null;
  document.body.classList.remove("report-resizing-row", "report-resizing-col", "report-resizing-corner");
  window.removeEventListener("pointermove", handleResizeMove);
  window.removeEventListener("pointerup", endResize);
  window.removeEventListener("pointercancel", endResize);
}

// ---------- 표 열 너비 · 행 높이 조정 ----------
// 셀 오른쪽 경계를 끌면 그 열과 오른쪽 열의 너비가, 아래쪽 경계를 끌면 그 행의 높이가 바뀐다.
// 두 번 누르면 원래대로(열: 모두 같은 너비, 행: 기본 높이) 돌린다.

function tableRowStyle(row) {
  const height = rowHeight(row);
  return height ? { height: `${height}px` } : undefined;
}

// 화면에 그린 행 번호 → block.rows 의 행 번호. 예전 열 연결 방식은 제목행을 먼저 그린다.
function sourceRowIndex(block, renderedIndex) {
  const rows = block.rows ?? [];
  const binding = block.dataBinding;
  if (!binding?.enabled || hasCellFields(block)) {
    return renderedIndex < rows.length ? renderedIndex : -1;
  }
  const ordered = [...rows.filter((row) => row.isTitleRow), ...rows.filter((row) => !row.isTitleRow)];
  const row = ordered[renderedIndex];
  return row ? rows.indexOf(row) : -1;
}

function cellRightBoundary(block, rowIndex, cellIndex) {
  const colspan = cellMerge(block, rowIndex, cellIndex)?.colspan || 1;
  const boundary = cellIndex + colspan - 1;
  return boundary < (block.columns?.length ?? 0) - 1 ? boundary : -1;
}

function cellBottomBoundary(block, rowIndex, cellIndex) {
  const rowspan = cellMerge(block, rowIndex, cellIndex)?.rowspan || 1;
  const boundary = rowIndex + rowspan - 1;
  return sourceRowIndex(block, boundary) >= 0 ? boundary : -1;
}

let tableResizeState = null;

function beginTableResize(block, kind, boundary, event) {
  if (!designMode.value || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  emit("select", block.id);
  const table = event.currentTarget.closest("table");
  const scale = getScale();
  if (kind === "column") {
    tableResizeState = {
      block,
      kind,
      boundary,
      startX: event.clientX,
      tableWidth: table.getBoundingClientRect().width,
      startWidths: resolvedColumnWidths(block),
    };
  } else {
    const sourceIndex = sourceRowIndex(block, boundary);
    if (sourceIndex < 0) return;
    const tr = table.rows[boundary];
    tableResizeState = {
      block,
      kind,
      sourceIndex,
      startY: event.clientY,
      scale,
      startHeight: rowHeight(block.rows[sourceIndex]) ?? tr.getBoundingClientRect().height / scale,
    };
  }
  resizeHint.value = { blockId: block.id, text: "" };
  document.body.classList.add(kind === "row" ? "report-resizing-row" : "report-resizing-col");
  window.addEventListener("pointermove", handleTableResizeMove);
  window.addEventListener("pointerup", endTableResize);
  window.addEventListener("pointercancel", endTableResize);
}

function handleTableResizeMove(event) {
  const state = tableResizeState;
  if (!state) return;
  if (state.kind === "column") {
    const deltaPercent = ((event.clientX - state.startX) / state.tableWidth) * 100;
    const widths = moveColumnBoundary(state.startWidths, state.boundary, deltaPercent);
    emit("table-resize", { blockId: state.block.id, columnWidths: widths });
    resizeHint.value = {
      blockId: state.block.id,
      text: `${state.boundary + 1}열 ${Math.round(widths[state.boundary])}% · ${state.boundary + 2}열 ${Math.round(widths[state.boundary + 1])}%`,
    };
  } else {
    const height = clampRowHeight(state.startHeight + (event.clientY - state.startY) / state.scale);
    emit("table-resize", { blockId: state.block.id, row: state.sourceIndex, height });
    resizeHint.value = { blockId: state.block.id, text: `${state.sourceIndex + 1}행 높이 ${height}px` };
  }
}

function endTableResize() {
  tableResizeState = null;
  if (resizeHint.value && !resizeState) resizeHint.value = null;
  document.body.classList.remove("report-resizing-row", "report-resizing-col");
  window.removeEventListener("pointermove", handleTableResizeMove);
  window.removeEventListener("pointerup", endTableResize);
  window.removeEventListener("pointercancel", endTableResize);
}

function resetTableSize(block, kind, boundary) {
  if (!designMode.value) return;
  if (kind === "column") {
    emit("table-resize", { blockId: block.id, columnWidths: null });
  } else {
    const sourceIndex = sourceRowIndex(block, boundary);
    if (sourceIndex >= 0) emit("table-resize", { blockId: block.id, row: sourceIndex, height: null });
  }
}

function widthLabel(block) {
  const layout = getLayout(block);
  return layout.mode === "free" ? `${layout.w}px` : `${Math.round(layout.width * 10) / 10}%`;
}

function sizeLabel(block) {
  const layout = getLayout(block);
  const parts = [];
  if (isFree(block) || layout.width < 100) parts.push(widthLabel(block));
  if (layout.h && heightTarget(block) === "layout") parts.push(`높이 ${layout.h}px`);
  return parts.join(" · ");
}

// 높이 핸들을 두 번 클릭하면 내용에 맞춘 자동 높이로 되돌린다.
function resetHeight(block) {
  if (heightTarget(block) === "layout" && getLayout(block).h) {
    emit("layout-update", { blockId: block.id, layout: { h: null } });
  }
}

function ghostStyle() {
  const ghost = dragGhost.value;
  const block = props.blocks.find((item) => item.id === draggingId.value);
  // 요소 자체의 위치(자유 배치 좌표)·너비 비율보다 마우스를 따라가는 위치가 우선한다.
  return {
    ...(block ? elementStyle(block) : {}),
    position: "absolute",
    top: `${ghost.top}px`,
    left: `${ghost.left}px`,
    width: `${ghost.width}px`,
    maxWidth: "none",
    flex: "none",
    zIndex: 20,
  };
}

// ---------- 보고서 항목 툴바에서 새 요소 끌어다 놓기 ----------

function hasBlockDragType(event) {
  return [...(event.dataTransfer?.types ?? [])].includes(BLOCK_DRAG_TYPE);
}

function handleInsertDragOver(event) {
  if (!designMode.value || !hasBlockDragType(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  dropIndicator.value = computeInsertion(event.clientX, event.clientY, null);
}

function handleInsertDragLeave(event) {
  if (!articleRef.value?.contains(event.relatedTarget)) {
    dropIndicator.value = null;
  }
}

function handleInsertDrop(event) {
  if (!designMode.value || !hasBlockDragType(event)) return;
  event.preventDefault();
  event.stopPropagation();
  const type = event.dataTransfer.getData(BLOCK_DRAG_TYPE);
  const insertion = computeInsertion(event.clientX, event.clientY, null);
  dropIndicator.value = null;
  if (type && insertion) {
    emit("insert-drop", { type, beforeId: insertion.beforeId });
  }
}

onUnmounted(() => {
  stopDrag();
  endResize();
  endTableResize();
});
</script>

<template>
  <article
    ref="articleRef"
    class="report"
    :class="{ 'report-daily': reportType === 'daily', 'report-is-reordering': Boolean(draggingId), 'report-show-boundaries': showBoundaries }"
    :style="pageStyle"
    aria-label="보고서 미리보기"
    @dragover="handleInsertDragOver"
    @dragleave="handleInsertDragLeave"
    @drop="handleInsertDrop"
  >
    <div
      v-for="kind in ['header', 'footer']"
      v-show="showArea(kind)"
      :key="kind"
      class="report-hf"
      :class="[
        `report-hf-${kind}`,
        {
          'report-hf-editable': designMode,
          'report-hf-empty': !hasContent(areaSlots(kind)),
          'report-hf-divider': areaHasDivider(kind),
        },
      ]"
      :style="areaStyle(kind)"
      :title="designMode ? `${kind === 'header' ? '머리글' : '바닥글'} — 두 번 클릭하여 편집` : undefined"
      @dblclick.stop="designMode && emit('edit-header-footer', kind)"
    >
      <span class="report-hf-left">{{ areaSlots(kind).left }}</span>
      <span class="report-hf-center">{{ areaSlots(kind).center }}</span>
      <span class="report-hf-right">{{ areaSlots(kind).right }}</span>
      <em v-if="designMode && !hasContent(areaSlots(kind))" class="report-hf-placeholder">
        {{ kind === "header" ? "머리글" : "바닥글" }} — 두 번 클릭하여 편집
      </em>
    </div>
    <div
      v-if="interactive && dropIndicator"
      class="report-drop-indicator"
      :class="{ 'report-drop-indicator-vertical': dropIndicator.vertical }"
      :style="dropIndicator.vertical
        ? { top: `${dropIndicator.top}px`, left: `${dropIndicator.left}px`, height: `${dropIndicator.height}px` }
        : { top: `${dropIndicator.top}px`, left: `${dropIndicator.left}px`, width: `${dropIndicator.width}px` }"
      aria-hidden="true"
    ></div>
    <!-- eslint-disable-next-line vue/no-v-html -- 같은 컴포넌트가 렌더링한 요소의 복제본 -->
    <div
      v-if="interactive && dragGhost"
      class="report-element report-drag-ghost"
      :class="`report-element-${dragGhost.type}`"
      :style="ghostStyle()"
      aria-hidden="true"
      v-html="dragGhost.html"
    ></div>
    <TransitionGroup tag="div" name="report-block" class="report-block-list">
      <div
        v-for="(block, index) in renderBlocks"
        :key="block.id"
        class="report-element"
        :class="[
          `report-element-${block.type}`,
          ...layoutClass(block),
          {
            'report-element-selected': interactive && selectedId === block.id,
            'report-element-dragging': draggingId === block.id,
          },
        ]"
        :data-report-block-id="block.id"
        :data-layout="isFree(block) ? 'free' : 'flow'"
        :style="elementStyle(block)"
        :role="interactive ? 'button' : undefined"
        :tabindex="interactive ? 0 : undefined"
        :aria-label="interactive ? `${blockLabel(block)} 선택` : undefined"
        :aria-pressed="interactive ? selectedId === block.id : undefined"
        @click="interactive && emit('select', block.id)"
        @keydown="handleElementKeydown(block, $event)"
      >
      <button
        v-if="designMode && selectedId === block.id"
        class="element-drag-handle"
        type="button"
        :aria-label="`${blockLabel(block)} 요소 이동 (드래그하거나 ↑/↓ 키)`"
        title="드래그하여 요소 이동 · ↑/↓ 키로도 이동"
        @click.stop
        @pointerdown="beginElementDrag(block, $event)"
        @keydown.enter.stop
        @keydown.space.stop
        @keydown="handleHandleKeydown(block, $event)"
      >⠿</button>
      <h1 v-if="block.type === 'title'">
        <ReportText
          :value="canEdit(block, 'content') ? block.content : boundField(block, 'content') || '제목 없는 보고서'"
          :text-style="textCss(block)"
          :editable="canEdit(block, 'content')"
          placeholder="제목"
          @update="emitField(block, 'content', $event)"
        />
      </h1>
      <p v-else-if="block.type === 'date'" class="report-date">
        <span v-if="valuesEditable && selectedId === block.id" class="report-inline-fields" @click.stop>
          <input
            class="report-inline-input"
            type="date"
            :value="toDateInput(block.date ?? props.date)"
            aria-label="작성일"
            @change="emitField(block, 'date', $event.target.value)"
          />
        </span>
        <ReportText v-else :value="formattedDate(boundField(block, 'date', block.date ?? props.date))" :text-style="textCss(block)" />
      </p>
      <p v-else-if="block.type === 'period'" class="report-period">
        <span v-if="valuesEditable && selectedId === block.id" class="report-inline-fields" @click.stop>
          <input
            class="report-inline-input"
            type="datetime-local"
            :value="toDateTimeInput(block.start)"
            aria-label="기간 시작"
            @change="emitField(block, 'start', $event.target.value)"
          />
          ~
          <input
            class="report-inline-input"
            type="datetime-local"
            :value="toDateTimeInput(block.end)"
            aria-label="기간 종료"
            @change="emitField(block, 'end', $event.target.value)"
          />
        </span>
        <ReportText v-else :value="`${formatPeriod(boundField(block, 'start'))} ~ ${formatPeriod(boundField(block, 'end'))}`" :text-style="textCss(block)" />
      </p>
      <h2 v-else-if="block.type === 'subheading'" class="report-subheading">
        <ReportText
          :value="boundField(block, 'content')"
          :text-style="textCss(block)"
          :editable="canEdit(block, 'content')"
          placeholder="구분 제목"
          @update="emitField(block, 'content', $event)"
        />
      </h2>
      <div v-else-if="block.type === 'table'" class="report-table-content">
        <p v-if="designMode && isRepeatingTable(block)" class="table-repeat-badge">
          ⟳ 표 반복 · 조회 결과 한 행마다 표 하나
        </p>
        <h3 v-if="!block.repeatIndex || boundField(block, 'heading')">
          <ReportText
            :value="boundField(block, 'heading')"
            :editable="canEdit(block, 'heading')"
            placeholder="표 제목"
            @update="emitField(block, 'heading', $event)"
          />
        </h3>
        <p v-if="showOptionalField(block, boundField(block, 'unit'))" class="table-unit">
          <ReportText
            :value="boundField(block, 'unit')"
            :editable="canEdit(block, 'unit')"
            placeholder="단위"
            @update="emitField(block, 'unit', $event)"
          />
        </p>
        <div
          v-if="designMode && selectedId === block.id && selectedCells.length"
          class="canvas-cell-toolbar"
          @pointerdown.stop
          @click.stop
        >
          <span>{{ selectedCells.length }}개 셀 선택</span>
          <label>
            <span>음영</span>
            <input
              type="color"
              :value="selectedCells.length === 1
              ? tableRows(block)[selectedCells[0].row]?.cellStyles?.[selectedCells[0].column]?.backgroundColor || block.columnStyles?.[selectedCells[0].column]?.backgroundColor || '#ffffff'
                : '#ffffff'"
              aria-label="선택 셀 음영색"
              @input="emit('cell-shade', $event.target.value)"
            />
          </label>
          <button type="button" @click="emit('cell-shade', '')"><ActionIcon name="clear" />음영 지우기</button>
          <button
            type="button"
            :disabled="!canMergeCells"
            @click="emit('cell-merge')"
          ><ActionIcon name="merge" />셀 합치기</button>
          <button
            type="button"
            :disabled="!canUnmergeCells"
            @click="emit('cell-unmerge')"
          ><ActionIcon name="unmerge" />병합 해제</button>
        </div>
        <table class="daily-table">
          <colgroup v-if="getColumnWidths(block)">
            <col
              v-for="(width, columnIndex) in getColumnWidths(block)"
              :key="columnIndex"
              :style="{ width: `${width}%` }"
            />
          </colgroup>
          <tbody>
            <tr
              v-for="(row, rowIndex) in tableRows(block)"
              :key="rowIndex"
              :class="{ 'report-table-title-row': row.isTitleRow, 'report-table-row-sized': Boolean(tableRowStyle(row)) }"
              :style="tableRowStyle(row)"
            >
              <template v-for="(cell, cellIndex) in row.cells" :key="cellIndex">
                <td
                  v-if="!isCellCovered(block, rowIndex, cellIndex)"
                  :colspan="cellMerge(block, rowIndex, cellIndex)?.colspan || 1"
                  :rowspan="cellMerge(block, rowIndex, cellIndex)?.rowspan || 1"
                  :style="cellStyle(block, row, cellIndex)"
                  :class="{
                    'trend-negative': cell.startsWith('▼'),
                    'trend-positive': cell.startsWith('▲'),
                    'report-cell-selected': interactive && selectedId === block.id && isCellSelected(rowIndex, cellIndex),
                    'report-cell-drop-target': fieldDropTarget === `${block.id}:${rowIndex}:${cellIndex}`,
                    'report-cell-repeat': designMode && block.dataBinding?.enabled && row.repeat && !block.dataBinding.repeatTable,
                  }"
                  @pointerdown="interactive && handleCellPointerDown(block, rowIndex, cellIndex, $event)"
                  @pointerenter="interactive && handleCellPointerEnter(rowIndex, cellIndex)"
                  @dragover="handleFieldDragOver(block, rowIndex, cellIndex, $event)"
                  @dragleave="handleFieldDragLeave"
                  @drop="handleFieldDrop(block, rowIndex, cellIndex, $event)"
                >
                  <span
                    v-if="designMode && cellField(block, row, cellIndex)"
                    class="report-cell-field"
                    :style="cellTextCss(row, cellIndex)"
                    :title="`DB 필드 ‘${cellField(block, row, cellIndex)}’ — 조회 결과 값이 들어갑니다`"
                    @click.stop="emit('select', block.id)"
                  >
                    <b>{{ cellField(block, row, cellIndex) }}</b>
                    <button
                      type="button"
                      :aria-label="`${cellField(block, row, cellIndex)} 필드 연결 해제`"
                      title="필드 연결 해제"
                      @pointerdown.stop
                      @click.stop="emit('cell-field', { blockId: block.id, row: rowIndex, column: cellIndex, field: '' })"
                    >×</button>
                  </span>
                  <input
                    v-else-if="interactive"
                    class="report-cell-input"
                    :style="cellTextCss(row, cellIndex)"
                    :value="cell"
                    :aria-label="`표 ${rowIndex + 1}행 ${cellIndex + 1}열`"
                    :data-cell-block="block.id"
                    :data-row="rowIndex"
                    :data-column="cellIndex"
                    @keydown="handleCellKeydown(block, rowIndex, cellIndex, $event)"
                    :readonly="designMode && isBoundTableCell(block, row, cellIndex)"
                    :title="designMode && isBoundTableCell(block, row, cellIndex) ? '이 열은 DB 필드에 연결되어 있습니다. 제목행은 직접 편집할 수 있습니다.' : undefined"
                    @dragover="handleFieldDragOver(block, rowIndex, cellIndex, $event)"
                    @drop="handleFieldDrop(block, rowIndex, cellIndex, $event)"
                    @click.stop="emit('select', block.id)"
                    @pointerdown.stop="handleCellPointerDown(block, rowIndex, cellIndex, $event)"
                    @pointerenter="handleCellPointerEnter(rowIndex, cellIndex)"
                    @input="handleCellInput(block, rowIndex, cellIndex, $event)"
                  />
                  <span v-else class="report-text" :style="cellTextCss(row, cellIndex)">{{ cell }}</span>
                  <button
                    v-if="showRowRepeatToggle(block, row) && cellIndex === lastVisibleColumn(block, rowIndex, row)"
                    class="row-repeat-toggle"
                    :class="{ 'row-repeat-toggle-on': row.repeat }"
                    type="button"
                    :aria-pressed="Boolean(row.repeat)"
                    :title="row.repeat ? '이 행을 조회 결과 행 수만큼 반복합니다 (누르면 해제)' : '이 행을 조회 결과 행 수만큼 반복'"
                    @pointerdown.stop
                    @click.stop="emit('row-repeat', { blockId: block.id, row: rowIndex, repeat: !row.repeat })"
                  >⟳ {{ row.repeat ? "행 반복" : "반복" }}</button>
                  <template v-if="designMode">
                    <span
                      v-if="cellRightBoundary(block, rowIndex, cellIndex) >= 0"
                      class="table-col-resizer"
                      title="끌어서 열 너비 조정 · 두 번 누르면 같은 너비로"
                      @pointerdown="beginTableResize(block, 'column', cellRightBoundary(block, rowIndex, cellIndex), $event)"
                      @click.stop
                      @dblclick.stop="resetTableSize(block, 'column')"
                    />
                    <span
                      v-if="cellBottomBoundary(block, rowIndex, cellIndex) >= 0"
                      class="table-row-resizer"
                      title="끌어서 행 높이 조정 · 두 번 누르면 기본 높이로"
                      @pointerdown="beginTableResize(block, 'row', cellBottomBoundary(block, rowIndex, cellIndex), $event)"
                      @click.stop
                      @dblclick.stop="resetTableSize(block, 'row', cellBottomBoundary(block, rowIndex, cellIndex))"
                    />
                  </template>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
        <div v-if="block.definitions" class="table-definitions">
          <p v-for="(definition, definitionIndex) in block.definitions" :key="definitionIndex">
            · <ReportText
              :value="definition"
              :editable="canEdit(block, 'definitions')"
              placeholder="설명"
              @update="emitField(block, 'definitions', $event, definitionIndex)"
            />
          </p>
        </div>
        <p v-if="showOptionalField(block, tableSummary(block))" class="table-summary">
          <ReportText
            :value="canEdit(block, 'summary') ? block.summary : tableSummary(block)"
            :editable="canEdit(block, 'summary')"
            multiline
            placeholder="요약"
            @update="emitField(block, 'summary', $event)"
          />
        </p>
      </div>
      <div v-else-if="block.type === 'special'" class="report-special">
        <h3>
          <ReportText
            :value="boundField(block, 'heading')"
            :text-style="textCss(block)"
            :editable="canEdit(block, 'heading')"
            placeholder="특이사항 제목"
            @update="emitField(block, 'heading', $event)"
          />
        </h3>
        <p>
          <ReportText
            :value="boundField(block, 'content')"
            :text-style="textCss(block)"
            :editable="canEdit(block, 'content')"
            multiline
            placeholder="특이사항 내용"
            @update="emitField(block, 'content', $event)"
          />
        </p>
      </div>
      <hr v-else-if="block.type === 'divider'" />
      <figure v-else-if="block.type === 'image'" class="report-image">
        <img
          v-if="block.image?.src"
          :src="block.image.src"
          :alt="block.image.alt || block.content || ''"
          :class="{ 'report-image-bordered': block.image.border }"
          :style="{ width: `${Math.min(100, Math.max(5, Number(block.image.widthPercent) || 100))}%` }"
          draggable="false"
        />
        <div v-else class="report-image-placeholder">
          <span>그림이 없습니다</span>
          <small>{{ designMode ? "속성 패널에서 ‘그림 선택’을 누르세요." : "" }}</small>
        </div>
        <figcaption v-if="showOptionalField(block, block.content)">
          <ReportText
            :value="block.content"
            :editable="canEdit(block, 'content')"
            placeholder="그림 설명"
            @update="emitField(block, 'content', $event)"
          />
        </figcaption>
      </figure>
      <div v-else-if="block.type === 'shape'" class="report-shape" :style="shapeBoxStyle(block)">
        <!-- eslint-disable-next-line vue/no-v-html -- shapeSvgMarkup 은 색·크기 값을 검사해 SVG 를 만든다 -->
        <span class="report-shape-svg" aria-hidden="true" v-html="shapeMarkup(block)"></span>
        <span v-if="block.content || valuesEditable || (designMode && selectedId === block.id)" class="report-shape-text">
          <ReportText
            :value="block.content"
            :text-style="textCss(block)"
            :editable="canEdit(block, 'content')"
            multiline
            placeholder="도형 글자"
            @update="emitField(block, 'content', $event)"
          />
        </span>
        <span
          v-if="designMode && selectedId === block.id"
          class="resize-handle resize-handle-corner"
          :title="`도형 크기 (${block.shape?.width} × ${block.shape?.height})`"
          aria-hidden="true"
          @pointerdown="beginResize(block, 'corner', $event)"
          @click.stop
        ></span>
      </div>
      <div v-else-if="block.type === 'chart'" class="report-chart-block">
        <ReportChart :block="block" :interactive="interactive" />
        <button
          v-if="valuesEditable && selectedId === block.id"
          class="report-chart-edit"
          type="button"
          @click.stop="emit('chart-edit', block.id)"
        ><ActionIcon name="edit" />차트 데이터 수정</button>
      </div>
      <template v-else-if="block.type === 'section'">
        <h2>
          <ReportText
            :value="canEdit(block, 'heading') ? block.heading : boundField(block, 'heading') || '업무 항목'"
            :text-style="textCss(block)"
            :editable="canEdit(block, 'heading')"
            placeholder="업무 항목"
            @update="emitField(block, 'heading', $event)"
          />
        </h2>
        <p class="report-copy">
          <ReportText
            :value="boundField(block, 'content')"
            :text-style="textCss(block)"
            :editable="canEdit(block, 'content')"
            multiline
            placeholder="내용"
            @update="emitField(block, 'content', $event)"
          />
        </p>
      </template>
      <p v-else class="report-copy">
        <ReportText
          :value="boundField(block, 'content')"
          :text-style="textCss(block)"
          :editable="canEdit(block, 'content')"
          multiline
          placeholder="텍스트"
          @update="emitField(block, 'content', $event)"
        />
      </p>
      <span
        v-if="interactive && selectedId === block.id"
        class="element-tag"
      >{{ index + 1 }} · {{ blockLabel(block) }}<template v-if="designMode && sizeLabel(block)"> · {{ sizeLabel(block) }}</template></span>
      <span
        v-if="designMode && resizeHint?.blockId === block.id && resizeHint.text"
        class="resize-hint"
        aria-live="polite"
      >{{ resizeHint.text }}</span>
      <template v-if="designMode && selectedId === block.id">
        <span
          class="resize-handle resize-handle-width"
          :title="`너비 조정 (${widthLabel(block)})`"
          aria-hidden="true"
          @pointerdown="beginResize(block, 'width', $event)"
          @click.stop
        ></span>
        <span
          v-if="heightTarget(block)"
          class="resize-handle resize-handle-height"
          :title="heightTarget(block) === 'layout'
            ? `높이 조정 (${getLayout(block).h ? `${getLayout(block).h}px` : '자동'}) · 두 번 클릭하면 자동 높이`
            : `높이 조정 (${block.type === 'chart' ? block.chart?.height ?? 260 : block.shape?.height ?? 90}px)`"
          aria-hidden="true"
          @pointerdown="beginResize(block, 'height', $event)"
          @dblclick.stop="resetHeight(block)"
          @click.stop
        ></span>
        <span
          v-if="heightTarget(block) && block.type !== 'shape'"
          class="resize-handle resize-handle-both"
          title="너비·높이 함께 조정"
          aria-hidden="true"
          @pointerdown="beginResize(block, 'both', $event)"
          @dblclick.stop="resetHeight(block)"
          @click.stop
        ></span>
      </template>
      </div>
    </TransitionGroup>
  </article>
</template>
