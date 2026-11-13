import test from "node:test";
import assert from "node:assert/strict";
import { SHAPES, createShapeConfig, shapeSvgMarkup } from "../src/shapes.js";

test("every shape renders well-formed SVG", () => {
  for (const shape of SHAPES) {
    const markup = shapeSvgMarkup(createShapeConfig(shape.id));
    assert.match(markup, /^<svg [^>]*width="\d+" height="\d+"/, shape.id);
    assert.match(markup, /<path d="M[^"]+"/, shape.id);
    assert.ok(markup.endsWith("</svg>"), shape.id);
  }
});

test("arrow lines use pixel coordinates so arrowheads are not stretched", () => {
  const markup = shapeSvgMarkup({ ...createShapeConfig("arrow-line"), width: 300, height: 20 });
  assert.match(markup, /viewBox="0 0 300 20"/);
  assert.match(markup, /marker-end="url\(#arrow-/);
});

test("rejects unsafe colour and size values from stored templates", () => {
  const markup = shapeSvgMarkup({
    kind: "rect",
    fill: '"/><script>alert(1)</script>',
    stroke: "red\" onload=\"x",
    strokeWidth: "9999",
    width: "abc",
    height: -5,
  });
  assert.doesNotMatch(markup, /script|onload/);
  assert.match(markup, /fill="none"/);
  assert.match(markup, /stroke-width="40"/);
  assert.match(markup, /width="160" height="4"/);
});
