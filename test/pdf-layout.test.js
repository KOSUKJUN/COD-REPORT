import test from "node:test";
import assert from "node:assert/strict";
import { getPageSlices } from "../src/report-export/pdf-export.js";

test("PDF preserves overflow smaller than two percent of the page", () => {
  const page = { widthPt: 595, heightPt: 842 };
  assert.deepEqual(getPageSlices(595, 842, page), [{ top: 0, height: 842 }]);
  assert.deepEqual(getPageSlices(595, 850, page), [{ top: 0, height: 842 }, { top: 842, height: 8 }]);
  assert.deepEqual(getPageSlices(1190, 1700, page), [{ top: 0, height: 1684 }, { top: 1684, height: 16 }]);
});
