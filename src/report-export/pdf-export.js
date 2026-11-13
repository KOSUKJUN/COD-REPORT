// 화면에 그려진 보고서 페이지(.report)를 그대로 이미지로 떠서 PDF로 만든다.
// 화면과 모양이 완전히 같지만 PDF 안의 글자는 선택·검색되지 않는다.
// 용지 크기는 보고서의 pageSetup(기본 A4 세로)을 따른다.
import { toCanvas } from "html-to-image";
import { jsPDF } from "jspdf";
import { getPageDimensions } from "../page-setup.js";

const PIXEL_RATIO = 3; // 약 216dpi
const JPEG_QUALITY = 0.92;

export function getPageSlices(canvasWidth, canvasHeight, page) {
  const height = (canvasWidth * page.heightPt) / page.widthPt;
  const slices = [];
  for (let top = 0; top < canvasHeight; top += height) {
    slices.push({ top, height: Math.min(height, canvasHeight - top) });
  }
  return slices;
}

function sliceCanvas(source, top, height, page) {
  const slice = document.createElement("canvas");
  slice.width = source.width;
  slice.height = Math.round((source.width * page.heightPt) / page.widthPt);
  const context = slice.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, slice.width, slice.height);
  context.drawImage(source, 0, top, source.width, height, 0, 0, source.width, height);
  return slice;
}

export async function exportElementsToPdf(elements, { title, pageSetup, onProgress } = {}) {
  const page = getPageDimensions(pageSetup);
  const orientation = page.landscape ? "landscape" : "portrait";
  const format = [page.widthPt, page.heightPt];
  const pdf = new jsPDF({ unit: "pt", format, orientation, compress: true });
  pdf.setProperties({ title: title || "보고서", creator: "CODVILL cod-report" });
  let firstPdfPage = true;

  for (let index = 0; index < elements.length; index += 1) {
    onProgress?.(index + 1, elements.length);
    const element = elements[index];
    const canvas = await toCanvas(element, {
      pixelRatio: PIXEL_RATIO,
      backgroundColor: "#ffffff",
      skipFonts: true,
      style: { transform: "none", boxShadow: "none", margin: "0" },
    });

    // 용지를 넘는 내용은 길이에 관계없이 다음 쪽에 이어진다.
    for (const { top, height } of getPageSlices(canvas.width, canvas.height, page)) {
      const slice = sliceCanvas(canvas, top, height, page);
      if (!firstPdfPage) pdf.addPage(format, orientation);
      firstPdfPage = false;
      pdf.addImage(slice.toDataURL("image/jpeg", JPEG_QUALITY), "JPEG", 0, 0, page.widthPt, page.heightPt, undefined, "FAST");
    }
  }
  return pdf.output("blob");
}
