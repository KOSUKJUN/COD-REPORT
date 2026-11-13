import { resolveChartData } from "./charts/chart-options.js";

function displayValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

// 값이 DB 필드에 연결되어 있는지(연결을 켜고 필드를 골랐는지) 알려 준다.
export function isFieldBound(block, target) {
  const binding = block?.dataBinding;
  return Boolean(binding?.enabled && binding?.mappings?.fields?.[target]);
}

export function getBoundFieldValue(block, target, fallback = "") {
  const binding = block.dataBinding;
  const source = binding?.mappings?.fields?.[target];
  const row = binding?.rows?.[0];
  if (
    binding?.enabled &&
    source &&
    row &&
    Object.hasOwn(row, source)
  ) {
    return displayValue(row[source]);
  }
  return fallback ?? "";
}

// 요약 문구의 {필드명} 을 요약 쿼리 결과 첫 행의 값으로 바꾼다.
// 결과가 없거나 필드가 없으면 showFieldNames 일 때는 {필드명} 그대로, 아니면 "-" 로 표시한다.
export function fillSummaryTemplate(template, row, { showFieldNames = false } = {}) {
  return String(template ?? "").replace(/\{([^{}\n]{1,64})\}/g, (token, name) => {
    const key = name.trim();
    if (row && Object.hasOwn(row, key)) return displayValue(row[key]);
    return showFieldNames ? token : "-";
  });
}

// 표 아래 요약: 요약 전용 쿼리가 켜져 있으면 그 결과로, 아니면 (예전 방식) 표 쿼리의 필드 연결 또는 직접 입력값.
export function getTableSummary(block, { showFieldNames = false } = {}) {
  const summaryBinding = block.summaryBinding;
  if (summaryBinding?.enabled) {
    const template = summaryBinding.template ?? block.summary ?? "";
    const row = summaryBinding.rows?.[0];
    if (!row && showFieldNames) return template;
    return fillSummaryTemplate(template, row, { showFieldNames });
  }
  return getBoundFieldValue(block, "summary", block.summary ?? "");
}

const BOUND_FIELDS = ["content", "heading", "unit", "start", "end", "date"];

// 리포트는 JSON 데이터이므로 JSON 복사를 쓴다. (structuredClone 은 Vue 반응형 프록시를 복사하지 못한다)
function plainCopy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// 리포트를 직접 수정할 수 있도록, 화면에 보이는 값(DB 바인딩 결과 포함)을 일반 값으로 고정한다.
// 반복 행·요약 문구도 보이는 그대로 복사하므로 고정 전후의 화면과 내보내기 결과는 같다.
// 원본 바인딩 설정(쿼리 등)은 기록으로 남기고 enabled 만 끈다.
export function materializeBlock(block, { reportDate } = {}) {
  const result = plainCopy(block);
  const binding = block.dataBinding;
  if (binding?.enabled) {
    for (const field of BOUND_FIELDS) {
      if (!binding.mappings?.fields?.[field]) continue;
      const fallback = field === "date" ? block.date ?? reportDate : block[field];
      result[field] = getBoundFieldValue(block, field, fallback);
    }
  }
  if (block.type === "table") {
    // 반복 행은 같은 셀 서식 객체를 공유하므로 행마다 따로 복사한다.
    result.rows = getTableRows(block).map((row) => plainCopy({
      ...row,
      cells: [...(row.cells ?? [])],
      cellStyles: (row.cellStyles ?? []).map((style) => ({ ...(style ?? {}) })),
    }));
    result.merges = plainCopy(getTableMerges(block));
    // 고정한 행에는 필드·반복 표시를 남기지 않는다(값이 그대로 들어간 일반 셀).
    for (const row of result.rows) {
      delete row.fields;
      delete row.repeat;
    }
    result.summary = getTableSummary(block);
    if (result.summaryBinding) result.summaryBinding.enabled = false;
  }
  if (block.type === "chart" && binding?.enabled) {
    // 차트도 조회 결과를 직접 입력 데이터로 고정한다.
    result.chartData = resolveChartData(block);
  }
  if (result.dataBinding) result.dataBinding.enabled = false;
  if (binding?.enabled || block.summaryBinding?.enabled) result.valuesMaterialized = true;
  return result;
}

// ---------- 표 반복 ----------
// 데이터 바인딩한 표에서 '표 반복'을 켜면 조회 결과 한 행마다 같은 모양의 표를 하나씩 아래로 이어서 만든다.
// 표 안의 필드 셀은 그 행의 값으로 채운다(표 반복일 때는 행 반복을 쓰지 않는다).
// 표 제목·단위는 첫 표에만(필드에 연결했으면 표마다 그 행의 값으로), 요약은 마지막 표에만 둔다.

export function isRepeatingTable(block) {
  return block?.type === "table" && Boolean(block.dataBinding?.enabled && block.dataBinding.repeatTable);
}

export function expandRepeatedTable(block) {
  if (!isRepeatingTable(block)) return [block];
  const records = Array.isArray(block.dataBinding.rows) ? block.dataBinding.rows : [];
  if (records.length === 0) return [block];
  const fields = block.dataBinding.mappings?.fields ?? {};
  const cellMode = hasCellFields(block);
  const titleRowCount = (block.rows ?? []).filter((row) => row.isTitleRow).length;
  return records.map((record, index) => {
    const first = index === 0;
    const last = index === records.length - 1;
    const copy = {
      ...block,
      id: first ? block.id : `${block.id}~${index + 1}`,
      repeatIndex: index,
      dataBinding: { ...block.dataBinding, rows: [record], repeatTable: false, repeatRows: true },
    };
    if (cellMode) {
      copy.rows = (block.rows ?? []).map((row) => (row.repeat ? { ...row, repeat: false } : row));
    } else {
      // 예전 열 연결 방식: 제목행 + 데이터 한 행
      copy.merges = (block.merges ?? []).filter((merge) => merge.row + (merge.rowspan || 1) <= titleRowCount + 1);
    }
    if (!first) {
      if (!fields.heading) copy.heading = "";
      if (!fields.unit) copy.unit = "";
      copy.definitions = undefined;
    }
    if (!last) {
      copy.summary = "";
      if (copy.summaryBinding) copy.summaryBinding = { ...copy.summaryBinding, enabled: false };
      if (fields.summary) copy.dataBinding.mappings = { ...copy.dataBinding.mappings, fields: { ...fields, summary: "" } };
    }
    return copy;
  });
}

export function expandRepeatedBlocks(blocks) {
  return (blocks ?? []).flatMap((block) => expandRepeatedTable(block));
}

export function materializeReport(report) {
  const source = plainCopy(report);
  const convert = (blocks) => expandRepeatedBlocks(blocks).map((block) => materializeBlock(block, { reportDate: source.date }));
  const copy = { ...source, blocks: convert(source.blocks) };
  if (Array.isArray(source.pages)) {
    copy.pages = source.pages.map((page) => ({ ...page, blocks: convert(page.blocks) }));
  }
  return copy;
}

function createTableRow(block, template = {}) {
  const columnCount = block.columns?.length ?? 0;
  return {
    cells: Array.from(
      { length: columnCount },
      (_, columnIndex) => template.cells?.[columnIndex] ?? "",
    ),
    cellStyles: Array.from(
      { length: columnCount },
      (_, columnIndex) => template.cellStyles?.[columnIndex] ?? {},
    ),
  };
}

function mapTableRow(block, row, resultRow, showMappedFieldNames) {
  const binding = block.dataBinding;
  return {
    ...row,
    cells: (block.columns ?? []).map((_, columnIndex) => {
      const source = binding.mappings?.columns?.[columnIndex];
      if (source && showMappedFieldNames) {
        return source;
      }
      if (source && resultRow && Object.hasOwn(resultRow, source)) {
        return displayValue(resultRow[source]);
      }
      return row.cells?.[columnIndex] ?? "";
    }),
  };
}

// ---------- 셀 필드 방식 ----------
// 필드 목록에서 표의 셀로 DB 필드를 끌어다 놓는다(row.fields[열] = 필드명).
// 한 행에 '이 행 반복'(row.repeat)을 켜면 그 행을 조회 결과 행 수만큼 이어서 만들고,
// 나머지 행의 필드는 조회 결과 첫 행 값으로 채운다.

export function hasCellFields(block) {
  return (block?.rows ?? []).some((row) => row.repeat || row.fields?.some(Boolean));
}

// 반복할 행 번호(없으면 -1). 표 반복(표 하나 = 조회 결과 한 행)일 때는 행 반복을 쓰지 않는다.
export function repeatRowIndex(block) {
  if (block?.dataBinding?.repeatTable) return -1;
  return (block?.rows ?? []).findIndex((row) => row.repeat);
}

function fillRowFields(row, record, showFieldNames) {
  if (!row.fields?.some(Boolean)) return row;
  return {
    ...row,
    cells: (row.cells ?? []).map((cell, columnIndex) => {
      const field = row.fields[columnIndex];
      if (!field) return cell;
      if (showFieldNames) return `{${field}}`;
      return record && Object.hasOwn(record, field) ? displayValue(record[field]) : "";
    }),
  };
}

function cellFieldRows(block, showFieldNames) {
  const rows = block.rows ?? [];
  const records = Array.isArray(block.dataBinding.rows) ? block.dataBinding.rows : [];
  const repeatIndex = repeatRowIndex(block);
  if (showFieldNames || repeatIndex < 0) {
    return rows.map((row) => fillRowFields(row, records[0], showFieldNames));
  }
  return [
    ...rows.slice(0, repeatIndex).map((row) => fillRowFields(row, records[0], false)),
    ...records.map((record) => fillRowFields(rows[repeatIndex], record, false)),
    ...rows.slice(repeatIndex + 1).map((row) => fillRowFields(row, records[0], false)),
  ];
}

// 화면에 그릴 행에 맞춘 셀 병합. 반복 행이 늘어나면 그 아래 병합을 내리고, 반복 행 안의 가로 병합은 행마다 복사한다.
export function getTableMerges(block) {
  const merges = block.merges ?? [];
  const binding = block.dataBinding;
  if (!binding?.enabled || !hasCellFields(block)) return merges;
  const repeatIndex = repeatRowIndex(block);
  if (repeatIndex < 0) return merges;
  const count = Array.isArray(binding.rows) ? binding.rows.length : 0;
  const result = [];
  for (const merge of merges) {
    const end = merge.row + (merge.rowspan || 1) - 1;
    if (end < repeatIndex) result.push(merge);
    else if (merge.row > repeatIndex) result.push({ ...merge, row: merge.row + count - 1 });
    else if (merge.row === repeatIndex && end === repeatIndex) {
      for (let index = 0; index < count; index += 1) result.push({ ...merge, row: repeatIndex + index });
    }
    // 반복 행에 걸친 세로 병합은 행 수가 달라지므로 풀어서 그린다.
  }
  return result;
}

export function getTableRows(block, { showMappedFieldNames = false } = {}) {
  const rows = block.rows ?? [];
  const binding = block.dataBinding;
  if (!binding?.enabled) {
    return rows;
  }
  if (hasCellFields(block)) {
    return cellFieldRows(block, showMappedFieldNames);
  }

  // 예전 방식: 열마다 필드를 연결(mappings.columns)하고 제목행을 뺀 데이터 행을 반복

  const titleRows = rows.filter((row) => row.isTitleRow);
  const dataRows = rows.filter((row) => !row.isTitleRow);
  const resultRows = Array.isArray(binding.rows) ? binding.rows : [];

  if (showMappedFieldNames) {
    // 표 반복은 양식 표의 데이터 행 서식을 모두 쓰므로 미리보기도 모든 데이터 행을 보여 준다.
    const repeatRows = binding.repeatRows && !binding.repeatTable;
    const previewRows = repeatRows ? dataRows.slice(0, 1) : dataRows;
    if (
      (repeatRows || binding.repeatTable) &&
      previewRows.length === 0 &&
      binding.mappings?.columns?.some(Boolean)
    ) {
      previewRows.push(createTableRow(block));
    }
    return [
      ...titleRows,
      ...previewRows.map((row) =>
        mapTableRow(block, row, undefined, true),
      ),
    ];
  }

  if (!binding.repeatRows) {
    return [
      ...titleRows,
      ...dataRows.map((row, rowIndex) =>
        mapTableRow(block, row, resultRows[rowIndex], false),
      ),
    ];
  }

  const templateRow = dataRows[0] ?? createTableRow(block);
  return [
    ...titleRows,
    ...resultRows.map((resultRow, rowIndex) =>
      mapTableRow(
        block,
        dataRows[rowIndex] ?? templateRow,
        resultRow,
        false,
      ),
    ),
  ];
}
