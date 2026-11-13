import { helpEditorCategories } from "./help-editor-content.js";
import { otherHelpCategories } from "./help-other-content.js";
import { helpDetails } from "./help-detail-content.js";

const groupDefinitions = {
  start: [
    { id: "start-workspace", title: "시작과 도움말", articles: ["workspace", "help-search"] },
  ],
  editor: [
    { id: "editor-pages", title: "화면과 페이지", articles: ["editor-overview", "pages", "page-add", "element-order"] },
    { id: "editor-elements", title: "요소와 문자 서식", articles: ["elements", "layout", "text-formatting", "header-footer"] },
    { id: "editor-tables", title: "표와 셀", articles: ["tables", "table-structure", "table-cells"] },
    { id: "editor-visuals", title: "그림·도형과 차트", articles: ["images-shapes", "charts", "chart-direct", "chart-database"] },
    { id: "editor-templates", title: "양식과 자동 생성", articles: ["templates", "template-save", "schedule", "template-mail", "permissions"] },
    { id: "editor-import", title: "양식 가져오기와 내보내기", articles: ["template-files", "ai-import"] },
    { id: "editor-assistant", title: "AI 어시스턴트", articles: ["ai-assistant", "assistant-requests", "assistant-review"] },
    { id: "editor-binding", title: "데이터 연결", articles: ["binding", "binding-parameters"] },
  ],
  viewer: [
    { id: "viewer-browse", title: "보고서 조회", articles: ["view-reports", "viewer-pages"] },
    { id: "viewer-create-edit", title: "보고서 생성과 수정", articles: ["generate", "viewer-edit", "viewer-save-cancel"] },
    { id: "viewer-output", title: "인쇄·내보내기와 메일", articles: ["view-edit-export", "viewer-mail"] },
  ],
  admin: [
    { id: "admin-settings", title: "접속·AI와 메일 설정", articles: ["datasources", "local-ai", "ai-keys", "mail-server"] },
    { id: "admin-users", title: "사용자와 계정", articles: ["users", "user-create", "user-status", "user-reset", "user-unlock"] },
    { id: "admin-bulk", title: "사용자 일괄 처리", articles: ["user-bulk", "user-import", "user-export"] },
    { id: "admin-groups", title: "그룹 관리", articles: ["groups"] },
  ],
};

const categories = [otherHelpCategories[0], ...helpEditorCategories, ...otherHelpCategories.slice(1)];

export const helpCategories = categories.map((category) => {
  const articles = [...category.articles, ...(helpDetails[category.id] ?? [])];
  const byId = new Map(articles.map((article) => [article.id, article]));
  const assigned = new Set();
  const groups = groupDefinitions[category.id].map((group) => ({
    id: group.id,
    title: group.title,
    articles: group.articles.map((id) => {
      if (!byId.has(id) || assigned.has(id)) throw new Error(`Invalid help article assignment: ${id}`);
      assigned.add(id);
      return byId.get(id);
    }),
  }));
  if (assigned.size !== articles.length) throw new Error(`Unassigned or duplicate help articles in ${category.id}`);
  return { id: category.id, title: category.title, groups };
});

export function searchHelp(categories, query) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return categories;
  return categories.map((category) => ({
    ...category,
    groups: category.groups.map((group) => ({
      ...group,
      articles: group.articles.filter((article) => {
        const text = [
          category.title, group.title, article.title, article.intro, article.caption,
          ...(article.steps ?? []), article.note ?? "",
          ...(article.figures ?? []).map((figure) => figure.caption),
        ].join(" ").toLocaleLowerCase();
        return terms.every((term) => text.includes(term));
      }),
    })).filter((group) => group.articles.length),
  })).filter((category) => category.groups.length);
}
