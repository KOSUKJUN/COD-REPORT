// 사내 AI(Ollama)는 PDF를 직접 읽지 못하므로 브라우저에서 페이지별 PNG로 바꿔 보낸다.
// 긴 변 1800px 안팎이 작은 글씨를 살리면서도 처리 속도를 지키는 균형점이다.
export const PAGE_IMAGE_LONG_SIDE = 1800;
const MIN_LONG_SIDE = 1200;
export const MAX_PDF_PAGES = 30;
const MAX_BASE64_LENGTH = 12 * 1024 * 1024;

export function targetScale(width, height, longSide = PAGE_IMAGE_LONG_SIDE) {
  const current = Math.max(width, height);
  if (!(current > 0)) return 1;
  if (current > longSide) return longSide / current;
  if (current < MIN_LONG_SIDE) return MIN_LONG_SIDE / current;
  return 1;
}

function canvasToImage(canvas) {
  // 텍스트 경계가 선명한 PNG를 우선하고, 너무 크면 고화질 JPEG로 대신한다.
  let mimeType = "image/png";
  let url = canvas.toDataURL(mimeType);
  if (url.length - url.indexOf(",") - 1 > MAX_BASE64_LENGTH) {
    mimeType = "image/jpeg";
    url = canvas.toDataURL(mimeType, 0.92);
  }
  return { mimeType, data: url.slice(url.indexOf(",") + 1) };
}

function whiteCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  // 투명 배경 이미지는 모델이 검은 배경으로 오인할 수 있어 흰색으로 채운다.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

async function imageFileToPage(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = targetScale(bitmap.width, bitmap.height);
    const { canvas, context } = whiteCanvas(bitmap.width * scale, bitmap.height * scale);
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return [canvasToImage(canvas)];
  } finally {
    bitmap.close?.();
  }
}

async function pdfFileToPages(file, onProgress) {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const base = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;
  // 글꼴을 내장하지 않은 한글 PDF도 글자가 깨지지 않도록 CMap과 표준 글꼴을 함께 지정한다.
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${base}cmaps/`, cMapPacked: true, standardFontDataUrl: `${base}standard_fonts/`, wasmUrl: `${base}wasm/` });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`사내 AI 변환은 한 번에 ${MAX_PDF_PAGES}페이지까지 가능합니다. PDF를 나눠 주세요.`);
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      onProgress?.(number, pdf.numPages);
      const page = await pdf.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      // PDF는 벡터라 확대해도 흐려지지 않으므로 항상 목표 해상도로 그린다.
      const viewport = page.getViewport({ scale: PAGE_IMAGE_LONG_SIDE / Math.max(natural.width, natural.height) });
      const { canvas, context } = whiteCanvas(viewport.width, viewport.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      pages.push(canvasToImage(canvas));
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

export async function fileToPageImages(file, mimeType, onProgress) {
  try {
    return mimeType === "application/pdf" ? await pdfFileToPages(file, onProgress) : await imageFileToPage(file);
  } catch (error) {
    if (error?.message?.includes("페이지까지")) throw error;
    console.error("페이지 이미지 변환 실패:", error);
    if (error?.name === "PasswordException") throw new Error("암호가 걸린 PDF는 변환할 수 없습니다. 암호를 해제한 뒤 다시 시도해 주세요.");
    throw new Error("파일을 페이지 이미지로 바꾸지 못했습니다. 손상되지 않은 PDF, PNG, JPG인지 확인해 주세요.");
  }
}
