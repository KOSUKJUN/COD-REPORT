const FORMAT = "cod-report-template";
const VERSION = 1;
const TYPES = new Set(["title", "text", "section", "table", "special", "subheading", "period", "date", "divider", "image", "shape", "chart"]);
const OMIT_KEYS = new Set(["dataBinding", "summaryBinding", "datasourceId", "query", "sql", "parametersText"]);

function stripConnections(value) {
  if (Array.isArray(value)) return value.map(stripConnections);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !OMIT_KEYS.has(key) && !["__proto__", "constructor", "prototype"].includes(key))
    .map(([key, item]) => [key, stripConnections(item)]));
}

export function exportTemplatePages(pages) {
  return { format: FORMAT, version: VERSION, pages: stripConnections(pages.map(({ blocks }) => ({ blocks }))) };
}

export function importTemplatePages(document) {
  if (!document || document.format !== FORMAT || document.version !== VERSION ||
      !Array.isArray(document.pages) || !document.pages.length || document.pages.length > 50) {
    throw new Error("지원하지 않는 양식 파일이거나 페이지 형식이 올바르지 않습니다.");
  }
  let count = 0;
  const pages = document.pages.map((page) => {
    if (!page || !Array.isArray(page.blocks)) throw new Error("페이지 요소 형식이 올바르지 않습니다.");
    count += page.blocks.length;
    if (count > 1000) throw new Error("양식의 요소가 너무 많습니다.");
    return {
      blocks: page.blocks.map((block) => {
        if (!block || typeof block !== "object" || !TYPES.has(block.type)) {
          throw new Error("지원하지 않는 양식 요소가 있습니다.");
        }
        if (block.type === "table" && (!Array.isArray(block.columns) || block.columns.length > 30 ||
            !Array.isArray(block.rows) || block.rows.length > 100 ||
            block.rows.some((row) => !row || !Array.isArray(row.cells) || row.cells.length > 30 ||
              row.cells.some((cell) => typeof cell !== "string")))) {
          throw new Error("표 데이터 형식이 올바르지 않습니다.");
        }
        if (block.type === "image" && block.image?.src &&
            !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\r\n]+$/i.test(block.image.src)) {
          throw new Error("양식 파일에는 외부 이미지 주소를 사용할 수 없습니다.");
        }
        return stripConnections(block);
      }),
    };
  });
  return pages;
}

export function aiPagesToTemplate(value) {
  if (!value || !Array.isArray(value.pages) || !value.pages.length || value.pages.length > 50) {
    throw new Error("AI가 올바른 페이지 결과를 반환하지 않았습니다.");
  }
  const pages = value.pages.map((page) => {
    if (!page || !Array.isArray(page.elements) || page.elements.length > 200) {
      throw new Error("AI가 올바른 요소 목록을 반환하지 않았습니다.");
    }
    return { blocks: page.elements.map((element) => {
      if (!element || !["text", "title", "table", "shape", "chart"].includes(element.type)) {
        throw new Error("AI 결과에 지원하지 않는 요소가 있습니다.");
      }
      const { x, y, width, height } = element;
      if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width < 10 || height < 1 ||
          x + width > 595 || y + height > 842) {
        throw new Error("AI 결과의 요소 위치가 페이지 범위를 벗어났습니다.");
      }
      const fontSize = Math.min(40, Math.max(6, Number(element.fontSize) || 12));
      const layout = { mode: "free", x, y, w: width, h: height, wrap: "front", z: 0 };
      if (element.type === "shape") {
        const kinds = ["rect", "round-rect", "ellipse", "line", "arrow-line", "triangle", "diamond"];
        if (!kinds.includes(element.kind)) throw new Error("AI가 지원하지 않는 도형을 반환했습니다.");
        const shape = { ...createShapeConfig(element.kind), width, height };
        if (typeof element.fill === "string" && /^(none|#[a-f0-9]{6})$/i.test(element.fill)) shape.fill = element.fill;
        if (typeof element.stroke === "string" && /^(none|#[a-f0-9]{6})$/i.test(element.stroke)) shape.stroke = element.stroke;
        return { type: "shape", content: "", fontSize, align: "center", layout, shape };
      }
      if (element.type === "chart") {
        if (!["column", "bar", "line", "pie", "area"].includes(element.category) ||
            !Array.isArray(element.categories) || !element.categories.length || element.categories.length > 100 ||
            element.categories.some((item) => typeof item !== "string" || item.length > 200) ||
            !Array.isArray(element.series) || !element.series.length || element.series.length > 10 ||
            element.series.some((series) => !series || typeof series.name !== "string" || series.name.length > 200 ||
              !Array.isArray(series.values) || series.values.length !== element.categories.length ||
              series.values.some((number) => !Number.isFinite(number)))) {
          throw new Error("AI가 올바른 차트 데이터를 반환하지 않았습니다.");
        }
        return { type: "chart", content: "", fontSize, align: "center", layout,
          chart: { ...createChartConfig(element.category), title: typeof element.title === "string" ? element.title.slice(0, 200) : "", showTitle: Boolean(element.title), height },
          chartData: { categories: element.categories, series: element.series.map(({ name, values }) => ({ name, values })) } };
      }
      if (element.type === "table") {
        if (!Array.isArray(element.rows) || !element.rows.length || element.rows.length > 100 ||
            element.rows.some((row) => !Array.isArray(row) || !row.length || row.length > 30 ||
              row.some((cell) => typeof cell !== "string" || cell.length > 3000))) {
          throw new Error("AI가 올바른 표 데이터를 반환하지 않았습니다.");
        }
        const columns = Math.max(...element.rows.map((row) => row.length));
        const merges = element.merges ?? [];
        if (!Array.isArray(merges) || merges.length > 100 || merges.some((merge) =>
          !merge || ![merge.row, merge.column, merge.rowspan, merge.colspan].every(Number.isInteger) ||
          merge.row < 0 || merge.column < 0 || merge.rowspan < 1 || merge.colspan < 1 ||
          merge.row + merge.rowspan > element.rows.length || merge.column + merge.colspan > columns)) {
          throw new Error("AI가 올바른 표 병합 정보를 반환하지 않았습니다.");
        }
        const backgrounds = element.cellBackgrounds;
        if (backgrounds != null && (!Array.isArray(backgrounds) || backgrounds.length !== element.rows.length ||
            backgrounds.some((row, rowIndex) => !Array.isArray(row) || row.length !== element.rows[rowIndex].length ||
              row.some((color) => color !== null && (typeof color !== "string" || !/^#[a-f0-9]{6}$/i.test(color)))))) {
          throw new Error("AI가 올바른 표 음영 정보를 반환하지 않았습니다.");
        }
        return { type: "table", heading: "", fontSize, layout, gridVersion: 1,
          columns: Array(columns).fill(""), columnStyles: Array.from({ length: columns }, () => ({})),
          rows: element.rows.map((row, rowIndex) => ({
            cells: Array.from({ length: columns }, (_, i) => row[i] ?? ""),
            cellStyles: Array.from({ length: columns }, (_, i) =>
              backgrounds?.[rowIndex]?.[i] ? { backgroundColor: backgrounds[rowIndex][i] } : {}),
          })), merges };
      }
      if (typeof element.content !== "string" || element.content.length > 10000) {
        throw new Error("AI가 올바른 텍스트를 반환하지 않았습니다.");
      }
      const textStyle = {};
      if (typeof element.bold === "boolean") textStyle.bold = element.bold;
      if (typeof element.italic === "boolean") textStyle.italic = element.italic;
      if (typeof element.color === "string" && /^#[a-f0-9]{6}$/i.test(element.color)) textStyle.color = element.color;
      return { type: element.type, content: element.content, heading: "", fontSize, textStyle,
        align: ["left", "center", "right"].includes(element.align) ? element.align : "left", layout };
    }) };
  });
  if (!pages.some((page) => page.blocks.length)) throw new Error("AI가 편집 가능한 요소를 찾지 못했습니다.");
  return importTemplatePages({ format: FORMAT, version: VERSION, pages });
}
import { createShapeConfig } from "./shapes.js";
import { createChartConfig } from "./charts/chart-catalog.js";
