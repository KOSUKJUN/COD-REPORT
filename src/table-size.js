// 표 열 너비·행 높이
// - block.columnWidths: 열마다 너비(%) — 합이 100. 없으면 모든 열이 같은 너비.
// - row.height: 행 높이(px, 용지 기준 = pt). 없으면 기본 높이(내용에 맞춤).

export const MIN_COLUMN_PERCENT = 3;
export const MIN_ROW_HEIGHT = 14;
export const MAX_ROW_HEIGHT = 400;
export const DEFAULT_ROW_HEIGHT = 19;

// 열 수와 맞는 너비 배열(%)을 돌려준다. 저장된 값이 없거나 맞지 않으면 null(같은 너비).
export function getColumnWidths(block) {
  const count = block?.columns?.length ?? 0;
  const widths = block?.columnWidths;
  if (!count || !Array.isArray(widths) || widths.length !== count) return null;
  const values = widths.map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => (value / total) * 100);
}

// 저장된 값이 없으면 같은 너비로 채운 배열(%)
export function resolvedColumnWidths(block, count = block?.columns?.length ?? 0) {
  const widths = getColumnWidths(block);
  if (widths && widths.length === count) return widths;
  return Array.from({ length: count }, () => (count ? 100 / count : 100));
}

export function rowHeight(row) {
  const value = Number(row?.height);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function clampRowHeight(value) {
  return Math.round(Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, value)));
}

// 경계(boundary 열과 그다음 열 사이)를 deltaPercent 만큼 옮긴다. 두 열의 합은 그대로 둔다.
export function moveColumnBoundary(widths, boundary, deltaPercent) {
  const next = [...widths];
  const pair = next[boundary] + next[boundary + 1];
  const left = Math.min(pair - MIN_COLUMN_PERCENT, Math.max(MIN_COLUMN_PERCENT, next[boundary] + deltaPercent));
  next[boundary] = roundPercent(left);
  next[boundary + 1] = roundPercent(pair - left);
  return next;
}

// 열을 넣거나 뺀 뒤 합을 100으로 맞춘다.
export function normalizeColumnWidths(widths) {
  const total = widths.reduce((sum, value) => sum + value, 0) || 1;
  return widths.map((value) => roundPercent((value / total) * 100));
}

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}
