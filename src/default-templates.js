// 예전에 코드에 고정돼 있던 기본 양식(일일/주간/월간업무보고)의 내용.
// 서버가 처음 한 번 일반 양식으로 DB에 옮길 때만 사용한다. 옮긴 뒤에는 다른 양식처럼 수정·삭제할 수 있다.
import { normalizeTableBlock } from "./reports-api.js";

let nextId = 0;

function createBlock(type, properties = {}) {
  return {
    id: `report-item-${Date.now()}-${++nextId}`,
    type,
    heading: "",
    content: "",
    fontSize: type === "title" ? 27 : 14,
    align: "left",
    ...properties,
  };
}

function createDailyBlocks() {
  const emptyRow = (label) => ({ label, cells: ["-", "-", "-", "-", "-", "-"] });
  return [
    createBlock("title", { content: "위협 보안관제 현황(가천대길병원)", fontSize: 18, align: "center" }),
    createBlock("period", { start: "2026-10-31T08:00", end: "2026-11-01T08:00" }),
    createBlock("subheading", { content: "1. 보안관제 업무", fontSize: 12 }),
    createBlock("table", {
      heading: "1) 탐지 종합 현황",
      unit: "(단위: 건)",
      fontSize: 8,
      groupHeaders: [
        { label: "구분", colspan: 1, rowspan: 2 },
        { label: "총 관제", colspan: 1, rowspan: 2 },
        { label: "탐지", colspan: 1, rowspan: 2 },
        { label: "분석", colspan: 3, rowspan: 1 },
        { label: "반복 탐지", colspan: 1, rowspan: 2 },
      ],
      columns: ["총 관제", "탐지", "무시 종결", "자체 종결", "조치 요구", "반복 탐지"],
      subHeaders: ["무시 종결", "자체 종결", "조치 요구"],
      rows: [
        { label: "전일", cells: ["258", "97", "9", "4", "0", "84"] },
        { label: "금일", cells: ["40", "26", "7", "5", "0", "14"] },
        { label: "증감", cells: ["▼218", "▼71", "▼2", "▲1", "-", "▼70"] },
      ],
      definitions: [
        "총관제: 기관별 위협탐지 총건수",
        "탐지: 센터 경보 분석 탐지된 건수",
        "무시종결: 상세 분석 결과, 정상 통신 및 오탐 등 공격 유효성이 없어 종결하는 건",
        "자체종결: 상세 분석 결과, 공격 위협은 탐지되었으나 공격 유효성이 없어 종결하는 건",
        "조치요구: 장비에서 유효성 확인이 필요하여 기관에 조치 권고한 건수",
        "반복탐지: 탐지 건 중 동일 정보가 지속 발생한 건수",
      ],
    }),
    createBlock("special", { heading: "〈관제 특이사항〉", content: "○ 특이사항 없음" }),
    createBlock("table", {
      heading: "2) 위협 의심유형 대응현황",
      fontSize: 8,
      columns: ["발생일시", "기관명", "위협유형", "조치요구일시", "조치완료일시", "비고"],
      rows: [emptyRow("회신 대기"), emptyRow("회신 종결")],
      summary: "(1) 회신 대기: 0건\n(2) 회신 종결: 0건",
    }),
    createBlock("table", {
      heading: "3) 홈페이지 위변조 대응현황",
      fontSize: 8,
      columns: ["발생일시", "기관명", "위협유형", "조치요구일시", "조치완료일시", "비고"],
      rows: [emptyRow("확인 요청"), emptyRow("종결")],
      summary: "(1) 확인 요청: 0건\n(2) 종결: 0건",
    }),
  ].map((block) => (block.type === "table" ? normalizeTableBlock(block) : block));
}

function createSectionBlocks(title, sections) {
  return [
    createBlock("title", { content: title }),
    createBlock("date"),
    createBlock("divider"),
    ...sections.map((section) => createBlock("section", section)),
  ];
}

// legacyType: 예전 기본 양식 id. 이 유형으로 저장된 리포트를 새 양식으로 옮길 때 쓴다.
export function createDefaultTemplates() {
  return [
    { legacyType: "daily", label: "일일업무보고", layoutType: "daily", blocks: createDailyBlocks() },
    {
      legacyType: "weekly",
      label: "주간업무보고",
      layoutType: "weekly",
      blocks: createSectionBlocks("주간 업무 보고서", [
        { heading: "주간 업무 요약", content: "이번 주 주요 진행 상황을 정리합니다." },
        { heading: "완료한 업무 및 성과", content: "• 완료한 작업과 결과" },
        { heading: "진행 중인 업무 및 이슈", content: "• 진행 중인 업무와 참고 사항" },
        { heading: "다음 주 계획", content: "• 다음 주 주요 계획" },
      ]),
    },
    {
      legacyType: "monthly",
      label: "월간업무보고",
      layoutType: "monthly",
      blocks: createSectionBlocks("월간 업무 보고서", [
        { heading: "월간 업무 요약", content: "이번 달 주요 업무와 진행 상황을 정리합니다." },
        { heading: "주요 성과", content: "• 이번 달 완료한 업무와 성과" },
        { heading: "미완료 업무 및 개선 사항", content: "• 미완료 업무와 개선이 필요한 사항" },
        { heading: "다음 달 계획", content: "• 다음 달 주요 목표와 계획" },
      ]),
    },
  ].map((template) => ({
    ...template,
    group: "양식",
    pages: [{ id: `report-page-${template.legacyType}`, blocks: template.blocks }],
  }));
}
