// 글꼴 도구(FontToolbar)로 요소 전체 또는 선택한 표 셀에 서식을 적용하는 로직.
// 에디터(양식 편집)와 뷰어(리포트 값 수정)가 함께 사용한다.
import { computed } from "vue";
import {
  applyTextStylePatch,
  changeTextCase,
  clearTextStyle,
  growFontSize,
  isDefaultBold,
  nextCycledCase,
  shrinkFontSize,
} from "../text-style.js";

// 대/소문자 바꾸기 등 텍스트 값 자체를 바꿀 때 대상이 되는 필드
export const TEXT_FIELDS_BY_TYPE = {
  title: ["content"],
  subheading: ["content"],
  text: ["content"],
  section: ["heading", "content"],
  special: ["heading", "content"],
  shape: ["content"],
};

// 글자가 없어 글꼴 서식을 적용할 수 없는 요소
const NON_TEXT_TYPES = {
  divider: "구분선",
  image: "그림",
  chart: "차트",
};

// 표의 행·셀·셀 서식 배열 길이를 열 수에 맞춘다.
export function ensureTableColumns(table) {
  table.columnStyles ??= [];
  table.merges ??= [];
  table.rows ??= [];
  table.columns ??= [];

  table.columnStyles.length = table.columns.length;
  table.columns.forEach((_, index) => {
    table.columnStyles[index] ??= { backgroundColor: "" };
    table.rows.forEach((row) => {
      row.cells ??= [];
      while (row.cells.length < table.columns.length) {
        row.cells.push("");
      }
      row.cells.splice(table.columns.length);
      row.cellStyles ??= [];
      row.cellStyles.length = table.columns.length;
      for (let cellIndex = 0; cellIndex < table.columns.length; cellIndex += 1) {
        row.cellStyles[cellIndex] ??= { backgroundColor: "" };
      }
      // 셀에 끌어다 놓은 DB 필드(없으면 "")
      if (Array.isArray(row.fields)) {
        row.fields.length = table.columns.length;
        for (let cellIndex = 0; cellIndex < table.columns.length; cellIndex += 1) row.fields[cellIndex] ??= "";
      }
    });
  });
}

function defaultBlockLabel(block) {
  const labels = {
    title: "제목",
    text: "텍스트",
    section: "업무 항목",
    table: "표",
    special: "특이사항",
    subheading: "구분 제목",
    period: "기간",
    date: "작성일",
    divider: "구분선",
    image: "그림",
    shape: "도형",
    chart: "차트",
  };
  return block.heading || block.content || labels[block.type] || "요소";
}

/**
 * @param {object} options
 * @param {import("vue").Ref} options.selectedBlock 선택된 요소
 * @param {import("vue").Ref} options.selectedCells 선택된 표 셀 [{ row, column }]
 * @param {import("vue").Ref} options.layoutType 보고서 레이아웃(daily/weekly/monthly)
 * @param {(block: object) => string} [options.blockLabel]
 */
export function useTextFormatting({ selectedBlock, selectedCells, layoutType, blockLabel = defaultBlockLabel }) {
  // 날짜·기간(일간)·특이사항은 CSS 고정 크기를 쓰므로 크기를 textStyle.fontSize 로 텍스트에 직접 적용한다.
  function getFixedFontSize(block) {
    if (block.type === "date") return 12;
    if (block.type === "special") return 8;
    if (block.type === "period" && layoutType.value === "daily") return 9;
    return null;
  }

  function getBlockFontSize(block) {
    const fixed = getFixedFontSize(block);
    return fixed === null ? block.fontSize : (block.textStyle?.fontSize ?? fixed);
  }

  function setBlockFontSize(block, size) {
    if (getFixedFontSize(block) === null) {
      block.fontSize = size;
    } else {
      block.textStyle ??= {};
      block.textStyle.fontSize = size;
    }
  }

  const fontFormatTarget = computed(() => {
    const block = selectedBlock.value;
    if (!block || NON_TEXT_TYPES[block.type]) return null;
    if (block.type === "table") {
      const cells = (selectedCells.value ?? []).filter(
        ({ row, column }) => block.rows?.[row] && column < (block.columns?.length ?? 0),
      );
      return cells.length ? { kind: "cells", block, cells } : null;
    }
    return { kind: "block", block };
  });

  const fontStyleState = computed(() => {
    const target = fontFormatTarget.value;
    if (!target) return {};
    if (target.kind === "block") {
      const style = target.block.textStyle ?? {};
      return {
        ...style,
        fontSize: getBlockFontSize(target.block),
        bold: style.bold ?? isDefaultBold(target.block.type),
        align: target.block.align || "left",
      };
    }
    const { row, column } = target.cells[0];
    const style = target.block.rows[row]?.cellStyles?.[column] ?? {};
    return {
      ...style,
      fontSize: style.fontSize ?? target.block.fontSize,
      bold: style.bold ?? false,
      align: style.textAlign || "center",
    };
  });

  const fontTargetLabel = computed(() => {
    const target = fontFormatTarget.value;
    if (!target) {
      const nonText = NON_TEXT_TYPES[selectedBlock.value?.type];
      return nonText
        ? `${nonText}에는 글꼴 서식을 적용할 수 없습니다`
        : "서식을 적용할 요소를 선택하세요";
    }
    if (target.kind === "cells") {
      return `적용 대상: 선택한 셀 ${target.cells.length}개`;
    }
    return `적용 대상: ${blockLabel(target.block)} (요소 전체)`;
  });

  function getFontStyleTargets() {
    const target = fontFormatTarget.value;
    if (!target) return [];
    if (target.kind === "block") {
      target.block.textStyle ??= {};
      return [{ style: target.block.textStyle, baseSize: target.block.fontSize, defaultBold: isDefaultBold(target.block.type) }];
    }
    ensureTableColumns(target.block);
    return target.cells.map(({ row, column }) => {
      const tableRow = target.block.rows[row];
      tableRow.cellStyles[column] ??= {};
      return { style: tableRow.cellStyles[column], baseSize: target.block.fontSize, defaultBold: false };
    });
  }

  function applyFontPatch(patch) {
    for (const { style } of getFontStyleTargets()) {
      applyTextStylePatch(style, patch);
    }
  }

  function toggleFontStyle(key) {
    const enabled = !fontStyleState.value[key];
    for (const { style, defaultBold } of getFontStyleTargets()) {
      if (key === "bold") {
        applyTextStylePatch(style, { bold: enabled === defaultBold ? undefined : enabled });
      } else {
        applyTextStylePatch(style, { [key]: enabled || undefined });
      }
      if (enabled && key === "border") delete style.enclosed;
      if (enabled && key === "enclosed") delete style.border;
    }
  }

  function setFontSize(size) {
    const target = fontFormatTarget.value;
    if (!target || !size) return;
    if (target.kind === "block") {
      setBlockFontSize(target.block, size);
      return;
    }
    for (const { style } of getFontStyleTargets()) {
      style.fontSize = size;
    }
  }

  function setTextAlignment(align) {
    const target = fontFormatTarget.value;
    if (!target) return;
    if (target.kind === "block") {
      target.block.align = align;
      return;
    }
    for (const { style } of getFontStyleTargets()) {
      // 표 셀의 기본 정렬은 가운데이므로 가운데는 별도 값으로 저장하지 않는다.
      applyTextStylePatch(style, { textAlign: align === "center" ? undefined : align });
    }
  }

  function stepFontSize(direction) {
    const target = fontFormatTarget.value;
    if (!target) return;
    const step = direction > 0 ? growFontSize : shrinkFontSize;
    if (target.kind === "block") {
      setBlockFontSize(target.block, step(getBlockFontSize(target.block)));
      return;
    }
    for (const { style, baseSize } of getFontStyleTargets()) {
      style.fontSize = step(style.fontSize ?? baseSize);
    }
  }

  function getSelectedTextEntries() {
    const target = fontFormatTarget.value;
    if (!target) return [];
    if (target.kind === "block") {
      return (TEXT_FIELDS_BY_TYPE[target.block.type] ?? []).map((field) => ({
        get: () => target.block[field],
        set: (value) => { target.block[field] = value; },
      }));
    }
    return target.cells.map(({ row, column }) => ({
      get: () => target.block.rows[row].cells[column],
      set: (value) => { target.block.rows[row].cells[column] = value; },
    }));
  }

  function changeSelectionCase(mode) {
    for (const entry of getSelectedTextEntries()) {
      const value = entry.get();
      if (typeof value === "string" && value) entry.set(changeTextCase(value, mode));
    }
  }

  function cycleSelectionCase() {
    const entries = getSelectedTextEntries();
    const sample = entries.map((entry) => entry.get()).find((value) => typeof value === "string" && /\p{L}/u.test(value));
    if (sample) changeSelectionCase(nextCycledCase(sample));
  }

  function clearFontFormatting() {
    const target = fontFormatTarget.value;
    if (!target) return;
    if (target.kind === "block") {
      delete target.block.textStyle;
      return;
    }
    for (const { style } of getFontStyleTargets()) {
      clearTextStyle(style);
    }
  }

  // 처리했으면 true (호출한 쪽에서 preventDefault)
  function handleFontShortcut(event) {
    if (!fontFormatTarget.value || event.altKey) return false;
    if (event.key === "F3" && event.shiftKey && !event.ctrlKey && !event.metaKey) {
      cycleSelectionCase();
      return true;
    }
    if (!(event.ctrlKey || event.metaKey)) return false;
    const key = event.key.toLowerCase();
    if (!event.shiftKey && key === "b") toggleFontStyle("bold");
    else if (!event.shiftKey && key === "i") toggleFontStyle("italic");
    else if (!event.shiftKey && key === "u") toggleFontStyle("underline");
    else if ((event.shiftKey && (key === ">" || key === ".")) || (!event.shiftKey && key === "]")) stepFontSize(1);
    else if ((event.shiftKey && (key === "<" || key === ",")) || (!event.shiftKey && key === "[")) stepFontSize(-1);
    else return false;
    return true;
  }

  // FontToolbar 이벤트에 바로 연결할 수 있는 핸들러 묶음
  const toolbarHandlers = {
    onApply: applyFontPatch,
    onToggle: toggleFontStyle,
    onFontSize: setFontSize,
    onGrow: () => stepFontSize(1),
    onShrink: () => stepFontSize(-1),
    onChangeCase: changeSelectionCase,
    onClear: clearFontFormatting,
    onAlign: setTextAlignment,
  };

  return {
    fontFormatTarget,
    fontStyleState,
    fontTargetLabel,
    applyFontPatch,
    toggleFontStyle,
    setFontSize,
    setTextAlignment,
    stepFontSize,
    changeSelectionCase,
    cycleSelectionCase,
    clearFontFormatting,
    handleFontShortcut,
    toolbarHandlers,
  };
}
