<script setup>
// 보고서 양식 관리 › 메일 전송: 받는 사람(직접 입력 주소 + 등록 사용자), 메일 내용, 자동 전송, 최근 전송 결과
// 직접 전송은 뷰어에서 보고서를 열고 '메일 전송' 버튼으로 한다.
import { computed, nextTick, onMounted, ref } from "vue";
import ActionIcon from "./ActionIcon.vue";

const props = defineProps({
  templateId: { type: String, required: true },
  templateLabel: { type: String, default: "" },
  users: { type: Array, required: true },
  usersLoaded: { type: Boolean, required: true },
});

const draft = ref(null);
const addresses = ref([]); // 직접 입력한 주소(칩)
const addressInput = ref("");
const addressInputRef = ref(null);
const userQuery = ref("");
const runs = ref([]);
const loading = ref(false);
const busy = ref(""); // "save" | ""
const error = ref("");
const message = ref("");
const saved = ref("");

const EMAIL_PATTERN = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;
const isValidEmail = (value) => EMAIL_PATTERN.test(value) && value.length <= 254;

const normalized = computed(() => draft.value && {
  ...draft.value,
  recipients: addresses.value,
});
const dirty = computed(() => Boolean(draft.value) && JSON.stringify(normalized.value) !== saved.value);
const invalidAddresses = computed(() => addresses.value.filter((address) => !isValidEmail(address)));

// ---------- 받는 사람 ----------

const userById = computed(() => new Map(props.users.map((user) => [user.id, user])));
const selectedUsers = computed(() => (draft.value?.users ?? []).map((id) => userById.value.get(id)).filter(Boolean));
const missingUserIds = computed(() => (draft.value?.users ?? []).filter((id) => !userById.value.has(id)));

// 실제로 메일이 갈 주소(중복 제거, 대소문자 무시)
const recipientCount = computed(() => {
  const set = new Set(addresses.value.filter(isValidEmail).map((address) => address.toLowerCase()));
  for (const user of selectedUsers.value) if (user.email) set.add(user.email.toLowerCase());
  return set.size;
});

const filteredUsers = computed(() => {
  const query = userQuery.value.trim().toLowerCase();
  const list = query
    ? props.users.filter((user) => [user.name, user.userId, user.email].some((value) => String(value ?? "").toLowerCase().includes(query)))
    : props.users;
  // 선택한 사용자를 먼저, 이메일 없는 사용자는 뒤로
  return [...list].sort((a, b) =>
    Number(isUserSelected(b)) - Number(isUserSelected(a)) || Number(Boolean(b.email)) - Number(Boolean(a.email)),
  );
});

function isUserSelected(user) {
  return draft.value?.users.includes(user.id) ?? false;
}

function toggleUser(user) {
  if (!draft.value) return;
  if (isUserSelected(user)) draft.value.users = draft.value.users.filter((id) => id !== user.id);
  else if (user.email) draft.value.users = [...draft.value.users, user.id];
}

function removeUser(id) {
  draft.value.users = draft.value.users.filter((userId) => userId !== id);
}

function addAddresses(text) {
  const parts = String(text).split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean);
  const existing = new Set(addresses.value.map((address) => address.toLowerCase()));
  for (const part of parts) {
    if (existing.has(part.toLowerCase())) continue;
    existing.add(part.toLowerCase());
    addresses.value = [...addresses.value, part];
  }
}

function commitAddressInput() {
  if (!addressInput.value.trim()) return;
  addAddresses(addressInput.value);
  addressInput.value = "";
}

function handleAddressKeydown(event) {
  if (event.isComposing || event.keyCode === 229) return;
  if (["Enter", ",", ";", " ", "Tab"].includes(event.key) && addressInput.value.trim()) {
    if (event.key !== "Tab") event.preventDefault();
    commitAddressInput();
  } else if (event.key === "Backspace" && !addressInput.value && addresses.value.length) {
    // 빈 입력칸에서 Backspace: 마지막 주소를 다시 고칠 수 있게 입력칸으로 돌려놓는다.
    addressInput.value = addresses.value.at(-1);
    addresses.value = addresses.value.slice(0, -1);
    event.preventDefault();
  }
}

function handleAddressPaste(event) {
  const text = event.clipboardData?.getData("text/plain") ?? "";
  if (!/[\s,;]/.test(text.trim())) return;
  event.preventDefault();
  addAddresses(`${addressInput.value} ${text}`);
  addressInput.value = "";
}

function removeAddress(index) {
  addresses.value = addresses.value.filter((_, itemIndex) => itemIndex !== index);
  nextTick(() => addressInputRef.value?.focus());
}

// ---------- 불러오기·저장·전송 ----------

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `메일 요청에 실패했습니다 (${response.status}).`);
  return result;
}

const url = computed(() => `/api/templates/${encodeURIComponent(props.templateId)}/mail`);

function applySettings(settings) {
  draft.value = { ...settings, users: [...settings.users] };
  addresses.value = [...settings.recipients];
  saved.value = JSON.stringify({ ...settings, recipients: settings.recipients });
}

async function load({ keepMessage = false } = {}) {
  loading.value = true;
  if (!keepMessage) message.value = "";
  error.value = "";
  try {
    const result = await request(url.value);
    applySettings(result.settings);
    runs.value = result.runs ?? [];
  } catch (failure) {
    error.value = failure.message;
  } finally {
    loading.value = false;
  }
}

async function save() {
  commitAddressInput();
  if (invalidAddresses.value.length) {
    error.value = `이메일 주소 형식을 확인해 주세요: ${invalidAddresses.value.join(", ")}`;
    return;
  }
  busy.value = "save";
  error.value = "";
  message.value = "";
  try {
    const result = await request(url.value, { method: "PUT", body: JSON.stringify(normalized.value) });
    applySettings(result.settings);
    message.value = "메일 전송 설정을 저장했습니다.";
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = "";
  }
}

function resetDraft() {
  applySettings(JSON.parse(saved.value));
  addressInput.value = "";
  error.value = "";
}

const defaultSubject = computed(() => `${props.templateLabel || "양식 이름"} - 보고서 날짜`);

function formatRunTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace("T", " ");
  return date.toLocaleString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

onMounted(() => load());
</script>

<template>
  <div class="tm-panel tm-mail" role="tabpanel">
    <p v-if="loading && !draft" class="tm-mail-loading" role="status">메일 전송 설정을 불러오고 있습니다…</p>

    <template v-else-if="!draft">
      <p class="tm-banner tm-banner-error" role="alert">{{ error || "메일 전송 설정을 불러오지 못했습니다." }}</p>
      <div class="tm-inline-actions">
        <button class="modal-secondary-button" type="button" :disabled="loading" @click="load()">다시 불러오기</button>
      </div>
    </template>

    <form v-else class="tm-mail-form" @submit.prevent="save">
      <label class="tm-switch-row">
        <input v-model="draft.enabled" class="tm-switch-input" type="checkbox" />
        <span class="tm-switch" aria-hidden="true"></span>
        <span class="tm-switch-text">
          <strong>예약 생성 후 자동 전송</strong>
          <small>‘일정’ 탭의 예약 시간에 보고서가 만들어지면 받는 사람에게 PDF를 바로 보냅니다.</small>
        </span>
      </label>

      <!-- 받는 사람 -->
      <section class="tm-mail-card" aria-labelledby="tm-mail-recipients-title">
        <header class="tm-mail-card-head">
          <h4 id="tm-mail-recipients-title">받는 사람</h4>
          <span class="tm-mail-count" :class="{ 'tm-mail-count-empty': !recipientCount }">{{ recipientCount }}명</span>
        </header>

        <div class="tm-field">
          <span>이메일 주소 직접 입력</span>
          <div class="tm-mail-chips" @click="addressInputRef?.focus()">
            <span
              v-for="(address, index) in addresses"
              :key="`${address}-${index}`"
              class="tm-mail-chip"
              :class="{ 'tm-mail-chip-invalid': !isValidEmail(address) }"
              :title="isValidEmail(address) ? address : '이메일 주소 형식이 올바르지 않습니다'"
            >
              {{ address }}
              <button type="button" :aria-label="`${address} 삭제`" @click.stop="removeAddress(index)">×</button>
            </span>
            <input
              ref="addressInputRef"
              v-model="addressInput"
              type="email"
              inputmode="email"
              autocomplete="off"
              :placeholder="addresses.length ? '' : 'name@example.com 입력 후 Enter'"
              aria-label="받는 사람 이메일 주소 추가"
              @keydown="handleAddressKeydown"
              @paste="handleAddressPaste"
              @blur="commitAddressInput"
            />
          </div>
          <span class="tm-field-hint">Enter·쉼표·공백으로 구분합니다. 여러 주소를 한꺼번에 붙여넣을 수도 있습니다.</span>
          <span v-if="invalidAddresses.length" class="tm-field-error">빨간색 주소는 형식이 올바르지 않습니다. 고치거나 삭제하세요.</span>
        </div>

        <div class="tm-field">
          <span>등록된 사용자 <small class="tm-mail-subtle">{{ selectedUsers.length }}명 선택</small></span>
          <p v-if="!usersLoaded" class="tm-banner tm-banner-error">사용자 목록을 불러오지 못했습니다. 양식 관리를 다시 열어 주세요.</p>
          <template v-else>
            <input v-model="userQuery" class="tm-mail-search" type="search" placeholder="이름·아이디·이메일 검색" aria-label="사용자 검색" />
            <ul class="tm-mail-users" role="listbox" aria-multiselectable="true" aria-label="받는 사용자 선택">
              <li
                v-for="user in filteredUsers"
                :key="user.id"
                role="option"
                :aria-selected="isUserSelected(user)"
                :aria-disabled="!user.email && !isUserSelected(user)"
                :class="{ 'tm-mail-user-selected': isUserSelected(user), 'tm-mail-user-disabled': !user.email && !isUserSelected(user) }"
                :title="user.email ? undefined : '이메일이 등록되지 않아 받을 수 없습니다'"
                @click="toggleUser(user)"
              >
                <input type="checkbox" tabindex="-1" :checked="isUserSelected(user)" :disabled="!user.email && !isUserSelected(user)" aria-hidden="true" @click.stop="toggleUser(user)" />
                <span class="tm-mail-user-name">{{ user.name }} <small>{{ user.userId }}</small></span>
                <span class="tm-mail-user-email">{{ user.email || "이메일 없음" }}</span>
              </li>
              <li v-if="!filteredUsers.length" class="tm-mail-users-empty">{{ users.length ? "검색 결과가 없습니다." : "등록된 사용자가 없습니다." }}</li>
            </ul>
          </template>
          <div v-if="missingUserIds.length" class="tm-banner tm-banner-error tm-mail-missing">
            <span>더 이상 사용할 수 없는 사용자가 포함되어 있습니다.</span>
            <span v-for="id in missingUserIds" :key="id" class="tm-mail-chip tm-mail-chip-invalid">
              {{ id }}
              <button type="button" :aria-label="`${id} 제거`" @click="removeUser(id)">×</button>
            </span>
          </div>
        </div>
      </section>

      <!-- 메일 내용 -->
      <section class="tm-mail-card" aria-labelledby="tm-mail-content-title">
        <header class="tm-mail-card-head">
          <h4 id="tm-mail-content-title">메일 내용</h4>
          <span class="tm-mail-attachment"><ActionIcon name="attach" />최신 보고서 PDF 첨부</span>
        </header>
        <label class="tm-field">
          <span>제목</span>
          <input v-model="draft.subject" maxlength="200" :placeholder="`비워 두면: ${defaultSubject}`" />
        </label>
        <label class="tm-field">
          <span>본문 <small class="tm-mail-subtle">{{ draft.body.length.toLocaleString() }} / 10,000</small></span>
          <textarea v-model="draft.body" maxlength="10000" rows="5" placeholder="비워 두면: 보고서를 첨부합니다." />
        </label>
      </section>

      <p class="tm-banner tm-banner-info tm-mail-notice">
        자동 전송은 예약 생성된 보고서를, 직접 전송은 <strong>뷰어에서 보고서를 열고 ‘메일 전송’ 버튼</strong>으로 그 보고서를 보냅니다.
        첨부한 보고서는 <strong>결과 열람 권한과 관계없이</strong> 받는 사람 모두에게 전달됩니다. 주소를 확인하세요.
      </p>

      <p v-if="error" class="tm-banner tm-banner-error" role="alert">{{ error }}</p>
      <p v-else-if="message" class="tm-banner tm-banner-info" role="status">{{ message }}</p>

      <div class="tm-mail-actions">
        <span v-if="dirty" class="tm-mail-dirty">저장하지 않은 변경이 있습니다.
          <button type="button" class="tm-link-button" @click="resetDraft">되돌리기</button>
        </span>
        <span v-else class="tm-mail-subtle">설정이 저장되어 있습니다.</span>
        <div class="tm-inline-actions">
          <button class="tm-primary" type="submit" :disabled="Boolean(busy) || !usersLoaded || !dirty">
            <ActionIcon name="save" />{{ busy === "save" ? "저장 중..." : "설정 저장" }}
          </button>
        </div>
      </div>
    </form>

    <!-- 최근 전송 결과 -->
    <section v-if="draft" class="tm-mail-history" aria-labelledby="tm-mail-history-title">
      <header class="tm-mail-card-head">
        <h4 id="tm-mail-history-title">최근 전송 결과</h4>
        <button class="tm-link-button" type="button" :disabled="loading" @click="load({ keepMessage: true })">{{ loading ? "불러오는 중..." : "새로고침" }}</button>
      </header>
      <p v-if="!runs.length" class="tm-mail-subtle">아직 전송한 기록이 없습니다.</p>
      <ul v-else class="tm-mail-runs">
        <li v-for="(run, index) in runs" :key="index" :class="run.status === 'succeeded' ? 'tm-mail-run-ok' : 'tm-mail-run-fail'">
          <span class="tm-mail-run-status">{{ run.status === "succeeded" ? "전송됨" : "실패" }}</span>
          <span class="tm-mail-run-source">{{ run.source === "schedule" ? "자동" : "직접" }}</span>
          <time>{{ formatRunTime(run.createdAt) }}</time>
          <span v-if="run.error" class="tm-mail-run-error" :title="run.error">{{ run.error }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style>
.tm-mail-form {
  display: grid;
  gap: 14px;
}

.tm-mail-loading {
  color: var(--tm-muted);
  font-size: 12px;
}

.tm-mail-card,
.tm-mail-history {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--tm-border);
  border-radius: 9px;
  background: #fff;
}

.tm-mail-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.tm-mail-card-head h4 {
  margin: 0;
  color: var(--tm-text);
  font-size: 12.5px;
}

.tm-mail-count {
  padding: 2px 9px;
  border-radius: 999px;
  background: #e8edfb;
  color: var(--tm-accent);
  font-size: 11px;
  font-weight: 700;
}

.tm-mail-count-empty {
  background: #f1f2f5;
  color: #8a92a2;
}

.tm-mail-subtle {
  color: var(--tm-muted);
  font-size: 11px;
  font-weight: 400;
}

.tm-mail-chips {
  display: flex;
  min-height: 38px;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  padding: 5px 7px;
  border: 1px solid #dbe0ea;
  border-radius: 7px;
  background: #fff;
  cursor: text;
}

.tm-mail-chips:focus-within {
  border-color: #8b9cd9;
  box-shadow: 0 0 0 3px #344ea71a;
}

.tm-field .tm-mail-chips input {
  width: auto;
  min-width: 160px;
  height: 26px;
  flex: 1;
  padding: 0 4px;
  border: 0;
  border-radius: 0;
  outline: 0;
  box-shadow: none;
  background: transparent;
  color: var(--tm-text);
  font-size: 12.5px;
  font-weight: 400;
}

.tm-mail-chip {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 3px;
  padding: 2px 4px 2px 9px;
  border: 1px solid #d6def3;
  border-radius: 999px;
  background: #f1f4fc;
  color: #2f3f73;
  font-size: 11.5px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.tm-mail-chip button {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #7c88aa;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}

.tm-mail-chip button:hover {
  background: #dfe5f6;
  color: #2f3f73;
}

.tm-mail-chip-invalid {
  border-color: #f0c4c4;
  background: #fdf1f1;
  color: #a33a3a;
}

.tm-mail-search {
  height: 32px !important;
  font-size: 12px !important;
}

.tm-mail-users {
  display: grid;
  max-height: 200px;
  margin: 0;
  padding: 4px;
  overflow: auto;
  border: 1px solid #e5e9f0;
  border-radius: 7px;
  list-style: none;
}

.tm-mail-users li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(0, 1.1fr);
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 5px;
  color: #4a5468;
  cursor: pointer;
  font-size: 12px;
  font-weight: 400;
}

.tm-field .tm-mail-users input[type="checkbox"] {
  width: 14px;
  height: 14px;
  margin: 0;
  padding: 0;
  accent-color: var(--tm-accent);
}

.tm-mail-users li:hover {
  background: #f5f7fb;
}

.tm-mail-users li.tm-mail-user-selected {
  background: #eef2fc;
}

.tm-mail-users li.tm-mail-user-disabled {
  color: #a7aebb;
  cursor: not-allowed;
}

.tm-mail-users li.tm-mail-users-empty {
  display: block;
  color: var(--tm-muted);
  cursor: default;
  text-align: center;
}

.tm-mail-user-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tm-mail-user-name small {
  margin-left: 3px;
  color: #98a0ae;
  font-size: 10.5px;
}

.tm-mail-user-email {
  overflow: hidden;
  color: #6c7588;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tm-mail-user-disabled .tm-mail-user-email {
  color: #c0a2a2;
  font-style: italic;
}

.tm-mail-missing {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.tm-mail-attachment {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--tm-muted);
  font-size: 11px;
}

.tm-mail-attachment svg {
  width: 13px;
  height: 13px;
}

.tm-mail .tm-field textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #dbe0ea;
  border-radius: 7px;
  color: var(--tm-text);
  font: inherit;
  font-size: 12.5px;
  font-weight: 400;
  line-height: 1.6;
  resize: vertical;
}

.tm-mail .tm-field textarea:focus {
  border-color: #8b9cd9;
  outline: 0;
  box-shadow: 0 0 0 3px #344ea71a;
}

.tm-mail .tm-field > span:first-child {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.tm-mail-notice strong {
  font-weight: 700;
}

.tm-mail-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 4px;
}

.tm-mail .tm-link-button {
  font-size: 11.5px;
}

.tm-mail-dirty {
  color: #9a6a12;
  font-size: 11.5px;
}

.tm-mail-actions .modal-secondary-button,
.tm-mail-actions .tm-primary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.tm-mail-runs {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tm-mail-runs li {
  display: grid;
  grid-template-columns: auto auto auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: #fafbfd;
  color: #4a5468;
  font-size: 11.5px;
}

.tm-mail-run-status {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
}

.tm-mail-run-ok .tm-mail-run-status {
  background: #e3f4ea;
  color: #23784a;
}

.tm-mail-run-fail .tm-mail-run-status {
  background: #fbe6e6;
  color: #a33a3a;
}

.tm-mail-run-source {
  padding: 1px 7px;
  border: 1px solid #e1e5ec;
  border-radius: 4px;
  color: #6c7588;
  font-size: 10.5px;
}

.tm-mail-runs time {
  color: #6c7588;
  font-variant-numeric: tabular-nums;
}

.tm-mail-run-error {
  overflow: hidden;
  color: #a33a3a;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .tm-mail-users li {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .tm-mail-user-email {
    grid-column: 2;
  }

  .tm-mail-runs li {
    grid-template-columns: auto auto minmax(0, 1fr);
  }

  .tm-mail-run-error {
    grid-column: 1 / -1;
  }
}
</style>
