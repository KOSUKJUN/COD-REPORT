<script setup>
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import AdminView from "./AdminView.vue";
import EditorView from "./EditorView.vue";
import LoginView from "./LoginView.vue";
import ViewerView from "./ViewerView.vue";
import HelpDialog from "./components/HelpDialog.vue";

const path = ref(window.location.pathname.replace(/\/+$/, "") || "/");
const authUser = ref(null);
const setupRequired = ref(false);
const loading = ref(true);
const authError = ref("");
const logoutError = ref("");
const loggingOut = ref(false);
const activeTool = ref(null);
const isHelpOpen = ref(false);
let helpOpener = null;

function openHelp() {
  helpOpener = document.activeElement;
  isHelpOpen.value = true;
}

function closeHelp() {
  isHelpOpen.value = false;
  nextTick(() => helpOpener?.focus());
}

function normalizedPath(requestedPath) {
  if (!authUser.value) return "/login";
  if (requestedPath === "/viewer") return "/viewer";
  if (requestedPath === "/editor" && ["ADMIN", "EDITOR"].includes(authUser.value.role)) return "/editor";
  if (requestedPath === "/admin" && authUser.value.role === "ADMIN") return "/admin";
  return "/";
}

function setPath(requestedPath, replace = false) {
  const nextPath = normalizedPath(requestedPath);
  path.value = nextPath;
  window.history[replace ? "replaceState" : "pushState"](null, "", nextPath);
}

function canLeaveTool() {
  return activeTool.value?.canLeave?.() !== false;
}

function onPopState() {
  if (!canLeaveTool()) {
    window.history.pushState(null, "", path.value);
    return;
  }
  const nextPath = normalizedPath(window.location.pathname.replace(/\/+$/, "") || "/");
  path.value = nextPath;
  if (nextPath !== window.location.pathname) window.history.replaceState(null, "", nextPath);
}

function onPageShow(event) {
  if (!event.persisted) return;
  loading.value = true;
  authError.value = "";
  loadAuthStatus();
}

async function loadAuthStatus() {
  try {
    const response = await fetch("/api/auth/status", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `API 요청 실패 (${response.status})`);
    authUser.value = result.user;
    setupRequired.value = Boolean(result.setupRequired);
    setPath(path.value, true);
  } catch (error) {
    authError.value = error.message;
  } finally {
    loading.value = false;
  }
}

function onAuthenticated(user) {
  authUser.value = user;
  setPath("/", true);
}

function selectTool(tool) {
  if (tool === "editor" && !["ADMIN", "EDITOR"].includes(authUser.value?.role)) return;
  if (tool === "admin" && authUser.value?.role !== "ADMIN") return;
  if (!["editor", "viewer", "admin"].includes(tool) || !canLeaveTool()) return;
  setPath(`/${tool}`);
}

async function logout() {
  if (loggingOut.value || !canLeaveTool()) return;
  logoutError.value = "";
  loggingOut.value = true;
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error(`로그아웃에 실패했습니다 (${response.status}).`);
    authUser.value = null;
    setupRequired.value = false;
    setPath("/login", true);
  } catch (error) {
    logoutError.value = error.message;
  } finally {
    loggingOut.value = false;
  }
}

onMounted(() => {
  window.addEventListener("popstate", onPopState);
  window.addEventListener("pageshow", onPageShow);
  loadAuthStatus();
});
onUnmounted(() => {
  window.removeEventListener("popstate", onPopState);
  window.removeEventListener("pageshow", onPageShow);
});
</script>

<template>
  <main v-if="loading" class="auth-loading" role="status">로그인 상태를 확인하고 있습니다...</main>
  <main v-else-if="authError" class="auth-loading auth-load-error" role="alert">
    로그인 정보를 확인하지 못했습니다: {{ authError }}
  </main>
  <template v-else>
  <div v-if="logoutError" class="auth-action-error" role="alert">{{ logoutError }}</div>
  <LoginView
    v-if="!authUser || path === '/'"
    :setup-required="setupRequired"
    :user="authUser"
    @authenticated="onAuthenticated"
    @select-tool="selectTool"
    @logout="logout"
    @help="openHelp"
  />
  <EditorView
    v-else-if="path === '/editor' && ['ADMIN', 'EDITOR'].includes(authUser.role)"
    ref="activeTool"
    :auth-user="authUser"
    @select-tool="selectTool"
    @logout="logout"
    @help="openHelp"
  />
  <AdminView
    v-else-if="path === '/admin' && authUser.role === 'ADMIN'"
    :auth-user="authUser"
    @select-tool="selectTool"
    @logout="logout"
    @help="openHelp"
  />
  <ViewerView
    v-else-if="path === '/viewer'"
    ref="activeTool"
    :auth-user="authUser"
    @select-tool="selectTool"
    @logout="logout"
    @help="openHelp"
  />
  <HelpDialog v-if="isHelpOpen" @close="closeHelp" />
  </template>
</template>
