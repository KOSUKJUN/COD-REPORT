import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// pdf.js가 한글 PDF를 그릴 때 필요한 CMap·표준 글꼴·wasm을 /pdfjs/ 아래로 제공한다.
// 설치된 pdfjs-dist에서 바로 읽으므로 패키지를 올려도 버전이 어긋나지 않는다.
function pdfjsAssets() {
  const root = fileURLToPath(new URL("./node_modules/pdfjs-dist/", import.meta.url));
  const folders = ["cmaps", "standard_fonts", "wasm"];
  const types = { ".wasm": "application/wasm", ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream", ".ttf": "font/ttf" };
  return {
    name: "pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (request, response, next) => {
        const [folder, file, extra] = decodeURIComponent(request.url.split("?")[0]).replace(/^\/+/, "").split("/");
        const path = folders.includes(folder) && file && !extra && /^[\w.-]+$/.test(file) ? join(root, folder, file) : null;
        if (!path || !existsSync(path)) return next();
        response.setHeader("Content-Type", types[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream");
        createReadStream(path).pipe(response);
      });
    },
    generateBundle() {
      for (const folder of folders) {
        for (const file of readdirSync(join(root, folder))) {
          const path = join(root, folder, file);
          if (statSync(path).isFile()) this.emitFile({ type: "asset", fileName: `pdfjs/${folder}/${file}`, source: readFileSync(path) });
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [vue(), pdfjsAssets()],
  build: {
    // 차트 엔진(ECharts)은 차트를 처음 그릴 때만 따로 받는 파일이라 크기 경고 기준을 높인다.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: { main: "index.html", mailRender: "mail-render.html" },
    },
  },
  server: {
    port: 19080,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
});
