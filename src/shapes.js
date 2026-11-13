// 도형 목록(Word 도형 갤러리 구성). 모든 도형은 100×100 좌표로 정의하고
// 너비·높이에 맞춰 늘리며(preserveAspectRatio="none"), 선 두께는 늘어나지 않게 그린다.

function polygon(points) {
  return `M${points.map(([x, y]) => `${x} ${y}`).join(" L")} Z`;
}

function regularPolygon(sides, rotation = -90, radius = 48) {
  return polygon(Array.from({ length: sides }, (_, index) => {
    const angle = ((rotation + (360 / sides) * index) * Math.PI) / 180;
    return [Math.round((50 + radius * Math.cos(angle)) * 100) / 100, Math.round((50 + radius * Math.sin(angle)) * 100) / 100];
  }));
}

function star(points, inner = 0.42) {
  return polygon(Array.from({ length: points * 2 }, (_, index) => {
    const radius = index % 2 === 0 ? 48 : 48 * inner;
    const angle = ((-90 + (180 / points) * index) * Math.PI) / 180;
    return [Math.round((50 + radius * Math.cos(angle)) * 100) / 100, Math.round((50 + radius * Math.sin(angle)) * 100) / 100];
  }));
}

export const SHAPE_GROUPS = [
  {
    label: "선",
    shapes: [
      // 선은 늘어난 좌표계에서 화살촉이 찌그러지지 않도록 실제 크기(픽셀) 좌표로 그린다.
      { id: "line", label: "선", d: "M2 50 H98", line: (w, h) => `M4 ${h / 2} H${w - 4}` },
      { id: "arrow-line", label: "화살표 선", d: "M2 50 H98", line: (w, h) => `M4 ${h / 2} H${w - 4}`, arrowEnd: true },
      { id: "double-arrow-line", label: "양방향 화살표 선", d: "M2 50 H98", line: (w, h) => `M4 ${h / 2} H${w - 4}`, arrowStart: true, arrowEnd: true },
      { id: "diagonal-line", label: "대각선", d: "M2 98 L98 2", line: (w, h) => `M4 ${h - 4} L${w - 4} 4` },
    ],
  },
  {
    label: "사각형",
    shapes: [
      { id: "rect", label: "직사각형", d: "M2 2 H98 V98 H2 Z" },
      { id: "round-rect", label: "모서리가 둥근 직사각형", d: "M14 2 H86 A12 12 0 0 1 98 14 V86 A12 12 0 0 1 86 98 H14 A12 12 0 0 1 2 86 V14 A12 12 0 0 1 14 2 Z" },
      { id: "snip-rect", label: "한쪽 모서리가 잘린 사각형", d: "M2 2 H80 L98 20 V98 H2 Z" },
    ],
  },
  {
    label: "기본 도형",
    shapes: [
      { id: "ellipse", label: "타원", d: "M50 2 A48 48 0 1 1 49.99 2 Z" },
      { id: "triangle", label: "이등변 삼각형", d: polygon([[50, 2], [98, 98], [2, 98]]) },
      { id: "right-triangle", label: "직각 삼각형", d: polygon([[2, 2], [98, 98], [2, 98]]) },
      { id: "diamond", label: "마름모", d: polygon([[50, 2], [98, 50], [50, 98], [2, 50]]) },
      { id: "parallelogram", label: "평행 사변형", d: polygon([[22, 2], [98, 2], [78, 98], [2, 98]]) },
      { id: "trapezoid", label: "사다리꼴", d: polygon([[22, 2], [78, 2], [98, 98], [2, 98]]) },
      { id: "pentagon", label: "오각형", d: regularPolygon(5) },
      { id: "hexagon", label: "육각형", d: regularPolygon(6, 0) },
      { id: "octagon", label: "팔각형", d: regularPolygon(8, 22.5) },
      { id: "plus", label: "덧셈 기호", d: polygon([[35, 2], [65, 2], [65, 35], [98, 35], [98, 65], [65, 65], [65, 98], [35, 98], [35, 65], [2, 65], [2, 35], [35, 35]]) },
      { id: "frame", label: "액자", d: "M2 2 H98 V98 H2 Z M14 14 V86 H86 V14 Z", evenOdd: true },
      { id: "donut", label: "도넛", d: "M50 2 A48 48 0 1 1 49.99 2 Z M50 26 A24 24 0 1 0 50.01 26 Z", evenOdd: true },
    ],
  },
  {
    label: "블록 화살표",
    shapes: [
      { id: "arrow-right", label: "오른쪽 화살표", d: polygon([[2, 28], [62, 28], [62, 6], [98, 50], [62, 94], [62, 72], [2, 72]]) },
      { id: "arrow-left", label: "왼쪽 화살표", d: polygon([[98, 28], [38, 28], [38, 6], [2, 50], [38, 94], [38, 72], [98, 72]]) },
      { id: "arrow-up", label: "위쪽 화살표", d: polygon([[28, 98], [28, 38], [6, 38], [50, 2], [94, 38], [72, 38], [72, 98]]) },
      { id: "arrow-down", label: "아래쪽 화살표", d: polygon([[28, 2], [28, 62], [6, 62], [50, 98], [94, 62], [72, 62], [72, 2]]) },
      { id: "arrow-left-right", label: "왼쪽/오른쪽 화살표", d: polygon([[2, 50], [26, 8], [26, 30], [74, 30], [74, 8], [98, 50], [74, 92], [74, 70], [26, 70], [26, 92]]) },
      { id: "chevron", label: "갈매기형 수장", d: polygon([[2, 2], [70, 2], [98, 50], [70, 98], [2, 98], [30, 50]]) },
      { id: "pentagon-arrow", label: "오각형 화살표", d: polygon([[2, 2], [72, 2], [98, 50], [72, 98], [2, 98]]) },
    ],
  },
  {
    label: "별 및 현수막",
    shapes: [
      { id: "star-4", label: "꼭짓점 4개인 별", d: star(4, 0.38) },
      { id: "star-5", label: "꼭짓점 5개인 별", d: star(5) },
      { id: "star-8", label: "꼭짓점 8개인 별", d: star(8, 0.7) },
      { id: "ribbon", label: "리본", d: polygon([[2, 20], [98, 20], [86, 50], [98, 80], [2, 80], [14, 50]]) },
    ],
  },
  {
    label: "설명선",
    shapes: [
      { id: "callout-rect", label: "사각형 설명선", d: "M2 2 H98 V72 H44 L24 98 L28 72 H2 Z" },
      { id: "callout-round", label: "모서리가 둥근 사각형 설명선", d: "M12 2 H88 A10 10 0 0 1 98 12 V62 A10 10 0 0 1 88 72 H44 L24 98 L28 72 H12 A10 10 0 0 1 2 62 V12 A10 10 0 0 1 12 2 Z" },
      { id: "callout-oval", label: "타원형 설명선", d: "M30 70 A46 34 0 1 1 46 74 L20 98 Z" },
    ],
  },
];

export const SHAPES = SHAPE_GROUPS.flatMap((group) => group.shapes);

export function getShape(id) {
  return SHAPES.find((shape) => shape.id === id) ?? SHAPES.find((shape) => shape.id === "rect");
}

export function createShapeConfig(kind = "rect") {
  const shape = getShape(kind);
  return {
    kind: shape.id,
    fill: shape.line ? "none" : "#4472C4",
    stroke: shape.line ? "#2f3646" : "#2F528F",
    strokeWidth: shape.line ? 2 : 1,
    width: shape.line ? 240 : 160,
    height: shape.line ? 24 : 90,
    opacity: 1,
  };
}

// 저장된 값이 SVG 문자열에 그대로 들어가므로 색은 #RGB/#RRGGBB(AA) 또는 none 만 허용한다.
function safeColor(value, fallback = "none") {
  return /^#[0-9a-f]{3,8}$/i.test(value ?? "") ? value : value === "none" ? "none" : fallback;
}

function safeNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

// 도형을 그릴 SVG 문자열 (캔버스·내보내기 공용)
export function shapeSvgMarkup(config, size = {}) {
  const shape = getShape(config?.kind);
  const width = safeNumber(size.width ?? config?.width, 160, 4, 2000);
  const height = safeNumber(size.height ?? config?.height, 90, 4, 2000);
  const stroke = safeColor(config?.stroke);
  const strokeWidth = safeNumber(config?.strokeWidth, 1, 0, 40);
  const fill = shape.line ? "none" : safeColor(config?.fill);
  const opacity = safeNumber(config?.opacity, 1, 0, 1);
  const markerId = `arrow-${Math.random().toString(36).slice(2, 8)}`;
  const markers = shape.arrowEnd || shape.arrowStart
    ? `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${stroke}"/></marker></defs>`
    : "";
  const markerAttrs = `${shape.arrowEnd ? ` marker-end="url(#${markerId})"` : ""}${shape.arrowStart ? ` marker-start="url(#${markerId})"` : ""}`;
  if (shape.line) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${markers}` +
      `<path d="${shape.line(width, height)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth || 1}" stroke-linecap="round" stroke-opacity="${opacity}"${markerAttrs}/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 100 100" preserveAspectRatio="none">` +
    `<path d="${shape.d}" fill="${fill}"${shape.evenOdd ? ' fill-rule="evenodd"' : ""} fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${strokeWidth}" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}
