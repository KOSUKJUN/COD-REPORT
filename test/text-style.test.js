import test from "node:test";
import assert from "node:assert/strict";
import {
  THEME_COLORS,
  applyTextStylePatch,
  changeTextCase,
  clampFontSize,
  clearTextStyle,
  growFontSize,
  nextCycledCase,
  pickTextStyle,
  shrinkFontSize,
  textStyleToCss,
} from "../src/text-style.js";

test("grows and shrinks font size along the Word size list", () => {
  assert.equal(growFontSize(11), 12);
  assert.equal(growFontSize(12), 14);
  assert.equal(growFontSize(13), 14);
  assert.equal(growFontSize(72), 80);
  assert.equal(shrinkFontSize(14), 12);
  assert.equal(shrinkFontSize(10.5), 10);
  assert.equal(shrinkFontSize(8), 7);
  assert.equal(shrinkFontSize(6), 6);
  assert.equal(clampFontSize("200"), 96);
  assert.equal(clampFontSize("10.3"), 10.5);
  assert.equal(clampFontSize("abc"), null);
});

test("changes letter case like Word without touching Korean text", () => {
  assert.equal(changeTextCase("보안 report SUMMARY", "upper"), "보안 REPORT SUMMARY");
  assert.equal(changeTextCase("보안 Report SUMMARY", "lower"), "보안 report summary");
  assert.equal(changeTextCase("weekly security report", "title"), "Weekly Security Report");
  assert.equal(changeTextCase("FIRST LINE. second line\nthird", "sentence"), "First line. Second line\nThird");
  assert.equal(changeTextCase("Hello 세계", "toggle"), "hELLO 세계");
  assert.equal(nextCycledCase("abc"), "upper");
  assert.equal(nextCycledCase("ABC"), "title");
  assert.equal(nextCycledCase("Abc"), "lower");
});

test("patches and clears text styles, dropping empty values", () => {
  const style = { color: "#ff0000", bold: true };
  applyTextStylePatch(style, { color: "", italic: true, bold: false });
  assert.deepEqual(style, { bold: false, italic: true });

  const cell = { backgroundColor: "#eeeeee", bold: true, fontSize: 10 };
  clearTextStyle(cell);
  assert.deepEqual(cell, { backgroundColor: "#eeeeee" });

  assert.deepEqual(pickTextStyle({ backgroundColor: "#fff", underline: true, color: "" }), {
    underline: true,
  });
});

test("converts styles to CSS", () => {
  assert.equal(textStyleToCss({}), undefined);
  assert.deepEqual(
    textStyleToCss({ underline: true, underlineStyle: "wavy", strike: true, bold: true }),
    {
      fontWeight: 700,
      textDecorationLine: "underline line-through",
      textDecorationStyle: "wavy",
      textUnderlineOffset: "0.18em",
    },
  );
  const highlighted = textStyleToCss({ highlight: "#ffff00", shading: true, fontFamily: "Batang" });
  assert.equal(highlighted.backgroundColor, "#ffff00");
  assert.match(highlighted.fontFamily, /Batang/);
  assert.equal(textStyleToCss({ shading: true }).backgroundColor, "#d9d9d9");
  assert.equal(textStyleToCss({ script: "super" }).verticalAlign, "super");
  assert.equal(textStyleToCss({ fontSize: 10 }), undefined);
  assert.equal(textStyleToCss({ fontSize: 10 }, { includeFontSize: true }).fontSize, "10px");
});

test("builds a 6 x 10 theme palette of valid hex colors", () => {
  assert.equal(THEME_COLORS.length, 6);
  for (const row of THEME_COLORS) {
    assert.equal(row.length, 10);
    for (const color of row) assert.match(color.value, /^#[0-9a-f]{6}$/);
  }
});
