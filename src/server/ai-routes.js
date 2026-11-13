import { Router } from "express";
import { deleteAiKey, listAiKeyStatus, resolveAiKey, saveAiKey } from "./ai-keys.js";
import { listAiModels } from "./ai-models.js";
import { convertTemplateWithAi } from "./ai-template.js";
import {
  convertTemplateWithOllama, getOllamaBaseUrl, listOllamaModels, listOllamaServerModels, pickAssistantModel,
  requestAssistantChat, validateAssistantRequest,
} from "./ai-ollama.js";
import { getAiSettings, saveAiSettings } from "./ai-settings.js";

// 클라이언트가 연결을 끊으면(취소·창 닫기) 사내 AI 서버 작업도 멈춰 GPU를 바로 돌려준다.
function abortOnClose(response) {
  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableFinished) controller.abort();
  });
  return controller.signal;
}

function sendError(response, error, fallback) {
  if (response.headersSent || response.destroyed) return undefined;
  return response.status(error.status || 500).json({ error: error.status ? error.message : fallback });
}

export function createAiRouter({
  getPool, requireRoles, requireSameOrigin, models = listAiModels, convert = convertTemplateWithAi,
  ollamaModels = listOllamaModels, ollamaConvert = convertTemplateWithOllama, ollamaServerModels = listOllamaServerModels,
  assistantChat = requestAssistantChat, aiSettings = () => getAiSettings(getPool()),
  storeAiSettings = (input) => saveAiSettings(getPool(), input),
}) {
  const router = Router();
  router.get("/ai-keys", requireRoles("ADMIN", "EDITOR"), async (_request, response, next) => {
    try {
      const settings = await aiSettings();
      response.json({ providers: await listAiKeyStatus(getPool(), settings.ollamaBaseUrl || null) });
    } catch (error) {
      next(error);
    }
  });

  router.put("/ai-keys/:provider", requireRoles("ADMIN"), requireSameOrigin, async (request, response, next) => {
    try {
      await saveAiKey(getPool(), request.params.provider, request.body?.apiKey);
      response.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/ai-keys/:provider", requireRoles("ADMIN"), requireSameOrigin, async (request, response, next) => {
    try {
      await deleteAiKey(getPool(), request.params.provider);
      response.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  // ---------- 사내 AI 설정 (관리자) ----------
  router.get("/ai-settings", requireRoles("ADMIN"), async (_request, response, next) => {
    try {
      response.json({ settings: await aiSettings() });
    } catch (error) {
      next(error);
    }
  });

  router.put("/ai-settings", requireRoles("ADMIN"), requireSameOrigin, async (request, response) => {
    try {
      response.json({ settings: await storeAiSettings(request.body) });
    } catch (error) {
      console.error("사내 AI 설정 저장 실패:", error.status || 500);
      sendError(response, error, "사내 AI 설정을 저장하지 못했습니다.");
    }
  });

  // 저장 전 입력한 주소로도 확인할 수 있게 본문의 주소를 우선 쓴다. 관리자만 호출할 수 있다.
  router.post("/ai-settings/test", requireRoles("ADMIN"), requireSameOrigin, async (request, response) => {
    try {
      const input = request.body?.ollamaBaseUrl;
      const baseUrl = typeof input === "string" && input.trim() ? getOllamaBaseUrl(input) : (await aiSettings()).ollamaBaseUrl;
      if (!baseUrl) return response.status(400).json({ error: "서버 주소는 http:// 또는 https://로 시작하는 주소로 입력해 주세요." });
      const result = await ollamaServerModels({ baseUrl });
      return response.json({ ...result, recommendedAssistantModel: pickAssistantModel(result.models) });
    } catch (error) {
      console.error("사내 AI 연결 확인 실패:", error.status || 500);
      return sendError(response, error, "사내 AI 서버 연결을 확인하지 못했습니다.");
    }
  });

  // ---------- AI 어시스턴트 ----------
  router.get("/assistant/status", requireRoles("ADMIN", "EDITOR"), async (_request, response, next) => {
    try {
      const settings = await aiSettings();
      response.json({
        enabled: settings.assistantEnabled && Boolean(settings.ollamaBaseUrl),
        configured: Boolean(settings.ollamaBaseUrl),
        model: settings.assistantModel || "",
        host: settings.ollamaBaseUrl ? new URL(settings.ollamaBaseUrl).host : "",
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/assistant/chat", requireRoles("ADMIN", "EDITOR"), requireSameOrigin, async (request, response) => {
    try {
      const settings = await aiSettings();
      if (!settings.ollamaBaseUrl || !settings.assistantEnabled) {
        return response.status(400).json({ error: "AI 어시스턴트가 꺼져 있거나 사내 AI 서버가 설정되지 않았습니다. 관리자에게 리포트 설정 › 사내 AI 설정을 요청해 주세요." });
      }
      const { messages, tools } = validateAssistantRequest(request.body);
      let model = settings.assistantModel;
      if (!model) model = pickAssistantModel((await ollamaServerModels({ baseUrl: settings.ollamaBaseUrl })).models);
      const signal = abortOnClose(response);
      const upstream = await assistantChat({ baseUrl: settings.ollamaBaseUrl, model, think: settings.assistantThink, messages, tools, signal });
      response.status(200);
      response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Assistant-Model", encodeURIComponent(model));
      response.flushHeaders?.();
      try {
        for await (const chunk of upstream.body) {
          if (response.destroyed) break;
          response.write(chunk);
        }
      } catch (error) {
        // 스트림 도중 끊기면 마지막 줄로 오류를 알려 클라이언트가 멈춘 이유를 보여 줄 수 있게 한다.
        if (!response.destroyed && error?.name !== "AbortError") {
          response.write(`${JSON.stringify({ error: "사내 AI 서버 응답이 중간에 끊겼습니다. 다시 시도해 주세요." })}\n`);
        }
      }
      return response.end();
    } catch (error) {
      console.error("AI 어시스턴트 요청 실패:", error.status || 500);
      return sendError(response, error, "AI 어시스턴트 요청 중 오류가 발생했습니다.");
    }
  });

  // ---------- 양식 가져오기 (문서 분석) ----------
  router.post("/templates/ai-models", requireRoles("ADMIN", "EDITOR"), requireSameOrigin, async (request, response) => {
    try {
      const provider = request.body?.provider;
      if (provider === "ollama") {
        const settings = await aiSettings();
        return response.json({ models: await ollamaModels({ baseUrl: settings.ollamaBaseUrl || null, preferred: settings.importModel }) });
      }
      const apiKey = await resolveAiKey(getPool(), provider);
      return response.json({ models: await models({ provider, apiKey }) });
    } catch (error) {
      console.error("AI 모델 목록 조회 실패:", error.status || 500);
      return sendError(response, error, "AI 모델 목록 조회 중 오류가 발생했습니다.");
    }
  });

  router.post("/templates/ai-import", requireRoles("ADMIN", "EDITOR"), requireSameOrigin, async (request, response) => {
    try {
      if (request.body?.provider === "ollama") {
        const { model, mimeType, data, consent } = request.body;
        const settings = await aiSettings();
        const result = await ollamaConvert({ baseUrl: settings.ollamaBaseUrl || null, model, mimeType, data, consent, signal: abortOnClose(response) });
        return response.json(result);
      }
      const apiKey = await resolveAiKey(getPool(), request.body?.provider);
      const pages = await convert({ ...request.body, apiKey });
      return response.json({ pages });
    } catch (error) {
      console.error("AI 양식 변환 실패:", error.status || 500);
      return sendError(response, error, "AI 양식 변환 중 오류가 발생했습니다.");
    }
  });
  return router;
}
