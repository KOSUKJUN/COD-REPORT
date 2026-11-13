import { createApp } from "vue";
import MailRender from "./components/MailRender.vue";
import { nextTick } from "vue";
import { exportElementsToPdf } from "./report-export/pdf-export.js";
import "../styles.css";

window.renderMailReport = async (report) => {
  const app = createApp(MailRender, { report });
  app.mount("#app");
  await nextTick();
  await document.fonts.ready;
  const start = Date.now();
  while ([...document.querySelectorAll(".report-chart")].some((chart) => chart.dataset.chartReady !== "true")) {
    if (Date.now() - start > 15000) throw new Error("차트 렌더링 시간이 초과되었습니다.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (document.querySelector(".report-chart-issue")) throw new Error("보고서 차트를 표시할 수 없습니다.");
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const elements = [...document.querySelectorAll(".report")];
  if (!elements.length) throw new Error("보고서 페이지를 표시할 수 없습니다.");
  const pdf = await exportElementsToPdf(elements, { title: report.reportTitle || report.templateName, pageSetup: report.pageSetup });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("PDF를 읽을 수 없습니다."));
    reader.readAsDataURL(pdf);
  });
};
