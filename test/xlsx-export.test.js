import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildXlsxFiles, columnName, exportReportToXlsxBuffer, parseNumericCell } from "../src/report-export/xlsx-export.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const report = {
  type: "custom-x",
  layoutType: "weekly",
  date: "2026-11-07",
  reportTitle: "주간 <실적> & 현황",
  pages: [
    {
      blocks: [
        { id: "t", type: "title", content: "실적 보고", fontSize: 18, align: "center" },
        { id: "p", type: "text", content: "첫 줄\n둘째 줄" },
        {
          id: "tb",
          type: "table",
          heading: "매출",
          fontSize: 9,
          gridVersion: 1,
          columns: ["", "", ""],
          rows: [
            { cells: ["구분", "", "증감"], isTitleRow: true, cellStyles: [{ backgroundColor: "#eeeeee" }, {}, {}] },
            { cells: ["1,234", "12.5%", "▲3"], cellStyles: [{}, {}, {}] },
            { cells: ["007", "-4", "a\nb"], cellStyles: [{}, {}, {}] },
          ],
          merges: [{ row: 0, column: 0, rowspan: 1, colspan: 2 }],
        },
        { id: "c", type: "chart", chart: { title: "추이", height: 240 } },
      ],
    },
    { blocks: [{ id: "d", type: "divider" }, { id: "e", type: "text", content: "2쪽" }] },
  ],
  headerFooter: {
    header: { left: "{제목}", center: "", right: "" },
    footer: { left: "", center: "{페이지} / {전체페이지}", right: "" },
    pageNumber: { format: "number", start: 1 },
  },
};
const images = { c: { src: PNG, width: 479, height: 240 } };

test("parses numeric-looking cell text into numbers with formats", () => {
  assert.deepEqual(parseNumericCell("1,234"), { value: 1234, format: "#,##0" });
  assert.deepEqual(parseNumericCell("-12.50"), { value: -12.5, format: "0.00" });
  assert.deepEqual(parseNumericCell("42"), { value: 42, format: "" });
  assert.deepEqual(parseNumericCell("12.5%"), { value: 0.125, format: "0.0%" });
  for (const text of ["007", "▲3", "", "1,23", "12-3", "1e5", "2026-11-07"]) {
    assert.equal(parseNumericCell(text), null, text);
  }
});

test("names spreadsheet columns", () => {
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(columnName), ["A", "Z", "AA", "AB", "ZZ", "AAA"]);
});

test("writes one sheet per page with real table cells, merges and numbers", () => {
  const files = buildXlsxFiles(report, { images });
  const workbook = files["xl/workbook.xml"];
  assert.match(workbook, /<sheet name="1페이지" sheetId="1" r:id="rId1"\/>/);
  assert.match(workbook, /<sheet name="2페이지" sheetId="2" r:id="rId2"\/>/);

  const sheet = files["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<t xml:space="preserve">실적 보고<\/t>/);
  assert.match(sheet, /<t xml:space="preserve">첫 줄<\/t>[\s\S]*<t xml:space="preserve">둘째 줄<\/t>/);
  assert.match(sheet, /<v>1234<\/v>/, "comma numbers become numeric cells");
  assert.match(sheet, /<v>0.125<\/v>/, "percent becomes a fraction");
  assert.match(sheet, /<t xml:space="preserve">007<\/t>/, "leading zeros stay text");
  assert.match(sheet, /<t xml:space="preserve">▲3<\/t>/);
  assert.match(sheet, /<mergeCell ref="A\d+:B\d+"\/>/, "table merge");
  assert.match(sheet, /<mergeCell ref="A1:F1"\/>/, "centered title spans the sheet width");
  assert.match(sheet, /<drawing r:id="rId1"\/>/);
  assert.match(sheet, /<oddHeader>&amp;L주간 &lt;실적&gt; &amp;&amp; 현황<\/oddHeader>/);
  assert.match(sheet, /<oddFooter>&amp;C&amp;P \/ &amp;N<\/oddFooter>/);
  assert.match(files["xl/worksheets/sheet2.xml"], /2쪽/);
  assert.equal(files["xl/worksheets/_rels/sheet2.xml.rels"], undefined, "no drawing without pictures");

  // 모든 셀 서식 번호가 styles.xml 에 있어야 한다.
  const styles = files["xl/styles.xml"];
  const xfCount = Number(/<cellXfs count="(\d+)">/.exec(styles)[1]);
  assert.equal((styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/)[0].match(/<xf /g) ?? []).length, xfCount);
  for (const name of Object.keys(files).filter((file) => file.startsWith("xl/worksheets/sheet"))) {
    for (const [, id] of files[name].matchAll(/ s="(\d+)"/g)) assert.ok(Number(id) < xfCount, `style ${id}`);
  }
  assert.match(styles, /<numFmt numFmtId="\d+" formatCode="#,##0"\/>/);
  assert.match(styles, /<fgColor rgb="FFEEEEEE"\/>/);
  assert.match(styles, /wrapText="1"/);
});

test("embeds charts as pictures and builds a valid package", async () => {
  const files = buildXlsxFiles(report, { images });
  assert.ok(files["xl/media/image1.png"] instanceof Uint8Array);
  assert.match(files["xl/drawings/drawing1.xml"], /<a:blip r:embed="rId1"\/>/);
  assert.match(files["xl/drawings/_rels/drawing1.xml.rels"], /Target="..\/media\/image1.png"/);
  assert.match(files["[Content_Types].xml"], /<Default Extension="png" ContentType="image\/png"\/>/);
  assert.match(files["[Content_Types].xml"], /PartName="\/xl\/drawings\/drawing1.xml"/);

  const zip = await JSZip.loadAsync(await exportReportToXlsxBuffer(report, { images }));
  assert.ok(zip.file("xl/workbook.xml"));
  assert.ok(zip.file("[Content_Types].xml"));
});

test("uses the report title as the sheet name for a single page", () => {
  const files = buildXlsxFiles({ reportTitle: "a/b:[c]", blocks: [{ id: "x", type: "text", content: "본문" }] });
  assert.match(files["xl/workbook.xml"], /<sheet name="a_b__c_"/);
});
