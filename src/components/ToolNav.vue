<script setup>
// 도구 이동 메뉴(뷰어 → 에디터 → 사용자·그룹 관리). 지금 화면과 권한이 없는 도구는 빼고 보여 준다.
import { computed } from "vue";

const props = defineProps({
  authUser: { type: Object, required: true },
  current: { type: String, required: true },
  // dark: 어두운 상단바(에디터)
  dark: { type: Boolean, default: false },
});
const emit = defineEmits(["select-tool"]);

const TOOLS = [
  { id: "viewer", label: "리포트 뷰어", roles: null },
  { id: "editor", label: "리포트 에디터", roles: ["ADMIN", "EDITOR"] },
  { id: "admin", label: "사용자·그룹 관리", roles: ["ADMIN"] },
];

const items = computed(() =>
  TOOLS.filter((tool) => tool.id !== props.current && (!tool.roles || tool.roles.includes(props.authUser?.role))),
);
</script>

<template>
  <nav v-if="items.length" class="tool-nav" :class="{ 'tool-nav-dark': dark }" aria-label="도구 이동">
    <button v-for="tool in items" :key="tool.id" type="button" @click="emit('select-tool', tool.id)">{{ tool.label }}</button>
  </nav>
</template>

<style>
.tool-nav {
  display: flex;
  gap: 2px;
  margin-left: 12px;
}

.tool-nav button {
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #5d6678;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}

.tool-nav button:hover {
  background: #f1f3f7;
  color: #252e43;
}

.tool-nav-dark button {
  color: #b4c6e4;
}

.tool-nav-dark button:hover {
  background: #1d3a60;
  color: #fff;
}

@media (max-width: 760px) {
  .tool-nav {
    display: none;
  }
}
</style>
