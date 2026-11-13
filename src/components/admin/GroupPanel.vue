<script setup>
import { computed, inject, onMounted, reactive, ref, watch } from "vue";
import { createAdminGroup, deleteAdminGroup, updateAdminGroup } from "../../reports-api.js";
import {
  ROLE_LABELS,
  avatarHue,
  descendantGroupCds,
  initials,
  matchesQuery,
  userStatus,
} from "../../user-admin.js";
import AdminPicker from "./AdminPicker.vue";

const props = defineProps({
  group: { type: Object, default: null }, // null이면 새 그룹
  groups: { type: Array, required: true }, // 트리 순서
  users: { type: Array, required: true },
  defaultParentCd: { type: String, default: "" },
  initialUserCds: { type: Array, default: () => [] },
});
const emit = defineEmits(["close", "changed", "open-user", "open-group", "created"]);
const ui = inject("adminUi");

const isNew = computed(() => !props.group);
const draft = reactive({ name: "", description: "", parentGroupCd: "", userCds: [] });
const original = ref({});
const busy = ref(false);
const formError = ref("");
const memberQuery = ref("");
const pickerOpen = ref(false);
const nameInput = ref(null);

const userByCd = computed(() => new Map(props.users.map((user) => [user.userCd, user])));
const treeEntry = computed(() => props.groups.find((group) => group.groupCd === props.group?.groupCd));
const children = computed(() => props.groups.filter((group) => group.parentGroupCd === props.group?.groupCd));

function snapshot(group) {
  return {
    name: group?.name ?? "",
    description: group?.description ?? "",
    parentGroupCd: group ? group.parentGroupCd ?? "" : props.defaultParentCd,
    userCds: group ? group.users.map((user) => user.userCd) : [...props.initialUserCds],
  };
}

function load(group) {
  const base = snapshot(group);
  Object.assign(draft, base, { userCds: [...base.userCds] });
  original.value = { ...base, userCds: [...base.userCds] };
  formError.value = "";
}

const changedFields = computed(() => {
  const fields = [];
  for (const key of ["name", "description", "parentGroupCd"]) {
    if (String(draft[key] ?? "").trim() !== String(original.value[key] ?? "").trim()) fields.push(key);
  }
  if ([...draft.userCds].sort().join() !== [...(original.value.userCds ?? [])].sort().join()) fields.push("userCds");
  return fields;
});
const isDirty = computed(() => (isNew.value ? Boolean(draft.name.trim()) : changedFields.value.length > 0));

watch(() => props.group, (next, previous) => {
  if (!next || next.groupCd !== previous?.groupCd || !isDirty.value) load(next);
}, { immediate: true });

const parentOptions = computed(() => {
  const excluded = props.group ? descendantGroupCds(props.groups, props.group.groupCd) : new Set();
  return props.groups.filter((group) => !excluded.has(group.groupCd));
});

const members = computed(() => draft.userCds
  .map((userCd) => userByCd.value.get(userCd))
  .filter(Boolean)
  .filter((user) => matchesQuery([user.name, user.userId, user.email], memberQuery.value))
  .sort((a, b) => a.name.localeCompare(b.name, "ko")));

const memberDelta = computed(() => {
  const before = new Set(original.value.userCds ?? []);
  const after = new Set(draft.userCds);
  return {
    added: draft.userCds.filter((cd) => !before.has(cd)).length,
    removed: [...before].filter((cd) => !after.has(cd)).length,
  };
});

const pickerItems = computed(() => props.users
  .filter((user) => !draft.userCds.includes(user.userCd))
  .map((user) => ({
    id: user.userCd,
    label: user.name,
    sub: [user.userId, ROLE_LABELS[user.role]].join(" · "),
    initials: initials(user.name),
    hue: avatarHue(user.userCd),
    hint: userStatus(user) === "active" ? "" : userStatus(user) === "locked" ? "잠김" : "중지",
  })));

function addMembers(userCds) {
  draft.userCds = [...new Set([...draft.userCds, ...userCds])];
  pickerOpen.value = false;
}

function removeMember(userCd) {
  draft.userCds = draft.userCds.filter((cd) => cd !== userCd);
}

async function submit() {
  if (busy.value) return;
  if (!draft.name.trim()) {
    formError.value = "그룹 이름을 입력해 주세요.";
    nameInput.value?.focus();
    return;
  }
  const duplicate = props.groups.find((group) =>
    group.name.toLowerCase() === draft.name.trim().toLowerCase() && group.groupCd !== props.group?.groupCd);
  if (duplicate) {
    formError.value = "같은 이름의 그룹이 이미 있습니다.";
    return;
  }
  busy.value = true;
  formError.value = "";
  try {
    if (isNew.value) {
      const result = await createAdminGroup({
        name: draft.name.trim(),
        description: draft.description.trim(),
        parentGroupCd: draft.parentGroupCd || null,
        userCds: draft.userCds,
      });
      emit("created", { groupCd: result.group.groupCd, message: `‘${draft.name.trim()}’ 그룹을 만들었습니다.` });
    } else {
      const payload = {};
      for (const field of changedFields.value) {
        if (field === "userCds") payload.userCds = draft.userCds;
        else if (field === "parentGroupCd") payload.parentGroupCd = draft.parentGroupCd || null;
        else payload[field] = draft[field].trim();
      }
      await updateAdminGroup(props.group.groupCd, payload);
      original.value = { ...draft, userCds: [...draft.userCds] };
      emit("changed", { message: `‘${draft.name.trim()}’ 그룹을 저장했습니다.` });
    }
  } catch (error) {
    formError.value = error.message;
  } finally {
    busy.value = false;
  }
}

async function remove() {
  const memberCount = props.group.users.length;
  const details = [
    memberCount ? `구성원 ${memberCount}명은 이 그룹에서만 빠지고 계정은 유지됩니다.` : "",
    children.value.length ? `하위 그룹 ${children.value.length}개는 한 단계 위로 이동합니다.` : "",
    props.group.templates?.length ? `이 그룹에 준 양식 열람 권한 ${props.group.templates.length}건이 제거됩니다.` : "",
  ].filter(Boolean).join(" ");
  const ok = await ui.confirm({
    title: `‘${props.group.name}’ 그룹을 삭제할까요?`,
    message: details || "비어 있는 그룹입니다.",
    confirmLabel: "그룹 삭제",
    tone: "danger",
  });
  if (!ok) return;
  busy.value = true;
  try {
    await deleteAdminGroup(props.group.groupCd);
    emit("changed", { message: `‘${props.group.name}’ 그룹을 삭제했습니다.`, close: true, deletedGroupCd: props.group.groupCd });
  } catch (error) {
    ui.toast(error.message, "error");
  } finally {
    busy.value = false;
  }
}

function onKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    submit();
  }
}

onMounted(() => {
  if (isNew.value) nameInput.value?.focus();
});

defineExpose({ isDirty: () => isDirty.value });
</script>

<template>
  <div class="uga-panel-inner" @keydown="onKeydown">
    <header class="uga-panel-head">
      <span class="uga-group-badge" :style="{ '--hue': avatarHue(group?.groupCd ?? draft.name) }" aria-hidden="true">
        {{ isNew ? "＋" : initials(group.name) }}
      </span>
      <div class="uga-panel-title">
        <p class="uga-eyebrow">{{ isNew ? "새 그룹" : treeEntry?.path.slice(0, -1).join(" › ") || "그룹" }}</p>
        <h3>{{ draft.name.trim() || (isNew ? "그룹 만들기" : group.name) }}</h3>
      </div>
    </header>

    <div class="uga-panel-body">
      <form class="uga-form" @submit.prevent="submit">
        <section class="uga-section">
          <h4>그룹 정보</h4>
          <label class="uga-field">
            <span>그룹 이름 <b>*</b></span>
            <input ref="nameInput" v-model="draft.name" maxlength="200" required placeholder="예: 보안관제팀" />
          </label>
          <label class="uga-field">
            <span>설명</span>
            <textarea v-model="draft.description" rows="2" maxlength="4000" placeholder="그룹의 역할이나 담당 업무"></textarea>
          </label>
          <label class="uga-field">
            <span>상위 그룹</span>
            <select v-model="draft.parentGroupCd">
              <option value="">없음 (최상위)</option>
              <option v-for="option in parentOptions" :key="option.groupCd" :value="option.groupCd">
                {{ "　".repeat(option.depth) }}{{ option.depth ? "└ " : "" }}{{ option.name }}
              </option>
            </select>
            <small class="uga-help">조직도 정리를 위한 구분입니다. 양식 열람 권한은 상위 그룹에서 하위 그룹으로 상속되지 않습니다.</small>
          </label>
        </section>

        <section class="uga-section">
          <div class="uga-section-head">
            <h4>구성원 <span class="uga-muted">{{ draft.userCds.length }}명</span>
              <em v-if="memberDelta.added || memberDelta.removed" class="uga-delta">
                <template v-if="memberDelta.added">+{{ memberDelta.added }}</template>
                <template v-if="memberDelta.removed"> −{{ memberDelta.removed }}</template>
              </em>
            </h4>
            <button type="button" class="uga-btn uga-btn-sm" :disabled="!pickerItems.length" @click="pickerOpen = true">＋ 구성원 추가</button>
          </div>
          <label v-if="draft.userCds.length > 6" class="uga-search uga-search-sm">
            <span aria-hidden="true">⌕</span>
            <input v-model="memberQuery" placeholder="구성원 검색" />
          </label>
          <ul class="uga-member-list">
            <li v-for="user in members" :key="user.userCd">
              <button type="button" class="uga-member" @click="emit('open-user', user.userCd)">
                <span class="uga-avatar uga-avatar-sm" :style="{ '--hue': avatarHue(user.userCd) }">{{ initials(user.name) }}</span>
                <span class="uga-member-text">
                  <strong>{{ user.name }}</strong>
                  <small>{{ user.userId }}</small>
                </span>
                <span class="uga-role-tag" :class="`role-${user.role.toLowerCase()}`">{{ ROLE_LABELS[user.role] }}</span>
              </button>
              <button type="button" class="uga-icon-btn uga-member-x" :aria-label="`${user.name} 제외`" title="그룹에서 제외" @click="removeMember(user.userCd)">×</button>
            </li>
          </ul>
          <p v-if="!draft.userCds.length" class="uga-empty-inline">
            아직 구성원이 없습니다. <button type="button" class="uga-link" @click="pickerOpen = true">구성원 추가</button>
          </p>
        </section>

        <section v-if="!isNew && children.length" class="uga-section">
          <h4>하위 그룹 <span class="uga-muted">{{ children.length }}</span></h4>
          <div class="uga-chip-editor">
            <button
              v-for="child in children"
              :key="child.groupCd"
              type="button"
              class="uga-chip uga-chip-lg"
              :style="{ '--hue': avatarHue(child.groupCd) }"
              @click="emit('open-group', child.groupCd)"
            >{{ child.name }} <small>{{ child.users.length }}</small></button>
          </div>
        </section>

        <section v-if="!isNew" class="uga-section">
          <h4>열람 가능한 양식 <span class="uga-muted">{{ group.templates?.length ?? 0 }}</span></h4>
          <ul v-if="group.templates?.length" class="uga-template-list">
            <li v-for="template in group.templates" :key="template.id">
              <span>{{ template.category }}</span>{{ template.name }}
            </li>
          </ul>
          <p class="uga-help">양식 권한은 에디터 › 보고서 양식 관리 › 결과 권한에서 지정합니다.</p>
        </section>

        <section v-if="!isNew" class="uga-section uga-danger">
          <h4>위험 구역</h4>
          <div class="uga-danger-row">
            <span>
              <strong>그룹 삭제</strong>
              <small>구성원 계정은 삭제되지 않습니다.</small>
            </span>
            <button type="button" class="uga-btn uga-btn-sm uga-btn-danger" :disabled="busy" @click="remove">삭제</button>
          </div>
        </section>

        <p v-if="formError" class="uga-form-error" role="alert">{{ formError }}</p>
        <button type="submit" hidden></button>
      </form>
    </div>

    <footer class="uga-panel-foot" :class="{ 'is-dirty': !isNew && isDirty }">
      <template v-if="isNew">
        <button type="button" class="uga-btn" @click="emit('close')">취소</button>
        <button type="button" class="uga-btn uga-btn-primary" :disabled="busy || !draft.name.trim()" @click="submit">
          {{ busy ? "만드는 중..." : draft.userCds.length ? `${draft.userCds.length}명으로 그룹 만들기` : "그룹 만들기" }}
        </button>
      </template>
      <template v-else-if="isDirty">
        <span class="uga-dirty-note">변경 {{ changedFields.length }}건 저장 안 됨</span>
        <button type="button" class="uga-btn" :disabled="busy" @click="load(group)">되돌리기</button>
        <button type="button" class="uga-btn uga-btn-primary" :disabled="busy" @click="submit">
          {{ busy ? "저장 중..." : "저장" }} <kbd>Ctrl+S</kbd>
        </button>
      </template>
      <template v-else>
        <span class="uga-muted">구성원은 표에서 끌어다 놓거나 여기서 추가할 수 있습니다.</span>
      </template>
    </footer>

    <AdminPicker
      v-if="pickerOpen"
      title="구성원 추가"
      :description="`‘${draft.name || '새 그룹'}’에 추가할 사용자를 고르세요.`"
      :items="pickerItems"
      confirm-label="추가"
      avatar
      empty-text="모든 사용자가 이미 구성원입니다."
      @confirm="addMembers"
      @close="pickerOpen = false"
    />
  </div>
</template>
