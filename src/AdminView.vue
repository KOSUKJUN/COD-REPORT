<script setup>
import UserGroupManager from "./components/admin/UserGroupManager.vue";
import ToolNav from "./components/ToolNav.vue";

defineProps({
  authUser: { type: Object, required: true },
});
const emit = defineEmits(["select-tool", "logout", "help"]);
</script>

<template>
  <main class="admin-page">
    <header class="admin-page-header">
      <a class="brand" href="/" aria-label="CODVILL 홈">
        <img class="brand-logo" src="/codvill-logo-dark.png" alt="CODVILL" />
      </a>
      <span class="admin-page-divider" aria-hidden="true"></span>
      <h1>사용자·그룹 관리</h1>
      <ToolNav :auth-user="authUser" current="admin" @select-tool="emit('select-tool', $event)" />
      <div class="admin-page-account">
        <span>{{ authUser.name }}</span>
        <button type="button" @click="emit('help')">도움말</button>
        <button type="button" @click="emit('logout')">로그아웃</button>
      </div>
    </header>
    <UserGroupManager class="admin-page-body" :auth-user="authUser" />
  </main>
</template>

<style>
.admin-page {
  display: flex;
  height: 100dvh;
  flex-direction: column;
  background: #f6f7fa;
}

.admin-page-header {
  display: flex;
  height: 56px;
  flex: 0 0 56px;
  align-items: center;
  gap: 14px;
  padding: 0 20px;
  border-bottom: 1px solid #e3e7ef;
  background: #fff;
}

.admin-page-divider {
  width: 1px;
  height: 20px;
  background: #e3e7ef;
}

.admin-page-header h1 {
  margin: 0;
  color: #252e43;
  font-size: 14px;
  font-weight: 700;
}

.admin-page-account button {
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #5d6678;
  cursor: pointer;
  font-size: 12px;
}

.admin-page-account button:hover {
  background: #f1f3f7;
  color: #252e43;
}

.admin-page-account {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  color: #4a5468;
  font-size: 12px;
}

.admin-page-body {
  min-height: 0;
  flex: 1;
}

@media (max-width: 760px) {
  .admin-page-divider {
    display: none;
  }

  .admin-page-header {
    padding: 0 16px;
  }
}
</style>
