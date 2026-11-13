<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { matchesQuery } from "../../user-admin.js";

const props = defineProps({
  title: { type: String, required: true },
  description: { type: String, default: "" },
  items: { type: Array, required: true }, // [{ id, label, sub, depth, hue, disabled, hint }]
  confirmLabel: { type: String, default: "추가" },
  placeholder: { type: String, default: "검색 (초성 가능)" },
  emptyText: { type: String, default: "선택할 항목이 없습니다." },
  createLabel: { type: String, default: "" }, // 예: "그룹 새로 만들기"
  avatar: { type: Boolean, default: false },
});
const emit = defineEmits(["confirm", "close", "create"]);

const query = ref("");
const chosen = ref(new Set());
const searchEl = ref(null);
const activeIndex = ref(0);

const visible = computed(() =>
  props.items.filter((item) => matchesQuery([item.label, item.sub], query.value)),
);
const canCreate = computed(() => {
  const name = query.value.trim();
  return Boolean(props.createLabel && name &&
    !props.items.some((item) => item.label.toLowerCase() === name.toLowerCase()));
});
const allVisibleChosen = computed(() =>
  visible.value.filter((item) => !item.disabled).every((item) => chosen.value.has(item.id)),
);

function toggle(item) {
  if (item.disabled) return;
  if (chosen.value.has(item.id)) chosen.value.delete(item.id);
  else chosen.value.add(item.id);
}

function toggleVisible() {
  const selectable = visible.value.filter((item) => !item.disabled);
  if (allVisibleChosen.value) selectable.forEach((item) => chosen.value.delete(item.id));
  else selectable.forEach((item) => chosen.value.add(item.id));
}

function confirm() {
  if (!chosen.value.size) return;
  emit("confirm", [...chosen.value]);
}

function onKeydown(event) {
  if (event.key === "Escape") {
    event.stopPropagation();
    emit("close");
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    activeIndex.value = Math.min(visible.value.length - 1, activeIndex.value + 1);
    scrollActive();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    activeIndex.value = Math.max(0, activeIndex.value - 1);
    scrollActive();
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      confirm();
    } else if (visible.value[activeIndex.value]) {
      toggle(visible.value[activeIndex.value]);
    } else if (canCreate.value) {
      emit("create", query.value.trim());
    }
  }
}

function scrollActive() {
  nextTick(() => {
    document.querySelector(".uga-picker-item.is-active")?.scrollIntoView({ block: "nearest" });
  });
}

function onQueryInput() {
  activeIndex.value = 0;
}

onMounted(() => searchEl.value?.focus());
</script>

<template>
  <Teleport to="body">
    <div class="uga-layer uga-backdrop" @keydown="onKeydown">
      <section class="uga-picker" role="dialog" aria-modal="true" :aria-label="title">
        <header class="uga-picker-head popup-titlebar">
          <div>
            <h3>{{ title }}</h3>
            <p v-if="description">{{ description }}</p>
          </div>
          <button class="uga-icon-btn" type="button" aria-label="닫기" @click="emit('close')">×</button>
        </header>
        <label class="uga-search uga-picker-search">
          <span aria-hidden="true">⌕</span>
          <input ref="searchEl" v-model="query" :placeholder="placeholder" @input="onQueryInput" />
        </label>
        <div class="uga-picker-tools">
          <button v-if="visible.length" type="button" class="uga-link" @click="toggleVisible">
            {{ allVisibleChosen ? "표시된 항목 선택 해제" : `표시된 ${visible.filter((item) => !item.disabled).length}개 모두 선택` }}
          </button>
          <span>{{ chosen.size }}개 선택</span>
        </div>
        <ul class="uga-picker-list" role="listbox" aria-multiselectable="true">
          <li
            v-for="(item, index) in visible"
            :key="item.id"
            class="uga-picker-item"
            :class="{ 'is-active': index === activeIndex, 'is-chosen': chosen.has(item.id), 'is-disabled': item.disabled }"
            :style="{ '--depth': item.depth || 0, '--hue': item.hue ?? 222 }"
            role="option"
            :aria-selected="chosen.has(item.id)"
            @mouseenter="activeIndex = index"
            @click="toggle(item)"
          >
            <span class="uga-check" aria-hidden="true">{{ chosen.has(item.id) ? "✓" : "" }}</span>
            <span v-if="avatar" class="uga-avatar uga-avatar-sm">{{ item.initials }}</span>
            <span v-else class="uga-group-dot"></span>
            <span class="uga-picker-text">
              <strong>{{ item.label }}</strong>
              <small v-if="item.sub">{{ item.sub }}</small>
            </span>
            <em v-if="item.hint" class="uga-picker-hint">{{ item.hint }}</em>
          </li>
          <li v-if="canCreate" class="uga-picker-create">
            <button type="button" @click="emit('create', query.trim())">
              ＋ ‘{{ query.trim() }}’ {{ createLabel }}
            </button>
          </li>
          <li v-if="!visible.length && !canCreate" class="uga-picker-empty">
            {{ query ? "검색 결과가 없습니다." : emptyText }}
          </li>
        </ul>
        <footer class="uga-picker-foot">
          <small>↑↓ 이동 · Enter 선택 · Ctrl+Enter {{ confirmLabel }}</small>
          <div>
            <button type="button" class="uga-btn" @click="emit('close')">취소</button>
            <button type="button" class="uga-btn uga-btn-primary" :disabled="!chosen.size" @click="confirm">
              {{ chosen.size ? `${chosen.size}개 ${confirmLabel}` : confirmLabel }}
            </button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
