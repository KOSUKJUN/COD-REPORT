<script setup>
import { computed, onMounted, ref } from "vue";
import { importAdminUsers } from "../../reports-api.js";
import { ROLE_LABELS, ROLE_OPTIONS, generatePassword, parseUserImport, toCsv } from "../../user-admin.js";
import { copyText, credentialText, downloadTextFile, todayStamp } from "./admin-dom.js";

const props = defineProps({
  groups: { type: Array, required: true },
  existingUserIds: { type: Array, required: true },
});
const emit = defineEmits(["close", "imported"]);

const step = ref("input");
const source = ref("");
const fileName = ref("");
const defaultRole = ref("VIEWER");
const createMissingGroups = ref(true);
const roleOverrides = ref({});
const excluded = ref(new Set());
const busy = ref(false);
const errorMessage = ref("");
const result = ref(null);
const textArea = ref(null);
const dragOver = ref(false);

const parsed = computed(() => parseUserImport(source.value, {
  existingUserIds: props.existingUserIds,
  defaultRole: defaultRole.value,
}));
const groupNames = computed(() => new Set(props.groups.map((group) => group.name.toLowerCase())));
const rows = computed(() => parsed.value.rows.map((row) => ({
  ...row,
  role: roleOverrides.value[row.line] ?? row.role,
  valid: row.issues.length === 0,
  included: row.issues.length === 0 && !excluded.value.has(row.line),
  newGroups: row.groups.filter((name) => !groupNames.value.has(name.toLowerCase())),
})));
const includedRows = computed(() => rows.value.filter((row) => row.included));
const invalidCount = computed(() => rows.value.filter((row) => !row.valid).length);
const newGroupNames = computed(() => [...new Set(includedRows.value.flatMap((row) => row.newGroups))]);
const blockedByGroups = computed(() => !createMissingGroups.value && newGroupNames.value.length > 0);

const COLUMN_LABELS = { userId: "아이디", name: "이름", email: "이메일", tel: "전화", role: "역할", groups: "그룹", password: "비밀번호" };

function toPreview() {
  errorMessage.value = "";
  if (!parsed.value.rows.length) {
    errorMessage.value = "가져올 내용이 없습니다. 엑셀에서 표를 복사해 붙여넣거나 CSV 파일을 선택하세요.";
    return;
  }
  if (!parsed.value.columns.includes("userId")) {
    errorMessage.value = "아이디 열을 찾지 못했습니다. 첫 줄에 ‘아이디’, ‘이름’ 같은 머리글을 넣어 주세요.";
    return;
  }
  roleOverrides.value = {};
  excluded.value = new Set();
  step.value = "preview";
}

async function readFile(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    errorMessage.value = "2MB 이하 파일만 가져올 수 있습니다.";
    return;
  }
  const buffer = await file.arrayBuffer();
  let textValue;
  try {
    textValue = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    // 한글 엑셀이 저장한 CSV(CP949)
    textValue = new TextDecoder("euc-kr").decode(buffer);
  }
  source.value = textValue;
  fileName.value = file.name;
  toPreview();
}

function onFileInput(event) {
  readFile(event.target.files?.[0]);
  event.target.value = "";
}

function onDrop(event) {
  dragOver.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) readFile(file);
}

function downloadTemplate() {
  downloadTextFile("사용자_가져오기_양식.csv", toCsv([
    ["아이디", "이름", "이메일", "역할", "그룹", "전화"],
    ["gildong.hong", "홍길동", "gildong@example.com", "뷰어", "보안관제팀;야간근무", "010-1234-5678"],
    ["younghee.kim", "김영희", "younghee@example.com", "에디터", "보고서작성팀", ""],
  ]));
}

function toggleRow(row) {
  if (!row.valid) return;
  const next = new Set(excluded.value);
  if (next.has(row.line)) next.delete(row.line);
  else next.add(row.line);
  excluded.value = next;
}

async function runImport() {
  if (busy.value || !includedRows.value.length || blockedByGroups.value) return;
  busy.value = true;
  errorMessage.value = "";
  const payload = includedRows.value.map((row) => ({
    line: row.line,
    userId: row.userId,
    name: row.name,
    email: row.email,
    tel: row.tel,
    role: row.role,
    groups: row.groups,
    password: row.password || generatePassword(),
  }));
  try {
    const response = await importAdminUsers(
      payload.map(({ line, ...user }) => user),
      createMissingGroups.value,
    );
    const created = response.created.map((item) => ({ ...payload[item.index] }));
    const errors = response.errors.map((item) => ({ ...item, line: payload[item.index]?.line, name: payload[item.index]?.name }));
    result.value = { created, errors, createdGroups: response.createdGroups };
    step.value = "done";
    if (created.length) emit("imported", { message: `${created.length}명을 가져왔습니다.` });
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    busy.value = false;
  }
}

function downloadCredentials() {
  downloadTextFile(`계정정보_${todayStamp()}.csv`, toCsv([
    ["이름", "아이디", "임시 비밀번호", "역할", "그룹"],
    ...result.value.created.map((user) => [user.name, user.userId, user.password, ROLE_LABELS[user.role], user.groups.join(";")]),
  ]));
}

async function copyCredentials() {
  await copyText(result.value.created.map(credentialText).join("\n\n"));
}

function onKeydown(event) {
  if (event.key === "Escape") {
    event.stopPropagation();
    emit("close");
  }
}

onMounted(() => textArea.value?.focus());
</script>

<template>
  <Teleport to="body">
    <div class="uga-layer uga-backdrop" @keydown="onKeydown">
      <section class="uga-dialog uga-import" role="dialog" aria-modal="true" aria-labelledby="uga-import-title">
        <header class="uga-dialog-head popup-titlebar">
          <div>
            <p class="uga-eyebrow">일괄 등록</p>
            <h3 id="uga-import-title">엑셀·CSV로 사용자 가져오기</h3>
          </div>
          <ol class="uga-steps" aria-label="진행 단계">
            <li :class="{ active: step === 'input', done: step !== 'input' }">1 붙여넣기</li>
            <li :class="{ active: step === 'preview', done: step === 'done' }">2 확인</li>
            <li :class="{ active: step === 'done' }">3 완료</li>
          </ol>
          <button class="uga-icon-btn" type="button" aria-label="닫기" @click="emit('close')">×</button>
        </header>

        <div class="uga-dialog-body">
          <template v-if="step === 'input'">
            <div
              class="uga-dropzone"
              :class="{ 'is-over': dragOver }"
              @dragover.prevent="dragOver = true"
              @dragleave="dragOver = false"
              @drop.prevent="onDrop"
            >
              <textarea
                ref="textArea"
                v-model="source"
                spellcheck="false"
                placeholder="엑셀에서 표를 선택해 복사(Ctrl+C)한 뒤 여기에 붙여넣으세요(Ctrl+V).&#10;&#10;아이디	이름	이메일	역할	그룹&#10;gildong.hong	홍길동	gildong@example.com	뷰어	보안관제팀"
              ></textarea>
              <div class="uga-dropzone-foot">
                <span>또는 CSV 파일을 여기에 끌어다 놓거나</span>
                <label class="uga-btn uga-btn-sm">
                  파일 선택
                  <input type="file" accept=".csv,.tsv,.txt,text/csv" hidden @change="onFileInput" />
                </label>
                <button type="button" class="uga-link" @click="downloadTemplate">양식 내려받기</button>
              </div>
            </div>
            <ul class="uga-tips">
              <li>머리글은 <b>아이디·이름·이메일·역할·그룹·전화</b> 등을 자동으로 알아봅니다. 열 순서는 자유입니다.</li>
              <li>역할은 관리자/에디터/뷰어(admin/editor/viewer)로 적고, 비워 두면 기본 역할이 적용됩니다.</li>
              <li>여러 그룹은 <b>;</b> 또는 <b>,</b>로 구분합니다. 비밀번호를 비워 두면 안전한 임시 비밀번호를 만듭니다.</li>
            </ul>
          </template>

          <template v-else-if="step === 'preview'">
            <div class="uga-import-summary">
              <div>
                <strong>{{ rows.length }}행</strong> 중 <strong class="ok">{{ includedRows.length }}명</strong> 가져오기
                <span v-if="invalidCount" class="bad"> · 오류 {{ invalidCount }}행 제외</span>
                <span v-if="fileName" class="uga-muted"> · {{ fileName }}</span>
              </div>
              <div class="uga-muted">
                인식한 열: {{ parsed.columns.filter(Boolean).map((column) => COLUMN_LABELS[column]).join(", ") }}
              </div>
            </div>
            <div class="uga-import-options">
              <label class="uga-field uga-field-inline">
                <span>역할이 비어 있으면</span>
                <select v-model="defaultRole">
                  <option v-for="role in ROLE_OPTIONS" :key="role.value" :value="role.value">{{ role.label }}</option>
                </select>
              </label>
              <label class="uga-toggle">
                <input v-model="createMissingGroups" type="checkbox" />
                없는 그룹은 새로 만들기
                <em v-if="newGroupNames.length" class="uga-muted">({{ newGroupNames.join(", ") }})</em>
              </label>
            </div>
            <div class="uga-import-table-wrap">
              <table class="uga-import-table">
                <thead>
                  <tr><th></th><th>줄</th><th>아이디</th><th>이름</th><th>이메일</th><th>역할</th><th>그룹</th><th>확인</th></tr>
                </thead>
                <tbody>
                  <tr v-for="row in rows" :key="row.line" :class="{ invalid: !row.valid, excluded: row.valid && !row.included }">
                    <td><input type="checkbox" :checked="row.included" :disabled="!row.valid" :aria-label="`${row.line}줄 포함`" @change="toggleRow(row)" /></td>
                    <td class="uga-muted">{{ row.line }}</td>
                    <td class="uga-mono">{{ row.userId || "—" }}</td>
                    <td>{{ row.name || "—" }}</td>
                    <td>{{ row.email }}</td>
                    <td>
                      <select :value="row.role" :disabled="!row.valid" @change="roleOverrides = { ...roleOverrides, [row.line]: $event.target.value }">
                        <option v-for="role in ROLE_OPTIONS" :key="role.value" :value="role.value">{{ role.label }}</option>
                      </select>
                    </td>
                    <td>
                      <span v-for="name in row.groups" :key="name" class="uga-chip" :class="{ 'is-new': row.newGroups.includes(name) }">
                        {{ name }}<small v-if="row.newGroups.includes(name)"> 새</small>
                      </span>
                    </td>
                    <td>
                      <span v-if="row.valid" class="uga-field-ok">✓</span>
                      <span v-else class="uga-field-error">{{ row.issues.join(", ") }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="blockedByGroups" class="uga-form-error">없는 그룹이 있습니다. ‘없는 그룹은 새로 만들기’를 켜거나 그룹 이름을 확인해 주세요.</p>
          </template>

          <template v-else>
            <div class="uga-import-result">
              <div class="uga-result-hero" :class="{ partial: result.errors.length }">
                <span aria-hidden="true">{{ result.created.length ? "✓" : "!" }}</span>
                <div>
                  <strong>{{ result.created.length }}명을 추가했습니다</strong>
                  <p v-if="result.createdGroups.length">새 그룹 {{ result.createdGroups.length }}개: {{ result.createdGroups.join(", ") }}</p>
                  <p v-if="result.errors.length">{{ result.errors.length }}명은 추가하지 못했습니다.</p>
                </div>
              </div>
              <div v-if="result.created.length" class="uga-alert uga-alert-warn">
                <span>임시 비밀번호는 지금만 확인할 수 있습니다. 파일을 받아 안전하게 전달한 뒤 삭제하세요.</span>
              </div>
              <div v-if="result.created.length" class="uga-result-actions">
                <button type="button" class="uga-btn uga-btn-primary" @click="downloadCredentials">⬇ 계정 정보 CSV 받기</button>
                <button type="button" class="uga-btn" @click="copyCredentials">모두 복사</button>
              </div>
              <ul v-if="result.errors.length" class="uga-error-list">
                <li v-for="error in result.errors" :key="error.index">
                  <span class="uga-mono">{{ error.userId || `${error.line}줄` }}</span> {{ error.error }}
                </li>
              </ul>
            </div>
          </template>
          <p v-if="errorMessage" class="uga-form-error" role="alert">{{ errorMessage }}</p>
        </div>

        <footer class="uga-dialog-foot">
          <template v-if="step === 'input'">
            <button type="button" class="uga-btn" @click="emit('close')">취소</button>
            <button type="button" class="uga-btn uga-btn-primary" :disabled="!source.trim()" @click="toPreview">다음: 확인하기</button>
          </template>
          <template v-else-if="step === 'preview'">
            <button type="button" class="uga-btn" @click="step = 'input'">← 수정하기</button>
            <button type="button" class="uga-btn uga-btn-primary" :disabled="busy || !includedRows.length || blockedByGroups" @click="runImport">
              {{ busy ? "가져오는 중..." : `${includedRows.length}명 가져오기` }}
            </button>
          </template>
          <template v-else>
            <button type="button" class="uga-btn" @click="step = 'input'; source = ''; result = null">더 가져오기</button>
            <button type="button" class="uga-btn uga-btn-primary" @click="emit('close')">완료</button>
          </template>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
