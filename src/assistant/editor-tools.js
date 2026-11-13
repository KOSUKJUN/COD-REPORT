// AI 어시스턴트가 호출하는 에디터 도구. 정의(ASSISTANT_TOOLS)는 모델에 그대로 전달되고,
// 실행(createToolExecutor)은 에디터가 넘겨준 context 함수만 사용하므로 화면 없이도 테스트할 수 있다.
import { CHART_CATEGORIES, CHART_PALETTES, createChartConfig, getChartVariant } from "../charts/chart-catalog.js";
import { SHAPES, createShapeConfig } from "../shapes.js";
import { PAPER_SIZES, normalizePageSetup, describePageSetup } from "../page-setup.js";
import { FOOTER_GALLERY, HEADER_GALLERY, PAGE_NUMBER_FORMATS, applyGallery, clearArea, insertPageNumber, normalizeHeaderFooter, removePageNumbers } from "../header-footer.js";
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "../text-style.js";

const BLOCK_TYPES = ["title", "subheading", "text", "section", "special", "table", "chart", "shape", "divider", "date", "period"];
const TEXT_TYPES = new Set(["title", "subheading", "text", "section", "special"]);
const CHART_TYPES = CHART_CATEGORIES.map((item) => item.id);
const SHAPE_KINDS = SHAPES.map((item) => item.id);
const COLOR = /^#[0-9a-f]{6}$/i;
const MAX_RESULT_CHARS = 6000;

const string = (description, extra = {}) => ({ type: "string", description, ...extra });
const number = (description) => ({ type: "number", description });
const integer = (description) => ({ type: "integer", description });
const boolean = (description) => ({ type: "boolean", description });
const stringGrid = (description) => ({ type: "array", description, items: { type: "array", items: { type: "string" } } });

// add_block / update_block 이 함께 쓰는 속성
const BLOCK_PROPERTIES = {
  content: string("Text for title/subheading/text/section/special/shape blocks. Use \\n for line breaks."),
  heading: string("Heading of section/special blocks, or the caption shown above a table."),
  font_size: number(`Font size in pt (${MIN_FONT_SIZE}-${MAX_FONT_SIZE}). Title default 27, body 14.`),
  align: string("Text alignment.", { enum: ["left", "center", "right"] }),
  bold: boolean("Bold text."),
  italic: boolean("Italic text."),
  underline: boolean("Underlined text."),
  color: string("Text color as #RRGGBB."),
  highlight: string("Text highlight color as #RRGGBB, or empty string to remove."),
  width_percent: number("Width in percent of the page row (10-100). Consecutive blocks whose widths sum to 100 or less are placed side by side, e.g. two charts at 50 each."),
  height: number("Minimum height in px (16-1200). Omit for automatic height."),
  rows: stringGrid("Table cells as rows of strings. Replaces the whole table. Every row should have the same number of cells (max 30 columns, 200 rows). For merged areas leave covered cells as \"\"."),
  header_rows: integer("Number of top table rows that are header (title) rows. Default 1 when rows are given."),
  merges: { type: "array", description: "Merged table cells (zero-based).", items: { type: "object", properties: { row: { type: "integer" }, column: { type: "integer" }, rowspan: { type: "integer" }, colspan: { type: "integer" } }, required: ["row", "column", "rowspan", "colspan"] } },
  cell_backgrounds: { type: "array", description: "Table cell background colors with the same shape as rows: #RRGGBB or \"\" for none. Cell text is always dark, so use light colors only. If omitted, header rows get a light blue fill.", items: { type: "array", items: { type: "string" } } },
  column_widths: { type: "array", description: "Relative table column widths in percent, one per column.", items: { type: "number" } },
  unit: string("Unit text shown at the top right of a table, e.g. \"단위: 천원\"."),
  chart_type: string("Chart type.", { enum: CHART_TYPES }),
  chart_variant: string("Chart variant, e.g. clustered/stacked/percent for column/bar, markers/smooth for line, doughnut for pie."),
  chart_title: string("Chart title. Empty string hides the title."),
  categories: { type: "array", description: "Chart category labels (x axis).", items: { type: "string" } },
  series: { type: "array", description: "Chart series; each values array must match categories in length.", items: { type: "object", properties: { name: { type: "string" }, values: { type: "array", items: { type: "number" } } }, required: ["name", "values"] } },
  chart_height: number("Chart height in px (120-900). Default 260."),
  palette: string("Chart color palette.", { enum: CHART_PALETTES.map((item) => item.id) }),
  legend: string("Chart legend position.", { enum: ["top", "bottom", "left", "right", "none"] }),
  show_labels: boolean("Show data labels on the chart."),
  shape_kind: string("Shape kind.", { enum: SHAPE_KINDS }),
  fill: string("Shape fill #RRGGBB or \"none\"."),
  stroke: string("Shape outline #RRGGBB or \"none\"."),
  shape_width: number("Shape width in px."),
  shape_height: number("Shape height in px."),
  start: string("Period block start, format YYYY-MM-DDTHH:MM."),
  end: string("Period block end, format YYYY-MM-DDTHH:MM."),
};

const tool = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});

const pageParam = integer("1-based page number. Defaults to the page currently shown.");

export const ASSISTANT_TOOLS = [
  tool("get_editor_state", "Read the open template: name, save state, paper setup, header/footer, every page with its blocks (id, type, label, width). Call this first when you need block ids."),
  tool("get_block", "Read every property of one block (table cells and bindings, chart data, text style).", { block_id: string("Block id.") }, ["block_id"]),
  tool("add_block", "Add a block to a page. Types: title (document title), subheading (section heading), text (paragraph), section (heading+content box), special (notes box), table, chart, shape, divider (horizontal line), date (report date), period (date range). Images cannot be added by the assistant.", {
    type: string("Block type.", { enum: BLOCK_TYPES }), page: pageParam,
    after_block_id: string("Insert after this block. Omit to append at the end of the page."),
    at_start: boolean("Insert at the top of the page instead of the end."),
    ...BLOCK_PROPERTIES,
  }, ["type"]),
  tool("add_blocks", "Add several blocks in the given order with ONE call. Preferred way to build or extend a template. Returns the new block ids in the same order. If any block is invalid nothing is added.", {
    page: pageParam,
    after_block_id: string("Insert after this existing block. Omit to append at the end of the page."),
    at_start: boolean("Insert at the top of the page."),
    blocks: { type: "array", description: "Blocks in display order. Each item takes the same properties as add_block.", items: { type: "object", properties: { type: string("Block type.", { enum: BLOCK_TYPES }), ...BLOCK_PROPERTIES }, required: ["type"] } },
  }, ["blocks"]),
  tool("update_block", "Change properties of an existing block. Only the given properties change. Passing rows replaces the whole table content.", { block_id: string("Block id."), ...BLOCK_PROPERTIES }, ["block_id"]),
  tool("set_table_cells", "Edit individual table cells without replacing the table.", {
    block_id: string("Table block id."),
    cells: { type: "array", items: { type: "object", properties: { row: integer("Zero-based row."), column: integer("Zero-based column."), text: string("New cell text."), background: string("Light #RRGGBB (cell text is always dark) or \"\" to clear."), align: string("Cell text alignment.", { enum: ["left", "center", "right"] }) }, required: ["row", "column"] } },
  }, ["block_id", "cells"]),
  tool("delete_block", "Delete a block.", { block_id: string("Block id.") }, ["block_id"]),
  tool("move_block", "Move a block to another position or page.", {
    block_id: string("Block id."), page: pageParam,
    before_block_id: string("Place before this block. Omit (and at_start false) to move to the end."),
    at_start: boolean("Move to the top of the page."),
  }, ["block_id"]),
  tool("select_block", "Select a block and show it to the user.", { block_id: string("Block id.") }, ["block_id"]),
  tool("add_page", "Add an empty page after the last page and show it."),
  tool("delete_page", "Delete a page and all of its blocks. The template must keep at least one page.", { page: integer("1-based page number.") }, ["page"]),
  tool("show_page", "Show a page in the editor.", { page: integer("1-based page number.") }, ["page"]),
  tool("set_page_setup", "Set paper size and orientation for printing and PDF output.", {
    size: string("Paper size.", { enum: [...PAPER_SIZES.map((item) => item.id), "custom"] }),
    orientation: string("Orientation.", { enum: ["portrait", "landscape"] }),
    width_mm: number("Custom paper width in mm (100-600), only with size=custom."),
    height_mm: number("Custom paper height in mm (100-600), only with size=custom."),
  }),
  tool("set_header_footer", "Change page header/footer and page numbers. Slots accept text and fields {페이지} (page number), {전체페이지} (page count), {날짜} (report date), {제목} (report title).", {
    header: { type: "object", description: "Header text slots.", properties: { left: { type: "string" }, center: { type: "string" }, right: { type: "string" } } },
    footer: { type: "object", description: "Footer text slots.", properties: { left: { type: "string" }, center: { type: "string" }, right: { type: "string" } } },
    header_preset: string("Apply a header preset.", { enum: HEADER_GALLERY.map((item) => item.id) }),
    footer_preset: string("Apply a footer preset.", { enum: FOOTER_GALLERY.map((item) => item.id) }),
    page_number: { type: "object", description: "Insert a page number.", properties: { position: { type: "string", enum: ["top", "bottom"] }, align: { type: "string", enum: ["left", "center", "right"] } } },
    page_number_format: string("Page number format.", { enum: PAGE_NUMBER_FORMATS.map((item) => item.id) }),
    remove_page_numbers: boolean("Remove all page numbers."),
    clear_header: boolean("Remove the header."),
    clear_footer: boolean("Remove the footer."),
    header_divider: boolean("Draw a line under the header."),
    footer_divider: boolean("Draw a line above the footer."),
    different_first_page: boolean("Use a different (empty) header/footer on the first page."),
  }),
  tool("list_datasources", "List database connections that blocks can query. The default report DB has id \"\"."),
  tool("run_query", "Run a read-only SELECT/WITH query and preview up to 20 rows and the column names. Use before binding data.", {
    sql: string("SELECT or WITH query. Use ? for parameters."),
    parameters: { type: "array", description: "Values for ? placeholders. Date tokens: {{reportDate}}, {{previousDate}}, {{periodStart}}, {{periodEnd}}.", items: { type: "string" } },
    datasource_id: string("Datasource id, \"\" for the default report DB."),
  }, ["sql"]),
  tool("bind_data", "Connect a block to a database query so generated reports fill it automatically. Tables: put field names into one row; with repeat=rows that row repeats once per result row. Charts: category_field gives the labels and series_fields the numeric series. Text blocks: map the content to one field (first result row).", {
    block_id: string("Block id."),
    sql: string("SELECT or WITH query. Use ? for parameters."),
    parameters: { type: "array", description: "Values for ? placeholders; date tokens {{reportDate}}, {{previousDate}}, {{periodStart}}, {{periodEnd}} are replaced at generation time.", items: { type: "string" } },
    datasource_id: string("Datasource id, \"\" for the default report DB."),
    fields: { type: "array", description: "Table: one query column name per table column (\"\" to leave a column empty).", items: { type: "string" } },
    field_row: integer("Table: zero-based row that receives the fields. Defaults to the first non-header row (created if missing)."),
    repeat: string("Table repeat mode: rows = repeat the field row per result row, table = repeat the whole table per result row, none.", { enum: ["rows", "table", "none"] }),
    content_field: string("Text blocks: query column whose first-row value becomes the content."),
    category_field: string("Charts: query column used for category labels."),
    series_fields: { type: "array", description: "Charts: numeric query columns, one series each.", items: { type: "object", properties: { field: { type: "string" }, name: string("Legend name; defaults to the column name.") }, required: ["field"] } },
  }, ["block_id", "sql"]),
  tool("unbind_data", "Disconnect a block from its database query.", { block_id: string("Block id.") }, ["block_id"]),
  tool("list_templates", "List saved templates with their schedules."),
  tool("open_template", "Open a saved template in the editor.", { template_id: string("Template id."), discard_unsaved: boolean("Discard unsaved edits of the current template.") }, ["template_id"]),
  tool("new_template", "Start a new, unsaved blank template in the editor.", { discard_unsaved: boolean("Discard unsaved edits of the current template.") }),
  tool("save_template", "Save the open template. A new template needs a name; you may also rename an existing one or change its group or period.", {
    name: string("Template name."), group: string("Template group (folder) name. Default \"양식\"."),
    period: string("Report period of the template.", { enum: ["daily", "weekly", "monthly"] }),
  }),
  tool("delete_template", "Delete a saved template permanently (asks the user to confirm).", { template_id: string("Template id.") }, ["template_id"]),
  tool("set_schedule", "Set automatic report generation for a saved template.", {
    template_id: string("Template id. Defaults to the open template."),
    enabled: boolean("Generate reports automatically."),
    frequency: string("Run frequency.", { enum: ["daily", "weekly", "monthly"] }),
    time: string("Run time HH:MM (24h, Korea time)."),
    weekday: integer("Weekly run day: 0=Sunday ... 6=Saturday."),
    day_of_month: integer("Monthly run day 1-28."),
  }),
  tool("get_mail_settings", "Read the email delivery settings of a saved template.", { template_id: string("Template id. Defaults to the open template.") }),
  tool("set_mail_settings", "Change automatic email delivery of generated reports (PDF attached).", {
    template_id: string("Template id. Defaults to the open template."),
    enabled: boolean("Send email automatically when a report is generated."),
    recipients: { type: "array", description: "Email addresses (replaces the address list; selected users are kept).", items: { type: "string" } },
    subject: string("Email subject. Empty uses \"<template> - <date>\"."),
    body: string("Email body text."),
  }),
  tool("preview", "Open or close the print preview.", { open: boolean("true to open, false to close.") }, ["open"]),
  tool("print", "Open the browser print dialog for the open template (can save as PDF)."),
];

export const TOOL_LABELS = {
  get_editor_state: "양식 상태 확인", get_block: "요소 확인", add_block: "요소 추가", add_blocks: "요소 여러 개 추가", update_block: "요소 수정",
  set_table_cells: "표 셀 수정", delete_block: "요소 삭제", move_block: "요소 이동", select_block: "요소 선택",
  add_page: "페이지 추가", delete_page: "페이지 삭제", show_page: "페이지 이동", set_page_setup: "용지 설정",
  set_header_footer: "머리글·바닥글 설정", list_datasources: "데이터소스 확인", run_query: "쿼리 미리보기",
  bind_data: "데이터 연결", unbind_data: "데이터 연결 해제", list_templates: "양식 목록 확인", open_template: "양식 열기",
  new_template: "새 양식", save_template: "양식 저장", delete_template: "양식 삭제", set_schedule: "자동 생성 일정",
  get_mail_settings: "메일 설정 확인", set_mail_settings: "메일 설정", preview: "미리보기", print: "인쇄",
};

// 편집 내용을 바꾸는 도구(되돌리기 대상)
export const MUTATING_TOOLS = new Set([
  "add_block", "add_blocks", "update_block", "set_table_cells", "delete_block", "move_block", "add_page", "delete_page",
  "set_page_setup", "set_header_footer", "bind_data", "unbind_data", "open_template", "new_template",
]);

class ToolError extends Error {}
const fail = (message) => { throw new ToolError(message); };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const text = (value, max = 10000) => String(value ?? "").slice(0, max);
const color = (value, allowNone = false) => {
  if (value === undefined) return undefined;
  if (allowNone && value === "none") return "none";
  if (value === "") return "";
  if (typeof value === "string" && COLOR.test(value)) return value.toUpperCase();
  return fail(`색은 #RRGGBB 형식이어야 합니다: ${value}`);
};

function trimResult(value) {
  const json = JSON.stringify(value);
  return json.length > MAX_RESULT_CHARS ? `${json.slice(0, MAX_RESULT_CHARS)}…(생략됨)` : json;
}

function short(value, max = 60) {
  const textValue = String(value ?? "").replace(/\s+/g, " ").trim();
  return textValue.length > max ? `${textValue.slice(0, max)}…` : textValue;
}

// 표 내용(rows, 머리글 행, 병합, 배경, 열 너비)을 한 번에 다시 만든다.
export function buildTable(block, input) {
  const rows = input.rows;
  if (!Array.isArray(rows) || !rows.length || rows.length > 200 || rows.some((row) => !Array.isArray(row))) {
    fail("rows는 1~200개의 행 배열이어야 합니다.");
  }
  const count = Math.max(...rows.map((row) => row.length), 1);
  if (count > 30) fail("표는 최대 30열까지 만들 수 있습니다.");
  const headerRows = clamp(Number.isInteger(input.header_rows) ? input.header_rows : 1, 0, rows.length);
  const backgrounds = Array.isArray(input.cell_backgrounds) ? input.cell_backgrounds : null;
  block.gridVersion = 1;
  block.columns = Array(count).fill("");
  block.columnStyles = Array.from({ length: count }, () => ({}));
  block.rows = rows.map((row, rowIndex) => ({
    cells: Array.from({ length: count }, (_, column) => text(row[column], 3000)),
    cellStyles: Array.from({ length: count }, (_, column) => {
      const value = backgrounds ? backgrounds[rowIndex]?.[column] : rowIndex < headerRows ? "#DCE6F2" : "";
      const background = typeof value === "string" && COLOR.test(value) ? value.toUpperCase() : "";
      return background ? { backgroundColor: background } : {};
    }),
    ...(rowIndex < headerRows ? { isTitleRow: true } : {}),
  }));
  block.merges = (Array.isArray(input.merges) ? input.merges : []).filter((merge) =>
    merge && [merge.row, merge.column, merge.rowspan, merge.colspan].every(Number.isInteger) &&
    merge.row >= 0 && merge.column >= 0 && merge.rowspan >= 1 && merge.colspan >= 1 &&
    (merge.rowspan > 1 || merge.colspan > 1) && merge.row + merge.rowspan <= rows.length && merge.column + merge.colspan <= count);
  if (Array.isArray(input.column_widths)) applyColumnWidths(block, input.column_widths);
  else delete block.columnWidths;
  if (block.dataBinding?.mappings) block.dataBinding.mappings.columns = Array(count).fill("");
}

function applyColumnWidths(block, widths) {
  if (widths.length !== block.columns.length || widths.some((value) => !finite(value) || value <= 0)) {
    fail(`column_widths는 열 수(${block.columns.length})만큼의 양수여야 합니다.`);
  }
  const total = widths.reduce((sum, value) => sum + value, 0);
  block.columnWidths = widths.map((value) => Math.round((value / total) * 10000) / 100);
}

// add_block / update_block 공통: 주어진 속성만 블록에 반영한다.
export function applyBlockProperties(block, input) {
  const has = (key) => input[key] !== undefined && input[key] !== null;
  if (has("content")) {
    if (block.type === "shape") block.content = text(input.content, 500);
    else if (TEXT_TYPES.has(block.type)) block.content = text(input.content);
    else fail(`${block.type} 요소에는 content를 쓸 수 없습니다.`);
  }
  if (has("heading")) {
    if (!["section", "special", "table"].includes(block.type)) fail("heading은 section, special, table 요소에만 씁니다.");
    block.heading = text(input.heading, 500);
  }
  if (has("font_size")) {
    if (!finite(input.font_size)) fail("font_size는 숫자여야 합니다.");
    block.fontSize = clamp(input.font_size, MIN_FONT_SIZE, MAX_FONT_SIZE);
  }
  if (has("align")) {
    if (!["left", "center", "right"].includes(input.align)) fail("align은 left, center, right 중 하나입니다.");
    block.align = input.align;
  }
  const style = {};
  for (const key of ["bold", "italic", "underline"]) if (has(key)) style[key] = Boolean(input[key]);
  if (has("color")) style.color = color(input.color);
  if (has("highlight")) style.highlight = color(input.highlight);
  if (Object.keys(style).length) {
    if (!TEXT_TYPES.has(block.type) && block.type !== "table") fail("글자 서식은 텍스트 계열 요소와 표에만 쓸 수 있습니다.");
    block.textStyle = { ...(block.textStyle ?? {}) };
    for (const [key, value] of Object.entries(style)) {
      if (value === "" || value === false) delete block.textStyle[key];
      else block.textStyle[key] = value;
    }
  }
  if (has("width_percent") || has("height")) {
    block.layout = { ...(block.layout ?? {}) };
    if (has("width_percent")) {
      if (!finite(input.width_percent)) fail("width_percent는 숫자여야 합니다.");
      block.layout.mode = "flow";
      block.layout.width = clamp(Math.round(input.width_percent * 100) / 100, 10, 100);
    }
    if (has("height")) {
      if (block.type === "chart") block.chart = { ...block.chart, height: clamp(Number(input.height) || 260, 120, 900) };
      else block.layout.h = finite(input.height) ? clamp(Math.round(input.height), 16, 1200) : null;
    }
  }
  if (block.type === "table") {
    if (has("rows")) buildTable(block, input);
    else {
      if (has("cell_backgrounds") || has("merges") || has("header_rows")) {
        buildTable(block, { ...input, rows: block.rows.map((row) => row.cells), header_rows: has("header_rows") ? input.header_rows : block.rows.filter((row) => row.isTitleRow).length });
      }
      if (has("column_widths")) applyColumnWidths(block, input.column_widths);
    }
    if (has("unit")) block.unit = text(input.unit, 200);
  } else if (["rows", "merges", "cell_backgrounds", "column_widths", "header_rows"].some(has)) {
    fail("rows, merges, cell_backgrounds, column_widths는 표에만 쓸 수 있습니다.");
  }
  if (block.type === "chart") applyChart(block, input, has);
  else if (["chart_type", "categories", "series", "chart_title", "palette"].some(has)) fail("차트 속성은 chart 요소에만 쓸 수 있습니다.");
  if (block.type === "shape") {
    if (has("shape_kind")) {
      if (!SHAPE_KINDS.includes(input.shape_kind)) fail(`지원하지 않는 도형입니다: ${input.shape_kind}`);
      const base = createShapeConfig(input.shape_kind);
      block.shape = { ...base, ...(block.shape ?? {}), kind: input.shape_kind, ...(base.fill === "none" ? { fill: "none" } : {}) };
    }
    block.shape ??= createShapeConfig("rect");
    if (has("fill")) block.shape.fill = color(input.fill, true) || "none";
    if (has("stroke")) block.shape.stroke = color(input.stroke, true) || "none";
    if (has("shape_width")) block.shape.width = clamp(Number(input.shape_width) || 160, 10, 1200);
    if (has("shape_height")) block.shape.height = clamp(Number(input.shape_height) || 90, 4, 1200);
  }
  if (block.type === "period") {
    for (const key of ["start", "end"]) {
      if (!has(key)) continue;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input[key])) fail(`${key}는 YYYY-MM-DDTHH:MM 형식이어야 합니다.`);
      block[key] = input[key];
    }
  }
  return block;
}

function applyChart(block, input, has) {
  if (has("chart_type")) {
    if (!CHART_TYPES.includes(input.chart_type)) fail(`지원하지 않는 차트 종류입니다: ${input.chart_type}`);
    const base = createChartConfig(input.chart_type, input.chart_variant);
    block.chart = { ...base, ...(block.chart ?? {}), category: base.category, variant: base.variant };
  } else if (has("chart_variant")) {
    block.chart = { ...block.chart, variant: getChartVariant(block.chart.category, input.chart_variant).id };
  }
  if (has("chart_title")) block.chart = { ...block.chart, title: text(input.chart_title, 200), showTitle: Boolean(input.chart_title) };
  if (has("chart_height")) block.chart = { ...block.chart, height: clamp(Number(input.chart_height) || 260, 120, 900) };
  if (has("palette")) {
    if (!CHART_PALETTES.some((item) => item.id === input.palette)) fail(`지원하지 않는 색 구성입니다: ${input.palette}`);
    block.chart = { ...block.chart, palette: input.palette };
  }
  if (has("legend")) block.chart = { ...block.chart, legend: input.legend };
  if (has("show_labels")) block.chart = { ...block.chart, showLabels: Boolean(input.show_labels) };
  if (has("categories") || has("series")) {
    const categories = has("categories") ? input.categories : block.chartData?.categories ?? [];
    const series = has("series") ? input.series : block.chartData?.series ?? [];
    if (!Array.isArray(categories) || categories.length > 200 || !Array.isArray(series) || !series.length || series.length > 20) {
      fail("차트에는 1~20개의 series와 200개 이하의 categories가 필요합니다.");
    }
    const needsCategories = !["histogram", "boxplot"].includes(block.chart.category);
    const clean = series.map((item) => {
      if (!item || !Array.isArray(item.values) || item.values.some((value) => !finite(Number(value)))) fail("series의 values는 숫자 배열이어야 합니다.");
      if (needsCategories && item.values.length !== categories.length) fail(`series '${item.name}'의 값 개수(${item.values.length})가 categories 개수(${categories.length})와 다릅니다.`);
      return { name: text(item.name, 200), values: item.values.map(Number) };
    });
    block.chartData = { categories: categories.map((item) => text(item, 200)), series: clean };
  }
}

function summarizeBlock(block, label) {
  const summary = { id: block.id, type: block.type, label: short(label, 40) };
  const layout = block.layout ?? {};
  if (layout.mode === "free") summary.layout = "free";
  else if (layout.width && layout.width !== 100) summary.width_percent = layout.width;
  if (TEXT_TYPES.has(block.type) && block.content) summary.content = short(block.content);
  if (block.type === "table") {
    summary.size = `${block.rows?.length ?? 0}x${block.columns?.length ?? 0}`;
    summary.first_row = (block.rows?.[0]?.cells ?? []).map((cell) => short(cell, 20));
  }
  if (block.type === "chart") summary.chart = `${block.chart?.category}/${block.chart?.variant}`;
  if (block.dataBinding?.enabled) summary.bound_query = short(block.dataBinding.query, 80);
  return summary;
}

function blockDetail(block) {
  const detail = JSON.parse(JSON.stringify(block));
  if (detail.image?.src) detail.image.src = `(이미지 데이터 ${detail.image.src.length}자 생략)`;
  for (const binding of [detail.dataBinding, detail.summaryBinding]) {
    if (binding?.rows) binding.rows = `${binding.rows.length}행 (생략)`;
  }
  return detail;
}

export function createToolExecutor(ctx) {
  function pageIndex(page) {
    const pages = ctx.pages();
    if (page === undefined || page === null) return ctx.state().currentPage;
    if (!Number.isInteger(page) || page < 1 || page > pages.length) fail(`페이지 ${page}이(가) 없습니다. 페이지는 1~${pages.length}입니다.`);
    return page - 1;
  }

  function findBlock(id) {
    const pages = ctx.pages();
    for (let index = 0; index < pages.length; index += 1) {
      const blocks = ctx.pageBlocks(index);
      const position = blocks.findIndex((block) => block.id === id);
      if (position >= 0) return { page: index, blocks, position, block: blocks[position] };
    }
    return fail(`요소 ${id}를 찾을 수 없습니다. get_editor_state로 요소 id를 확인하세요.`);
  }

  function reveal(page, blockId) {
    if (page !== ctx.state().currentPage) ctx.showPage(page);
    if (blockId) ctx.selectBlock(blockId);
  }

  function requireSavedTemplate(id) {
    const templateId = id || ctx.state().templateId;
    const template = ctx.templates().find((item) => item.id === templateId);
    if (!template) fail(id ? `양식 ${id}를 찾을 수 없습니다.` : "열린 양식이 아직 저장되지 않았습니다. 먼저 save_template으로 이름을 정해 저장하세요.");
    return template;
  }

  function editorState() {
    const state = ctx.state();
    return {
      template: { id: state.templateId || null, name: state.templateLabel, group: state.templateGroup, period: state.layoutType, saved: Boolean(state.templateId), unsaved_changes: state.unsaved },
      page_setup: describePageSetup(state.pageSetup),
      header: state.headerFooter ? normalizeHeaderFooter(state.headerFooter).header : null,
      footer: state.headerFooter ? normalizeHeaderFooter(state.headerFooter).footer : null,
      current_page: state.currentPage + 1,
      selected_block_id: state.selectedId || null,
      pages: ctx.pages().map((_, index) => ({ page: index + 1, blocks: ctx.pageBlocks(index).map((block) => summarizeBlock(block, ctx.blockLabel(block))) })),
    };
  }

  // 한 요청에서 같은 기준(after_block_id, at_start)으로 여러 번 넣으면 호출 순서대로 쌓이도록,
  // 기준별로 마지막에 넣은 요소를 기억해 그 뒤에 넣는다. 요청마다 beginTurn()으로 비운다.
  let chain = new Map();

  const chainKey = (input, page) => input.at_start ? `start:${page}` : input.after_block_id ?? "";

  function insertIndex(blocks, input, page, excludeId) {
    const anchor = input.after_block_id ?? input.before_block_id;
    // 옮기기(excludeId 있음)는 사용자가 지정한 위치를 그대로 따른다.
    const chained = excludeId ? undefined : chain.get(chainKey(input, page));
    if (chained) {
      const position = blocks.findIndex((block) => block.id === chained && block.id !== excludeId);
      if (position >= 0) return position + 1;
    }
    if (input.at_start) return 0;
    if (anchor) {
      const position = blocks.findIndex((block) => block.id === anchor && block.id !== excludeId);
      if (position < 0) fail(`기준 요소 ${anchor}가 이 페이지에 없습니다. id는 get_editor_state나 이전 도구 결과에 나온 값만 쓰고, 순서대로 여러 요소를 넣을 때는 add_blocks를 쓰세요.`);
      return input.after_block_id ? position + 1 : position;
    }
    return blocks.length;
  }

  function rememberInsert(input, page, lastId) {
    const key = chainKey(input, page);
    if (key) chain.set(key, lastId);
  }

  function makeBlock(input) {
    if (!BLOCK_TYPES.includes(input?.type)) fail(`지원하지 않는 요소 종류입니다: ${input?.type}. 그림은 사용자가 직접 넣어야 합니다.`);
    const block = ctx.createBlock(input.type);
    if (input.type === "chart" && input.chart_type) block.chart = createChartConfig(input.chart_type, input.chart_variant);
    if (input.type === "shape" && input.shape_kind) block.shape = createShapeConfig(input.shape_kind);
    applyBlockProperties(block, input);
    return block;
  }

  const handlers = {
    get_editor_state: () => editorState(),
    get_block: ({ block_id }) => blockDetail(findBlock(block_id).block),

    add_block(input) {
      const page = pageIndex(input.page);
      const blocks = ctx.pageBlocks(page);
      if (blocks.length >= 300) fail("한 페이지에는 요소를 300개까지 넣을 수 있습니다.");
      const block = makeBlock(input);
      blocks.splice(insertIndex(blocks, input, page), 0, block);
      rememberInsert(input, page, block.id);
      reveal(page, block.id);
      return { ok: true, block_id: block.id, page: page + 1 };
    },

    add_blocks(input) {
      const page = pageIndex(input.page);
      const blocks = ctx.pageBlocks(page);
      if (!Array.isArray(input.blocks) || !input.blocks.length || input.blocks.length > 60) fail("blocks는 1~60개의 요소 배열이어야 합니다.");
      if (blocks.length + input.blocks.length > 300) fail("한 페이지에는 요소를 300개까지 넣을 수 있습니다.");
      // 모두 검증한 뒤 한꺼번에 넣어, 중간에 실패하면 아무것도 바뀌지 않게 한다.
      const created = input.blocks.map((item, index) => {
        try {
          return makeBlock(item);
        } catch (error) {
          return fail(`blocks[${index}] (${item?.type}): ${error.message}`);
        }
      });
      blocks.splice(insertIndex(blocks, input, page), 0, ...created);
      rememberInsert(input, page, created.at(-1).id);
      reveal(page, created[0].id);
      return { ok: true, page: page + 1, block_ids: created.map((block) => block.id) };
    },

    update_block(input) {
      const { block, page } = findBlock(input.block_id);
      // 복사본에 먼저 적용해 검증이 실패하면 원본이 반쯤 바뀌지 않게 한다.
      const draft = JSON.parse(JSON.stringify(block));
      applyBlockProperties(draft, input);
      for (const key of Object.keys(block)) if (!(key in draft)) delete block[key];
      Object.assign(block, draft);
      reveal(page, block.id);
      return { ok: true, block: summarizeBlock(block, ctx.blockLabel(block)) };
    },

    set_table_cells({ block_id, cells }) {
      const { block, page } = findBlock(block_id);
      if (block.type !== "table") fail("표 요소가 아닙니다.");
      if (!Array.isArray(cells) || !cells.length || cells.length > 500) fail("cells는 1~500개여야 합니다.");
      const updates = cells.map((cell) => {
        if (!Number.isInteger(cell?.row) || !Number.isInteger(cell?.column) || !block.rows[cell.row] || cell.column < 0 || cell.column >= block.columns.length) {
          fail(`셀 (${cell?.row}, ${cell?.column})이 표 범위(${block.rows.length}행 x ${block.columns.length}열)를 벗어났습니다.`);
        }
        return { ...cell, background: color(cell.background) };
      });
      for (const cell of updates) {
        const row = block.rows[cell.row];
        row.cellStyles ??= block.columns.map(() => ({}));
        if (cell.text !== undefined) row.cells[cell.column] = text(cell.text, 3000);
        const style = { ...(row.cellStyles[cell.column] ?? {}) };
        if (cell.background !== undefined) {
          if (cell.background) style.backgroundColor = cell.background;
          else delete style.backgroundColor;
        }
        if (cell.align) style.textAlign = cell.align;
        row.cellStyles[cell.column] = style;
      }
      reveal(page, block.id);
      return { ok: true, updated: updates.length };
    },

    delete_block({ block_id }) {
      const { blocks, position, page } = findBlock(block_id);
      blocks.splice(position, 1);
      reveal(page, blocks[Math.min(position, blocks.length - 1)]?.id ?? "");
      return { ok: true };
    },

    move_block(input) {
      const source = findBlock(input.block_id);
      const targetPage = pageIndex(input.page ?? source.page + 1);
      source.blocks.splice(source.position, 1);
      const target = ctx.pageBlocks(targetPage);
      try {
        target.splice(insertIndex(target, input, targetPage, source.block.id), 0, source.block);
      } catch (error) {
        source.blocks.splice(source.position, 0, source.block);
        throw error;
      }
      reveal(targetPage, source.block.id);
      return { ok: true, page: targetPage + 1 };
    },

    select_block({ block_id }) {
      const { page } = findBlock(block_id);
      reveal(page, block_id);
      return { ok: true };
    },

    add_page() {
      ctx.addPage();
      return { ok: true, page: ctx.pages().length };
    },

    delete_page({ page }) {
      const index = pageIndex(page);
      if (ctx.pages().length <= 1) fail("양식에는 페이지가 하나 이상 있어야 합니다.");
      ctx.deletePage(index);
      return { ok: true, page_count: ctx.pages().length };
    },

    show_page({ page }) {
      ctx.showPage(pageIndex(page));
      return { ok: true };
    },

    set_page_setup(input) {
      const current = normalizePageSetup(ctx.state().pageSetup);
      const next = { ...current };
      if (input.size) {
        if (input.size !== "custom" && !PAPER_SIZES.some((item) => item.id === input.size)) fail(`지원하지 않는 용지입니다: ${input.size}`);
        next.size = input.size;
      }
      if (input.orientation) next.orientation = input.orientation === "landscape" ? "landscape" : "portrait";
      if (next.size === "custom") {
        if (!finite(input.width_mm ?? current.widthMm) || !finite(input.height_mm ?? current.heightMm)) fail("사용자 지정 용지는 width_mm와 height_mm가 필요합니다.");
        next.widthMm = input.width_mm ?? current.widthMm;
        next.heightMm = input.height_mm ?? current.heightMm;
      }
      ctx.setPageSetup(next);
      return { ok: true, page_setup: describePageSetup(ctx.state().pageSetup) };
    },

    set_header_footer(input) {
      let config = normalizeHeaderFooter(ctx.state().headerFooter);
      if (input.clear_header) config = clearArea(config, "header");
      if (input.clear_footer) config = clearArea(config, "footer");
      if (input.header_preset) config = applyGallery(config, "header", input.header_preset);
      if (input.footer_preset) config = applyGallery(config, "footer", input.footer_preset);
      for (const kind of ["header", "footer"]) {
        if (!input[kind]) continue;
        for (const slot of ["left", "center", "right"]) {
          if (typeof input[kind][slot] === "string") config[kind][slot] = text(input[kind][slot], 200);
        }
      }
      if (input.remove_page_numbers) config = removePageNumbers(config);
      if (input.page_number) {
        const position = input.page_number.position === "top" ? "top" : "bottom";
        const align = ["left", "center", "right"].includes(input.page_number.align) ? input.page_number.align : "center";
        config = insertPageNumber(config, position, align);
      }
      if (input.page_number_format) {
        if (!PAGE_NUMBER_FORMATS.some((item) => item.id === input.page_number_format)) fail("지원하지 않는 페이지 번호 형식입니다.");
        config.pageNumber = { ...config.pageNumber, format: input.page_number_format };
      }
      for (const [key, target] of [["header_divider", "headerDivider"], ["footer_divider", "footerDivider"], ["different_first_page", "differentFirstPage"]]) {
        if (typeof input[key] === "boolean") config[target] = input[key];
      }
      ctx.setHeaderFooter(config);
      return { ok: true, header: config.header, footer: config.footer };
    },

    list_datasources: () => ({
      datasources: [{ id: "", name: "리포트 DB (기본)" }, ...ctx.datasources().map((item) => ({ id: item.id, name: item.name, type: item.type }))],
    }),

    async run_query({ sql, parameters = [], datasource_id = "" }) {
      if (typeof sql !== "string" || !sql.trim()) fail("sql이 비어 있습니다.");
      const result = await ctx.executeQuery(sql, parameters, datasource_id);
      return { columns: result.columns, row_count: result.rows.length, rows: result.rows.slice(0, 20) };
    },

    async bind_data(input) {
      const { block, page } = findBlock(input.block_id);
      if (!["table", "chart", "title", "text", "subheading", "section", "special"].includes(block.type)) fail("데이터는 표, 차트, 텍스트 계열 요소에만 연결할 수 있습니다.");
      const parameters = Array.isArray(input.parameters) ? input.parameters.map(String) : [];
      const result = await ctx.executeQuery(input.sql, parameters, input.datasource_id ?? "");
      const columns = result.columns;
      const unknown = (name) => name && !columns.includes(name);
      const binding = ctx.ensureBinding(block);
      if (block.type === "table") {
        const fields = Array.isArray(input.fields) ? input.fields.map(String) : [];
        if (!fields.some(Boolean)) fail(`fields에 표 열마다 연결할 조회 열을 넣으세요. 조회 열: ${columns.join(", ")}`);
        if (fields.some(unknown)) fail(`조회 결과에 없는 열이 있습니다: ${fields.filter(unknown).join(", ")}. 조회 열: ${columns.join(", ")}`);
        if (fields.length > block.columns.length) fail(`표 열은 ${block.columns.length}개인데 fields는 ${fields.length}개입니다. 먼저 표 열 수를 맞추세요.`);
        let rowIndex = Number.isInteger(input.field_row) ? input.field_row : block.rows.findIndex((row) => !row.isTitleRow);
        if (rowIndex < 0 || rowIndex >= block.rows.length) {
          block.rows.push({ cells: block.columns.map(() => ""), cellStyles: block.columns.map(() => ({})) });
          rowIndex = block.rows.length - 1;
        }
        block.rows.forEach((row, index) => {
          if (index === rowIndex) row.fields = block.columns.map((_, column) => fields[column] || "");
        });
        const repeat = input.repeat ?? "rows";
        binding.repeatTable = repeat === "table";
        block.rows.forEach((row, index) => { row.repeat = repeat === "rows" && index === rowIndex; });
      } else if (block.type === "chart") {
        const series = Array.isArray(input.series_fields) ? input.series_fields.filter((item) => item?.field) : [];
        if (!series.length) fail(`series_fields에 숫자 계열로 쓸 조회 열을 넣으세요. 조회 열: ${columns.join(", ")}`);
        const names = [input.category_field, ...series.map((item) => item.field)];
        if (names.some(unknown)) fail(`조회 결과에 없는 열이 있습니다: ${names.filter(unknown).join(", ")}. 조회 열: ${columns.join(", ")}`);
        binding.chartMapping = {
          categoryField: input.category_field || "",
          series: series.map((item) => ({ field: String(item.field), name: typeof item.name === "string" ? item.name.slice(0, 200) : "" })),
        };
      } else {
        if (!input.content_field) fail(`content_field에 내용으로 쓸 조회 열을 넣으세요. 조회 열: ${columns.join(", ")}`);
        if (unknown(input.content_field)) fail(`조회 결과에 ${input.content_field} 열이 없습니다. 조회 열: ${columns.join(", ")}`);
        binding.mappings.fields = { ...binding.mappings.fields, content: input.content_field };
      }
      Object.assign(binding, {
        enabled: true, query: input.sql, datasourceId: input.datasource_id ?? "", parametersText: JSON.stringify(parameters),
        parameters, columns, rows: result.rows, lastRefreshedAt: new Date().toISOString(),
      });
      reveal(page, block.id);
      return { ok: true, columns, row_count: result.rows.length };
    },

    unbind_data({ block_id }) {
      const { block, page } = findBlock(block_id);
      if (block.dataBinding) block.dataBinding.enabled = false;
      for (const row of block.rows ?? []) { delete row.fields; row.repeat = false; }
      reveal(page, block.id);
      return { ok: true };
    },

    list_templates: () => ({
      open_template_id: ctx.state().templateId || null,
      templates: ctx.templates().map((item) => {
        const schedule = ctx.schedules().find((row) => row.templateId === item.id);
        return { id: item.id, name: item.label, group: item.group, period: item.layoutType, schedule: schedule ? { enabled: schedule.enabled, frequency: schedule.frequency, time: schedule.time, weekday: schedule.weekday, day_of_month: schedule.dayOfMonth } : null };
      }),
    }),

    async open_template({ template_id, discard_unsaved }) {
      requireSavedTemplate(template_id);
      if (ctx.state().unsaved && !discard_unsaved) fail("저장하지 않은 변경이 있습니다. 사용자에게 저장할지 물어본 뒤 save_template을 하거나 discard_unsaved=true로 다시 호출하세요.");
      await ctx.openTemplate(template_id);
      return { ok: true, state: editorState() };
    },

    async new_template({ discard_unsaved } = {}) {
      if (ctx.state().unsaved && !discard_unsaved) fail("저장하지 않은 변경이 있습니다. 사용자에게 저장할지 물어본 뒤 save_template을 하거나 discard_unsaved=true로 다시 호출하세요.");
      await ctx.openTemplate("");
      return { ok: true, state: editorState() };
    },

    async save_template({ name, group, period } = {}) {
      const state = ctx.state();
      if (period && !["daily", "weekly", "monthly"].includes(period)) fail("period는 daily, weekly, monthly 중 하나입니다.");
      const label = typeof name === "string" ? name.trim().slice(0, 100) : "";
      const groupName = typeof group === "string" ? group.trim().slice(0, 100) : "";
      if (!state.templateId) {
        if (!label) fail("새 양식은 이름(name)이 필요합니다. 사용자에게 양식 이름을 물어보거나 제목을 이름으로 쓰세요.");
        const template = await ctx.createTemplate({ label, group: groupName || "양식", layoutType: period || "daily" });
        return { ok: true, created: true, template_id: template.id, name: template.label };
      }
      await ctx.saveTemplate({ label: label || undefined, group: groupName || undefined, layoutType: period || undefined });
      return { ok: true, template_id: ctx.state().templateId, name: ctx.state().templateLabel };
    },

    async delete_template({ template_id }) {
      const template = requireSavedTemplate(template_id);
      if (!(await ctx.confirm(`'${template.label}' 양식을 삭제할까요? 생성된 보고서와 일정도 함께 삭제되며 되돌릴 수 없습니다.`))) {
        return { ok: false, cancelled: true, message: "사용자가 삭제를 취소했습니다." };
      }
      await ctx.deleteTemplate(template.id);
      return { ok: true };
    },

    async set_schedule(input) {
      const template = requireSavedTemplate(input.template_id);
      const current = ctx.schedules().find((row) => row.templateId === template.id) ??
        { enabled: true, frequency: template.layoutType ?? "daily", time: "08:00", weekday: 1, dayOfMonth: 1 };
      const next = { ...current };
      if (typeof input.enabled === "boolean") next.enabled = input.enabled;
      if (input.frequency) {
        if (!["daily", "weekly", "monthly"].includes(input.frequency)) fail("frequency는 daily, weekly, monthly 중 하나입니다.");
        next.frequency = input.frequency;
      }
      if (input.time !== undefined) {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) fail("time은 HH:MM(24시간) 형식이어야 합니다.");
        next.time = input.time;
      }
      if (input.weekday !== undefined) {
        if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) fail("weekday는 0(일)~6(토)입니다.");
        next.weekday = input.weekday;
      }
      if (input.day_of_month !== undefined) {
        if (!Number.isInteger(input.day_of_month) || input.day_of_month < 1 || input.day_of_month > 28) fail("day_of_month는 1~28입니다.");
        next.dayOfMonth = input.day_of_month;
      }
      const saved = await ctx.saveSchedule(template.id, next);
      return { ok: true, schedule: saved };
    },

    async get_mail_settings({ template_id } = {}) {
      const template = requireSavedTemplate(template_id);
      return { template_id: template.id, ...(await ctx.getMailSettings(template.id)) };
    },

    async set_mail_settings(input) {
      const template = requireSavedTemplate(input.template_id);
      const current = await ctx.getMailSettings(template.id);
      const next = { ...current };
      if (typeof input.enabled === "boolean") next.enabled = input.enabled;
      if (Array.isArray(input.recipients)) next.recipients = input.recipients.map((item) => String(item).trim()).filter(Boolean);
      if (typeof input.subject === "string") next.subject = input.subject;
      if (typeof input.body === "string") next.body = input.body;
      return { ok: true, settings: await ctx.saveMailSettings(template.id, next) };
    },

    preview({ open }) {
      ctx.setPreview(Boolean(open));
      return { ok: true };
    },

    print() {
      ctx.print();
      return { ok: true };
    },
  };

  // 도구 결과는 항상 문자열(JSON)로 돌려주고, 실패도 모델이 고쳐서 다시 시도할 수 있게 메시지로 전달한다.
  async function execute(name, args) {
    const handler = handlers[name];
    if (!handler) return { ok: false, content: JSON.stringify({ error: `알 수 없는 도구입니다: ${name}` }) };
    try {
      const result = await handler(args && typeof args === "object" ? args : {});
      return { ok: result?.ok !== false, content: trimResult(result) };
    } catch (error) {
      const message = error instanceof ToolError ? error.message : `실행 중 오류: ${error?.message || error}`;
      return { ok: false, content: JSON.stringify({ error: message }) };
    }
  }
  execute.editorState = editorState;
  execute.beginTurn = () => { chain = new Map(); };
  return execute;
}

// 매 요청마다 최신 양식 상태를 함께 알려 주어 도구 호출 없이도 요소 id를 알 수 있게 한다.
export function buildSystemPrompt({ state, userName, today }) {
  return `You are the AI assistant built into "CODVILL 리포트 에디터", a Korean report template editor.
You help ${userName || "the user"} build report templates and configure output (paper, header/footer, data binding, schedules, email, print) by calling tools.
Today is ${today}. Always reply in Korean, briefly and politely.

How to work:
- Act with tools instead of describing steps. Plan the whole request, then call the needed tools (several in one turn is fine).
- To build or extend a template, put all new blocks in ONE add_blocks call in display order.
- Only use block ids that appear in the editor state below or in earlier tool results. Never guess ids of blocks that do not exist yet.
- The editor state below is always current; do not call get_editor_state just to re-check. Do not repeat a successful action.
- For a new report template: change the existing title, keep the date block (or use a period block for weekly/monthly reports), then subheadings, text, tables and charts in a sensible order with realistic Korean labels. Leave table values empty unless the user gives data.
- Charts without real data: use plausible sample values (never all zeros) and tell the user they are samples to replace or bind to the DB.
- Tables: first row(s) are headers (header_rows). Keep 2-8 columns unless asked. For side-by-side blocks use width_percent (e.g. 50 + 50).
- Period blocks only hold start/end date-times; write explanatory text in a separate text block.
- Data: run_query before bind_data to check column names. Never modify data; only SELECT/WITH queries are allowed.
- Changes are not stored until save_template. When you finish creating or editing a template, ask whether to save unless the user already asked to save.
- Ask the user before destructive actions (deleting pages/templates, discarding unsaved changes) unless they explicitly requested them.
- If a tool returns an error, fix the arguments and retry once; otherwise explain the problem.
- You cannot insert images, manage users/permissions, or change server settings; say so if asked.
- Table cell text is always dark: choose light cell background colors (e.g. #DCE6F2, #FFF2CC) even if the user asks for a dark header; explain the substitution.
- Finish with a short summary of what changed as a few bullet points. Do not use markdown tables or headings.

Current editor state (JSON):
${JSON.stringify(state)}`;
}
