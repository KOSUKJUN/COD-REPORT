import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { helpCategories, searchHelp } from "../src/help-content.js";

const articlesOf = (categories) => categories.flatMap((category) =>
  category.groups.flatMap((group) => group.articles));

test("manual has unique three-level navigation and full HD local screenshots", async () => {
  const ids = new Set();
  const images = new Set();
  for (const category of helpCategories) {
    assert.ok(category.title && category.groups.length);
    for (const node of [category, ...category.groups]) {
      assert.ok(!ids.has(node.id), `duplicate navigation id: ${node.id}`);
      ids.add(node.id);
    }
    for (const group of category.groups) {
      assert.ok(group.title && group.articles.length);
      for (const article of group.articles) {
        assert.ok(!ids.has(article.id), `duplicate article: ${article.id}`);
        ids.add(article.id);
        assert.ok(article.title && article.intro && article.caption && article.steps.length >= 4, article.id);
        for (const figure of [{ image: article.image, caption: article.caption }, ...(article.figures ?? [])]) {
          assert.ok(figure.caption, `missing caption: ${article.id}`);
          assert.match(figure.image, /^[a-z0-9-]+\.png$/);
          images.add(figure.image);
        }
      }
    }
  }
  assert.ok(articlesOf(helpCategories).length >= 40);
  for (const image of images) {
    const data = await readFile(new URL(`../public/help/${image}`, import.meta.url));
    assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", image);
    assert.equal(data.readUInt32BE(16), 1920, image);
    assert.equal(data.readUInt32BE(20), 1080, image);
  }
});

test("manual search preserves matching groups and supports multi-term content searches", () => {
  assert.equal(searchHelp(helpCategories, " ").length, helpCategories.length);
  for (const [query, id] of [
    ["ai 문서", "ai-import"], ["API 키", "ai-keys"], ["기간 시작", "generate"],
    ["행별 확인", "user-import"], ["표와 셀 음영", "table-cells"], ["사용자와 계정 잠금", "user-unlock"],
    ["메일 서버 SMTP", "mail-server"], ["양식 받는 사람 메일", "template-mail"], ["뷰어 보고서 메일 전송", "viewer-mail"],
  ]) {
    assert.ok(articlesOf(searchHelp(helpCategories, query)).some((article) => article.id === id), query);
  }
  const grouped = searchHelp(helpCategories, "차트 직접 입력");
  assert.ok(grouped.some((category) => category.groups.some((group) =>
    group.id === "editor-visuals" && group.articles.some((article) => article.id === "chart-direct"))));
  assert.deepEqual(searchHelp(helpCategories, "없는검색어"), []);
  assert.ok(articlesOf(helpCategories).find((article) => article.id === "user-import").figures.length);
  const mailSettings = articlesOf(helpCategories).find((article) => article.id === "template-mail");
  assert.equal(mailSettings.image, "template-mail.png");
  assert.ok(mailSettings.figures.some((figure) => figure.image === "template-mail-content.png"));
  assert.equal(articlesOf(helpCategories).find((article) => article.id === "mail-server").image, "mail-server.png");
  assert.equal(articlesOf(helpCategories).find((article) => article.id === "viewer-mail").image, "viewer-mail.png");
});
