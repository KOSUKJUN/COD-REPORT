// 요소 배치: 영역 배치(기본, 위에서 아래로 흐르며 너비 % 로 가로 분할) 또는 자유 배치(용지 위 좌표, 겹침 허용).
//
// block.layout = {
//   mode: "flow" | "free",
//   width: 100,          // 영역 배치 너비(%) — 이어지는 요소들의 합이 100 이하면 한 줄에 나란히 놓인다
//   x, y, w,             // 자유 배치 위치·너비(px, 용지 왼쪽 위 기준)
//   wrap: "front" | "behind", // 자유 배치: 텍스트 앞 / 텍스트 뒤
//   z: 0,                // 자유 배치 겹침 순서
//   h: null,             // 높이(px, 최소 높이). null = 내용에 맞춤
// }

export const PAGE_WIDTH_PX = 595;
export const PAGE_HEIGHT_PX = 842;
export const MIN_FLOW_WIDTH = 10;

export const SPLIT_PRESETS = [
  { id: "1", label: "1단 (전체 너비)", widths: [100] },
  { id: "2", label: "2단", widths: [50, 50] },
  { id: "2-left", label: "2단 (왼쪽 넓게)", widths: [66.67, 33.33] },
  { id: "2-right", label: "2단 (오른쪽 넓게)", widths: [33.33, 66.67] },
  { id: "3", label: "3단", widths: [33.33, 33.33, 33.34] },
  { id: "4", label: "4단", widths: [25, 25, 25, 25] },
];

export const WIDTH_PRESETS = [100, 75, 66.67, 50, 33.33, 25];

export function getLayout(block) {
  const layout = block?.layout ?? {};
  const mode = layout.mode === "free" ? "free" : "flow";
  return {
    mode,
    width: clampWidth(layout.width ?? 100),
    x: Number(layout.x) || 0,
    y: Number(layout.y) || 0,
    w: Number(layout.w) || 240,
    wrap: layout.wrap === "behind" ? "behind" : "front",
    z: Number(layout.z) || 0,
    h: clampHeight(layout.h),
  };
}

export const MIN_BLOCK_HEIGHT = 16;
export const MAX_BLOCK_HEIGHT = 1200;

// 요소 높이(px). null 이면 내용에 맞춘다(자동).
export function clampHeight(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.min(MAX_BLOCK_HEIGHT, Math.max(MIN_BLOCK_HEIGHT, Math.round(number)));
}

// 높이 조정 방식: 차트·도형은 자체 크기, 구분선은 없음, 나머지는 layout.h
export function heightTarget(block) {
  if (block?.type === "chart") return "chart";
  if (block?.type === "shape") return "shape";
  if (block?.type === "divider") return null;
  return "layout";
}

export function isFree(block) {
  return block?.layout?.mode === "free";
}

export function clampWidth(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 100;
  return Math.min(100, Math.max(MIN_FLOW_WIDTH, Math.round(number * 100) / 100));
}

// 끌어서 너비를 바꿀 때 자주 쓰는 비율(25·33·50·67·75·100)에 가까우면 맞춘다.
export function snapWidth(value, tolerance = 2.5) {
  const width = clampWidth(value);
  const snap = WIDTH_PRESETS.find((preset) => Math.abs(preset - width) <= tolerance);
  return snap ?? Math.round(width);
}

// 영역 배치 요소를 화면과 같은 규칙으로 줄(row)로 묶는다.
// 너비 합이 100 을 넘으면 다음 줄로 넘어간다. 자유 배치 요소는 제외한다.
export function groupFlowRows(blocks) {
  const rows = [];
  let current = null;
  for (const block of blocks ?? []) {
    if (isFree(block)) continue;
    const width = getLayout(block).width;
    if (!current || current.total + width > 100.5) {
      current = { total: 0, items: [] };
      rows.push(current);
    }
    current.items.push({ block, width });
    current.total += width;
  }
  return rows.map((row) => row.items);
}

// 선택한 요소부터 이어지는 요소들에 분할 비율을 적용한다. 바뀐 요소 수를 돌려준다.
export function applySplit(blocks, startIndex, presetId) {
  const preset = SPLIT_PRESETS.find((item) => item.id === presetId);
  if (!preset || startIndex < 0) return 0;
  const flow = blocks.slice(startIndex).filter((block) => !isFree(block));
  const targets = flow.slice(0, preset.widths.length);
  targets.forEach((block, index) => {
    block.layout = { ...(block.layout ?? {}), mode: "flow", width: preset.widths[index] };
  });
  // 1단으로 되돌릴 때는 원래 같은 줄에 있던 나머지 요소도 전체 너비로 돌린다.
  if (preset.id === "1") {
    for (const block of flow.slice(1)) {
      if (getLayout(block).width >= 100) break;
      block.layout = { ...(block.layout ?? {}), width: 100 };
    }
  }
  return targets.length;
}
