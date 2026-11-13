<script setup>
import { computed, inject, nextTick, onMounted, reactive, ref, watch } from "vue";
import {
  bulkUpdateAdminUsers,
  createAdminUser,
  deleteAdminUser,
  updateAdminUser,
} from "../../reports-api.js";
import {
  ROLE_OPTIONS,
  STATUS_LABELS,
  avatarHue,
  formatDateTime,
  formatRelative,
  generatePassword,
  initials,
  passwordStrength,
  userStatus,
} from "../../user-admin.js";
import AdminPicker from "./AdminPicker.vue";
import { copyText, credentialText } from "./admin-dom.js";

const props = defineProps({
  user: { type: Object, default: null }, // null이면 새 사용자
  groups: { type: Array, required: true }, // 트리 순서로 펼친 그룹
  existingUserIds: { type: Array, default: () => [] },
  defaultGroupCds: { type: Array, default: () => [] },
  selfUserCd: { type: String, default: "" },
});
const emit = defineEmits(["close", "changed", "open-group", "created"]);
const ui = inject("adminUi");

const isNew = computed(() => !props.user);
const isSelf = computed(() => props.user?.userCd === props.selfUserCd);
const status = computed(() => (props.user ? userStatus(props.user) : "active"));
const groupByCd = computed(() => new Map(props.groups.map((group) => [group.groupCd, group])));

const draft = reactive({ userId: "", name: "", email: "", tel: "", role: "VIEWER", groupCds: [], password: "" });
const original = ref({});
const busy = ref(false);
const formError = ref("");
const idTouched = ref(false);
const showPassword = ref(true);
const pickerOpen = ref(false);
const recentCreated = ref([]);
const nameInput = ref(null);

const reset = reactive({ open: false, password: "", done: false, show: true });

function snapshot(user) {
  return {
    userId: user?.userId ?? "",
    name: user?.name ?? "",
    email: user?.email ?? "",
    tel: user?.tel ?? "",
    role: user?.role ?? draft.role ?? "VIEWER",
    groupCds: [...(user?.groupCds ?? props.defaultGroupCds)],
  };
}

function load(user, { keepRoleAndGroups = false } = {}) {
  const base = snapshot(user);
  if (keepRoleAndGroups) {
    base.role = draft.role;
    base.groupCds = [...draft.groupCds];
  }
  Object.assign(draft, base, { password: user ? "" : generatePassword() });
  original.value = { ...base, groupCds: [...base.groupCds] };
  idTouched.value = false;
  formError.value = "";
}

const changedFields = computed(() => {
  if (isNew.value) return [];
  const fields = [];
  for (const key of ["name", "email", "tel", "role"]) {
    if (String(draft[key] ?? "").trim() !== String(original.value[key] ?? "").trim()) fields.push(key);
  }
  const a = [...draft.groupCds].sort().join(",");
  const b = [...(original.value.groupCds ?? [])].sort().join(",");
  if (a !== b) fields.push("groupCds");
  return fields;
});
const isDirty = computed(() => isNew.value
  ? Boolean(draft.name.trim() || draft.userId.trim() || draft.email.trim())
  : changedFields.value.length > 0);

watch(() => props.user, (next, previous) => {
  const switched = !next || next.userCd !== previous?.userCd;
  if (switched) {
    reset.open = false;
    reset.done = false;
  }
  if (switched || !isDirty.value) load(next);
}, { immediate: true });

// ---------- 새 사용자 ----------

const idStatus = computed(() => {
  const value = draft.userId.trim();
  if (!value) return { tone: "", text: "" };
  if (!/^[A-Za-z0-9._@-]{3,200}$/.test(value)) {
    return { tone: "error", text: "영문·숫자·. _ @ - 로 3자 이상" };
  }
  if (props.existingUserIds.some((id) => id.toLowerCase() === value.toLowerCase())) {
    return { tone: "error", text: "이미 사용 중인 아이디" };
  }
  return { tone: "ok", text: "사용 가능" };
});
const emailError = computed(() =>
  draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()) ? "이메일 형식을 확인해 주세요." : "",
);
const strength = computed(() => passwordStrength(draft.password));
const resetStrength = computed(() => passwordStrength(reset.password));

function onEmailInput() {
  if (!isNew.value || idTouched.value) return;
  const local = draft.email.trim().split("@")[0];
  draft.userId = local.replace(/[^A-Za-z0-9._-]/g, "");
}

const canCreate = computed(() =>
  draft.name.trim() && idStatus.value.tone === "ok" && !emailError.value && draft.password.length >= 12,
);

async function create() {
  if (busy.value || !canCreate.value) return;
  busy.value = true;
  formError.value = "";
  try {
    const payload = {
      userId: draft.userId.trim(),
      name: draft.name.trim(),
      email: draft.email.trim(),
      tel: draft.tel.trim(),
      role: draft.role,
      password: draft.password,
      groupCds: draft.groupCds,
    };
    const result = await createAdminUser(payload);
    recentCreated.value.unshift({ ...payload, userCd: result.user.userCd, copied: false });
    emit("created", { userCd: result.user.userCd, message: `${payload.name}님 계정을 추가했습니다.` });
    load(null, { keepRoleAndGroups: true });
    await nextTick();
    nameInput.value?.focus();
  } catch (error) {
    formError.value = error.message;
  } finally {
    busy.value = false;
  }
}

async function copyCredential(entry) {
  if (await copyText(credentialText(entry))) {
    entry.copied = true;
    ui.toast("로그인 정보를 복사했습니다. 메신저나 메일로 전달하세요.");
  } else {
    ui.toast("복사하지 못했습니다. 직접 선택해 복사해 주세요.", "error");
  }
}

async function copyAllCredentials() {
  const textValue = recentCreated.value.map(credentialText).join("\n\n");
  if (await copyText(textValue)) {
    recentCreated.value.forEach((entry) => { entry.copied = true; });
    ui.toast(`${recentCreated.value.length}명의 로그인 정보를 복사했습니다.`);
  }
}

// ---------- 기존 사용자 ----------

async function save() {
  if (busy.value || !changedFields.value.length) return;
  if (emailError.value) return;
  if (!draft.name.trim()) {
    formError.value = "이름을 입력해 주세요.";
    return;
  }
  const payload = {};
  for (const field of changedFields.value) {
    payload[field] = field === "groupCds" ? draft.groupCds : draft[field].trim();
  }
  if (payload.role === "ADMIN" && original.value.role !== "ADMIN") {
    const ok = await ui.confirm({
      title: "관리자 권한을 부여할까요?",
      message: `${draft.name}님이 모든 사용자·그룹·접속정보를 관리할 수 있게 됩니다.`,
      confirmLabel: "관리자로 지정",
    });
    if (!ok) return;
  }
  busy.value = true;
  formError.value = "";
  try {
    await updateAdminUser(props.user.userCd, payload);
    original.value = { ...snapshot({ ...props.user, ...draft }), groupCds: [...draft.groupCds] };
    const roleNote = payload.role ? " 역할이 바뀌어 다시 로그인하면 적용됩니다." : "";
    emit("changed", { message: `${draft.name}님 정보를 저장했습니다.${roleNote}` });
  } catch (error) {
    formError.value = error.message;
  } finally {
    busy.value = false;
  }
}

function discard() {
  load(props.user);
}

async function run(task, message) {
  if (busy.value) return;
  busy.value = true;
  try {
    await task();
    emit("changed", { message });
  } catch (error) {
    ui.toast(error.message, "error");
  } finally {
    busy.value = false;
  }
}

function unlock() {
  run(() => updateAdminUser(props.user.userCd, { unlock: true }), `${props.user.name}님의 로그인 잠금을 해제했습니다.`);
}

function setEnabled(enabled) {
  run(
    () => updateAdminUser(props.user.userCd, { enabled }),
    enabled ? `${props.user.name}님 계정을 다시 사용하도록 했습니다.` : `${props.user.name}님 계정을 사용 중지했습니다. 로그인할 수 없습니다.`,
  );
}

function forceLogout() {
  run(
    () => bulkUpdateAdminUsers([props.user.userCd], "logout"),
    `${props.user.name}님을 모든 기기에서 로그아웃했습니다.`,
  );
}

function openReset() {
  reset.open = true;
  reset.done = false;
  reset.password = generatePassword();
}

async function applyReset() {
  if (busy.value || reset.password.length < 12) return;
  busy.value = true;
  try {
    await updateAdminUser(props.user.userCd, { password: reset.password });
    reset.done = true;
    emit("changed", { message: `${props.user.name}님의 비밀번호를 재설정했습니다. 기존 로그인은 모두 종료됩니다.`, silent: false });
  } catch (error) {
    ui.toast(error.message, "error");
  } finally {
    busy.value = false;
  }
}

async function copyReset() {
  const ok = await copyText(credentialText({ name: props.user.name, userId: props.user.userId, password: reset.password }));
  ui.toast(ok ? "새 로그인 정보를 복사했습니다." : "복사하지 못했습니다.", ok ? "success" : "error");
}

async function remove() {
  const answer = await ui.confirm({
    title: `${props.user.name}님을 삭제할까요?`,
    message: "계정과 그룹 소속, 양식 열람 권한이 영구 삭제되며 되돌릴 수 없습니다. 기록을 남기려면 '사용 중지'를 권장합니다.",
    confirmLabel: "영구 삭제",
    tone: "danger",
    altLabel: status.value === "disabled" ? "" : "사용 중지로 대신하기",
  });
  if (answer === "alt") {
    setEnabled(false);
    return;
  }
  if (!answer) return;
  busy.value = true;
  try {
    await deleteAdminUser(props.user.userCd);
    emit("changed", { message: `${props.user.name}님을 삭제했습니다.`, close: true });
  } catch (error) {
    ui.toast(error.message, "error");
  } finally {
    busy.value = false;
  }
}

// ---------- 그룹 ----------

const pickerItems = computed(() => props.groups
  .filter((group) => !draft.groupCds.includes(group.groupCd))
  .map((group) => ({
    id: group.groupCd,
    label: group.name,
    sub: group.path.length > 1 ? group.path.slice(0, -1).join(" › ") : group.description,
    depth: group.depth,
    hue: avatarHue(group.groupCd),
  })));

function addGroups(groupCds) {
  draft.groupCds = [...new Set([...draft.groupCds, ...groupCds])];
  pickerOpen.value = false;
}

function removeGroup(groupCd) {
  draft.groupCds = draft.groupCds.filter((cd) => cd !== groupCd);
}

function onKeydown(event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (isNew.value) create();
    else save();
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
      <template v-if="isNew">
        <span class="uga-avatar uga-avatar-lg uga-avatar-new" aria-hidden="true">＋</span>
        <div class="uga-panel-title">
          <p class="uga-eyebrow">새 사용자</p>
          <h3>{{ draft.name.trim() || "사용자 추가" }}</h3>
        </div>
      </template>
      <template v-else>
        <span class="uga-avatar uga-avatar-lg" :style="{ '--hue': avatarHue(user.userCd) }">
          {{ initials(user.name) }}
          <i v-if="user.activeSessions" class="uga-online" title="로그인 중"></i>
        </span>
        <div class="uga-panel-title">
          <h3>{{ user.name }} <em v-if="isSelf" class="uga-me">나</em></h3>
          <p>
            <span class="uga-mono">{{ user.userId }}</span>
            <span class="uga-status" :class="status">{{ STATUS_LABELS[status] }}</span>
          </p>
        </div>
      </template>
    </header>

    <div class="uga-panel-body">
      <!-- 방금 추가한 계정 -->
      <section v-if="isNew && recentCreated.length" class="uga-recent">
        <div class="uga-recent-head">
          <strong>방금 추가한 계정 {{ recentCreated.length }}명</strong>
          <button v-if="recentCreated.length > 1" type="button" class="uga-link" @click="copyAllCredentials">모두 복사</button>
        </div>
        <p class="uga-help">임시 비밀번호는 지금만 확인할 수 있습니다. 사용자에게 전달해 주세요.</p>
        <ul>
          <li v-for="entry in recentCreated" :key="entry.userCd">
            <span class="uga-recent-text"><strong>{{ entry.name }}</strong><small class="uga-mono">{{ entry.userId }} · {{ entry.password }}</small></span>
            <button type="button" class="uga-btn uga-btn-sm" :class="{ 'is-done': entry.copied }" @click="copyCredential(entry)">
              {{ entry.copied ? "복사됨 ✓" : "로그인 정보 복사" }}
            </button>
          </li>
        </ul>
      </section>

      <!-- 상태 알림 & 빠른 작업 -->
      <section v-if="!isNew" class="uga-quick">
        <div v-if="status === 'locked'" class="uga-alert uga-alert-warn">
          <span>로그인 5회 실패로 잠겼습니다.</span>
          <button type="button" class="uga-btn uga-btn-sm" :disabled="busy" @click="unlock">잠금 해제</button>
        </div>
        <div v-else-if="status === 'disabled'" class="uga-alert">
          <span>사용 중지된 계정입니다. 로그인할 수 없습니다.</span>
          <button type="button" class="uga-btn uga-btn-sm" :disabled="busy" @click="setEnabled(true)">다시 사용</button>
        </div>
        <div v-else-if="user.lockCount" class="uga-alert">
          <span>최근 로그인 실패 {{ user.lockCount }}회 (5회 시 잠김)</span>
          <button type="button" class="uga-link" :disabled="busy" @click="unlock">초기화</button>
        </div>
        <div class="uga-quick-actions">
          <button type="button" class="uga-btn uga-btn-sm" :disabled="busy" @click="openReset">🔑 비밀번호 재설정</button>
          <button
            type="button"
            class="uga-btn uga-btn-sm"
            :disabled="busy || !user.activeSessions || isSelf"
            :title="isSelf ? '자기 계정은 로그아웃 버튼을 사용하세요.' : '모든 기기의 로그인 세션을 종료합니다.'"
            @click="forceLogout"
          >⎋ 강제 로그아웃<template v-if="user.activeSessions"> ({{ user.activeSessions }})</template></button>
          <button
            v-if="status !== 'disabled'"
            type="button"
            class="uga-btn uga-btn-sm"
            :disabled="busy || isSelf"
            :title="isSelf ? '자기 계정은 사용 중지할 수 없습니다.' : ''"
            @click="setEnabled(false)"
          >⏸ 사용 중지</button>
        </div>
        <div v-if="reset.open" class="uga-reset">
          <template v-if="!reset.done">
            <label class="uga-field">
              <span>새 임시 비밀번호</span>
              <div class="uga-password">
                <input v-model="reset.password" :type="reset.show ? 'text' : 'password'" class="uga-mono" autocomplete="new-password" />
                <button type="button" class="uga-icon-btn" :title="reset.show ? '숨기기' : '보기'" @click="reset.show = !reset.show">{{ reset.show ? "◉" : "○" }}</button>
                <button type="button" class="uga-icon-btn" title="다시 생성" @click="reset.password = generatePassword()">↻</button>
              </div>
              <small class="uga-strength" :data-score="resetStrength.score">{{ resetStrength.label }}</small>
            </label>
            <div class="uga-reset-actions">
              <button type="button" class="uga-btn uga-btn-sm" @click="reset.open = false">취소</button>
              <button type="button" class="uga-btn uga-btn-sm uga-btn-primary" :disabled="busy || reset.password.length < 12" @click="applyReset">적용</button>
            </div>
          </template>
          <template v-else>
            <p class="uga-help">새 비밀번호가 적용되었습니다. 지금 복사해 사용자에게 전달하세요.</p>
            <code class="uga-credential">{{ user.userId }} / {{ reset.password }}</code>
            <div class="uga-reset-actions">
              <button type="button" class="uga-btn uga-btn-sm" @click="reset.open = false">닫기</button>
              <button type="button" class="uga-btn uga-btn-sm uga-btn-primary" @click="copyReset">로그인 정보 복사</button>
            </div>
          </template>
        </div>
      </section>

      <form class="uga-form" @submit.prevent="isNew ? create() : save()">
        <section class="uga-section">
          <h4>기본 정보</h4>
          <label class="uga-field">
            <span>이름 <b>*</b></span>
            <input ref="nameInput" v-model="draft.name" maxlength="200" required placeholder="홍길동" />
          </label>
          <label class="uga-field">
            <span>이메일</span>
            <input v-model="draft.email" type="email" maxlength="200" placeholder="name@company.com" @input="onEmailInput" />
            <small v-if="emailError" class="uga-field-error">{{ emailError }}</small>
          </label>
          <label v-if="isNew" class="uga-field">
            <span>아이디 <b>*</b> <small v-if="!idTouched && draft.userId" class="uga-muted">이메일에서 자동 입력</small></span>
            <input v-model="draft.userId" maxlength="200" autocomplete="off" spellcheck="false" class="uga-mono" placeholder="gildong.hong" @input="idTouched = true" />
            <small v-if="idStatus.text" :class="idStatus.tone === 'ok' ? 'uga-field-ok' : 'uga-field-error'">
              {{ idStatus.tone === "ok" ? "✓" : "!" }} {{ idStatus.text }}
            </small>
          </label>
          <label class="uga-field">
            <span>전화번호</span>
            <input v-model="draft.tel" type="tel" maxlength="50" placeholder="010-0000-0000" />
          </label>
        </section>

        <section class="uga-section">
          <h4>역할</h4>
          <div class="uga-role-cards" role="radiogroup" aria-label="역할">
            <label
              v-for="role in ROLE_OPTIONS"
              :key="role.value"
              class="uga-role-card"
              :class="[`role-${role.value.toLowerCase()}`, { 'is-checked': draft.role === role.value, 'is-disabled': isSelf && role.value !== 'ADMIN' }]"
            >
              <input v-model="draft.role" type="radio" name="uga-role" :value="role.value" :disabled="isSelf && role.value !== 'ADMIN'" />
              <strong>{{ role.label }}</strong>
              <small>{{ role.description }}</small>
            </label>
          </div>
          <p v-if="isSelf" class="uga-help">자기 계정의 관리자 권한은 다른 관리자만 변경할 수 있습니다.</p>
        </section>

        <section class="uga-section">
          <h4>소속 그룹 <span class="uga-muted">{{ draft.groupCds.length }}</span></h4>
          <div class="uga-chip-editor">
            <span
              v-for="groupCd in draft.groupCds"
              :key="groupCd"
              class="uga-chip uga-chip-lg"
              :style="{ '--hue': avatarHue(groupCd) }"
            >
              <button type="button" class="uga-chip-label" :title="groupByCd.get(groupCd)?.path.join(' › ')" @click="emit('open-group', groupCd)">
                {{ groupByCd.get(groupCd)?.name ?? "삭제된 그룹" }}
              </button>
              <button type="button" class="uga-chip-x" :aria-label="`${groupByCd.get(groupCd)?.name} 그룹에서 제외`" @click="removeGroup(groupCd)">×</button>
            </span>
            <button type="button" class="uga-chip uga-chip-add" :disabled="!pickerItems.length" @click="pickerOpen = true">
              ＋ 그룹 추가
            </button>
          </div>
          <p v-if="!groups.length" class="uga-help">아직 그룹이 없습니다. 왼쪽 ‘그룹 ＋’에서 만들 수 있습니다.</p>
        </section>

        <section v-if="isNew" class="uga-section">
          <h4>초기 비밀번호</h4>
          <div class="uga-password">
            <input v-model="draft.password" :type="showPassword ? 'text' : 'password'" class="uga-mono" minlength="12" maxlength="256" autocomplete="new-password" />
            <button type="button" class="uga-icon-btn" :title="showPassword ? '숨기기' : '보기'" @click="showPassword = !showPassword">{{ showPassword ? "◉" : "○" }}</button>
            <button type="button" class="uga-icon-btn" title="다시 생성" @click="draft.password = generatePassword()">↻</button>
          </div>
          <small class="uga-strength" :data-score="strength.score">{{ strength.label }} · 자동 생성된 안전한 비밀번호입니다</small>
        </section>

        <section v-if="!isNew" class="uga-section uga-meta">
          <h4>활동</h4>
          <dl>
            <div><dt>최근 로그인</dt><dd :title="formatDateTime(user.lastLoginAt)">{{ formatRelative(user.lastLoginAt) }}</dd></div>
            <div><dt>로그인 세션</dt><dd>{{ user.activeSessions ? `${user.activeSessions}개 유지 중` : "없음" }}</dd></div>
            <div><dt>등록일</dt><dd>{{ user.createdAt ? String(user.createdAt).slice(0, 10) : "-" }}</dd></div>
          </dl>
        </section>

        <section v-if="!isNew" class="uga-section uga-danger">
          <h4>위험 구역</h4>
          <div class="uga-danger-row">
            <span>
              <strong>사용자 삭제</strong>
              <small>계정과 권한이 영구 삭제됩니다.</small>
            </span>
            <button type="button" class="uga-btn uga-btn-sm uga-btn-danger" :disabled="busy || isSelf" :title="isSelf ? '자기 계정은 삭제할 수 없습니다.' : ''" @click="remove">삭제</button>
          </div>
        </section>

        <p v-if="formError" class="uga-form-error" role="alert">{{ formError }}</p>
        <button type="submit" hidden></button>
      </form>
    </div>

    <footer class="uga-panel-foot" :class="{ 'is-dirty': !isNew && isDirty }">
      <template v-if="isNew">
        <button type="button" class="uga-btn" @click="emit('close')">{{ recentCreated.length ? "완료" : "취소" }}</button>
        <button type="button" class="uga-btn uga-btn-primary" :disabled="busy || !canCreate" @click="create">
          {{ busy ? "추가 중..." : "추가" }} <kbd>Ctrl+S</kbd>
        </button>
      </template>
      <template v-else-if="isDirty">
        <span class="uga-dirty-note">변경 {{ changedFields.length }}건 저장 안 됨</span>
        <button type="button" class="uga-btn" :disabled="busy" @click="discard">되돌리기</button>
        <button type="button" class="uga-btn uga-btn-primary" :disabled="busy || Boolean(emailError)" @click="save">
          {{ busy ? "저장 중..." : "저장" }} <kbd>Ctrl+S</kbd>
        </button>
      </template>
      <template v-else>
        <span class="uga-muted">변경 사항은 저장 버튼을 눌러 반영됩니다.</span>
      </template>
    </footer>

    <AdminPicker
      v-if="pickerOpen"
      title="그룹에 추가"
      :description="`${draft.name || '사용자'}님이 소속될 그룹을 고르세요.`"
      :items="pickerItems"
      confirm-label="추가"
      empty-text="추가할 수 있는 그룹이 없습니다."
      @confirm="addGroups"
      @close="pickerOpen = false"
    />
  </div>
</template>
