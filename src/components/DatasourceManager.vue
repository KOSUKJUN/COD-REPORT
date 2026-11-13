<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import ActionIcon from "./ActionIcon.vue";
import { DATASOURCE_TYPES, getDatasourceType, parseDatasourceUrl } from "../datasource-url.js";
import {
  deleteDatasources,
  getDatasources,
  saveDatasource,
  testDatasource,
} from "../reports-api.js";

const emit = defineEmits(["close", "changed"]);
const props = defineProps({
  embedded: { type: Boolean, default: false },
});

const datasources = ref([]);
const loading = ref(true);
const listError = ref("");
const checkedIds = ref([]);
const editingId = ref(null); // null = 신규 등록
const form = ref(emptyForm());
const formMessage = ref(null);
const saving = ref(false);
const testing = ref(false);
const confirmDelete = ref(false);
const deleting = ref(false);
const nameInput = ref(null);

function emptyForm() {
  return { name: "", url: "", username: "", password: "", type: "oracle", enabled: true, hasPassword: false };
}

const typeInfo = computed(() => getDatasourceType(form.value.type));
const urlError = computed(() => {
  if (!form.value.url.trim()) return "";
  try {
    parseDatasourceUrl(form.value.type, form.value.url);
    return "";
  } catch (error) {
    return error.message;
  }
});
const allChecked = computed(
  () => datasources.value.length > 0 && checkedIds.value.length === datasources.value.length,
);
const canSave = computed(
  () => form.value.name.trim() && form.value.url.trim() && !urlError.value && !saving.value,
);

function typeLabel(type) {
  return getDatasourceType(type)?.label ?? type;
}

async function loadList() {
  loading.value = true;
  listError.value = "";
  try {
    datasources.value = await getDatasources();
    checkedIds.value = checkedIds.value.filter((id) => datasources.value.some((item) => item.id === id));
    emit("changed", datasources.value);
  } catch (error) {
    listError.value = `접속정보를 불러오지 못했습니다: ${error.message}`;
  } finally {
    loading.value = false;
  }
}

function startNew() {
  editingId.value = null;
  form.value = emptyForm();
  formMessage.value = null;
  confirmDelete.value = false;
  nextTick(() => nameInput.value?.focus());
}

function editDatasource(item) {
  editingId.value = item.id;
  form.value = {
    name: item.name,
    url: item.url,
    username: item.username,
    password: "",
    type: item.type,
    enabled: item.enabled,
    hasPassword: item.hasPassword,
  };
  formMessage.value = null;
}

function toggleAll(checked) {
  checkedIds.value = checked ? datasources.value.map((item) => item.id) : [];
}

function payload() {
  return {
    id: editingId.value || undefined,
    name: form.value.name.trim(),
    url: form.value.url.trim(),
    username: form.value.username.trim(),
    password: form.value.password,
    type: form.value.type,
    enabled: form.value.enabled,
  };
}

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  formMessage.value = null;
  try {
    const saved = await saveDatasource(payload());
    await loadList();
    editDatasource(saved);
    formMessage.value = { type: "success", text: "접속정보를 저장했습니다." };
  } catch (error) {
    formMessage.value = { type: "error", text: error.message };
  } finally {
    saving.value = false;
  }
}

async function runTest() {
  if (urlError.value || !form.value.url.trim() || testing.value) return;
  testing.value = true;
  formMessage.value = { type: "info", text: "접속을 확인하고 있습니다..." };
  try {
    const result = await testDatasource({ ...payload(), name: form.value.name.trim() || "접속 테스트" });
    formMessage.value = { type: "success", text: `접속에 성공했습니다. (${result.elapsedMs}ms)` };
  } catch (error) {
    formMessage.value = { type: "error", text: error.message };
  } finally {
    testing.value = false;
  }
}

async function removeChecked() {
  if (!checkedIds.value.length || deleting.value) return;
  deleting.value = true;
  try {
    await deleteDatasources(checkedIds.value);
    if (checkedIds.value.includes(editingId.value)) startNew();
    checkedIds.value = [];
    confirmDelete.value = false;
    await loadList();
    formMessage.value = { type: "success", text: "선택한 접속정보를 삭제했습니다." };
  } catch (error) {
    formMessage.value = { type: "error", text: error.message };
  } finally {
    deleting.value = false;
  }
}

function handleKeydown(event) {
  if (event.key === "Escape") {
    event.stopPropagation();
    if (confirmDelete.value) confirmDelete.value = false;
    else emit("close");
  }
}

onMounted(async () => {
  await loadList();
  nextTick(() => nameInput.value?.focus());
});
</script>

<template>
  <div :class="props.embedded ? 'dsm-embedded' : 'modal-backdrop'" @keydown="handleKeydown">
    <section :class="props.embedded ? 'dsm dsm-inline' : 'editor-modal dsm'" :role="props.embedded ? undefined : 'dialog'" :aria-modal="props.embedded ? undefined : 'true'" aria-labelledby="dsm-title">
      <header class="dsm-header" :class="{ 'popup-titlebar': !props.embedded }">
        <h2 id="dsm-title">접속정보</h2>
        <button class="modal-close-button" type="button" aria-label="닫기" @click="emit('close')">×</button>
      </header>

      <div class="dsm-body">
        <section class="dsm-list-pane" aria-labelledby="dsm-list-title">
          <h3 id="dsm-list-title" class="dsm-pane-title">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>
            접속정보 리스트
          </h3>
          <div class="dsm-table-wrap">
            <table class="dsm-table">
              <thead>
                <tr>
                  <th class="dsm-check">
                    <input
                      type="checkbox"
                      :checked="allChecked"
                      :disabled="!datasources.length"
                      aria-label="전체 선택"
                      @change="toggleAll($event.target.checked)"
                    />
                  </th>
                  <th>데이터소스</th>
                  <th>URL</th>
                </tr>
              </thead>
              <tbody>
                <tr class="dsm-row-local" title="리포트를 저장하는 기본 DB입니다. 서버 환경설정(.env)으로 관리됩니다.">
                  <td class="dsm-check"><input type="checkbox" disabled aria-label="기본 DB는 선택할 수 없습니다" /></td>
                  <td>
                    <strong>Local</strong>
                    <small>리포트 DB (기본)</small>
                  </td>
                  <td class="dsm-url">-</td>
                </tr>
                <tr
                  v-for="item in datasources"
                  :key="item.id"
                  :class="{ 'dsm-row-active': editingId === item.id, 'dsm-row-disabled': !item.enabled }"
                  tabindex="0"
                  @click="editDatasource(item)"
                  @keydown.enter="editDatasource(item)"
                >
                  <td class="dsm-check" @click.stop>
                    <input v-model="checkedIds" type="checkbox" :value="item.id" :aria-label="`${item.name} 선택`" />
                  </td>
                  <td>
                    <strong>{{ item.name }}</strong>
                    <small>
                      {{ typeLabel(item.type) }}
                      <span v-if="!item.enabled" class="dsm-off">미사용</span>
                    </small>
                  </td>
                  <td class="dsm-url">{{ item.url }}</td>
                </tr>
                <tr v-if="loading">
                  <td colspan="3" class="dsm-empty">불러오는 중...</td>
                </tr>
                <tr v-else-if="!datasources.length && !listError">
                  <td colspan="3" class="dsm-empty">등록된 외부 접속정보가 없습니다. [추가]로 등록하세요.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="listError" class="dsm-message dsm-message-error" role="alert">{{ listError }}</p>

          <div v-if="confirmDelete" class="dsm-confirm" role="alertdialog" aria-labelledby="dsm-confirm-text">
            <p id="dsm-confirm-text">
              선택한 접속정보 {{ checkedIds.length }}개를 삭제할까요? 이 접속정보를 쓰는 양식은 자동 생성 때 조회에 실패합니다.
            </p>
            <div class="dsm-actions">
              <button class="dsm-button" type="button" @click="confirmDelete = false"><ActionIcon name="cancel" />취소</button>
              <button class="dsm-button dsm-button-danger" type="button" :disabled="deleting" @click="removeChecked">
                <ActionIcon name="delete" />
                {{ deleting ? "삭제 중..." : "삭제" }}
              </button>
            </div>
          </div>
          <div v-else class="dsm-actions">
            <button class="dsm-button dsm-button-primary" type="button" @click="startNew"><ActionIcon name="add" />추가</button>
            <button
              class="dsm-button"
              type="button"
              :disabled="!checkedIds.length"
              @click="confirmDelete = true"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>
              삭제
            </button>
          </div>
        </section>

        <form class="dsm-form-pane" aria-labelledby="dsm-form-title" @submit.prevent="save">
          <h3 id="dsm-form-title" class="dsm-pane-title">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 9.5l3-3M5 7.5 3.8 8.7a2.5 2.5 0 0 0 3.5 3.5L8.5 11M11 8.5l1.2-1.2a2.5 2.5 0 0 0-3.5-3.5L7.5 5" /></svg>
            {{ editingId ? "접속정보 수정" : "접속정보 등록" }}
          </h3>

          <div class="dsm-fields">
            <label for="dsm-name">데이터소스</label>
            <input id="dsm-name" ref="nameInput" v-model="form.name" maxlength="120" required placeholder="예: 관제 DB" />

            <label for="dsm-url">URL</label>
            <div class="dsm-field-stack">
              <input
                id="dsm-url"
                v-model="form.url"
                maxlength="1000"
                required
                :placeholder="typeInfo?.example"
                :aria-invalid="Boolean(urlError)"
                spellcheck="false"
              />
              <small :class="urlError ? 'dsm-field-error' : 'dsm-field-hint'">{{ urlError || typeInfo?.hint }}</small>
            </div>

            <label for="dsm-user">사용자</label>
            <input id="dsm-user" v-model="form.username" maxlength="255" autocomplete="off" spellcheck="false" />

            <label for="dsm-password">패스워드</label>
            <div class="dsm-field-stack">
              <input
                id="dsm-password"
                v-model="form.password"
                type="password"
                maxlength="1000"
                autocomplete="new-password"
                :placeholder="editingId && form.hasPassword ? '변경하지 않으려면 비워 두세요' : ''"
              />
              <small v-if="editingId && form.hasPassword" class="dsm-field-hint">저장된 패스워드가 있습니다 (암호화 보관).</small>
            </div>

            <label for="dsm-type">종류</label>
            <select id="dsm-type" v-model="form.type">
              <option v-for="type in DATASOURCE_TYPES" :key="type.value" :value="type.value">{{ type.label }}</option>
            </select>

            <label for="dsm-enabled">사용여부</label>
            <select id="dsm-enabled" v-model="form.enabled">
              <option :value="true">사용</option>
              <option :value="false">미사용</option>
            </select>
          </div>

          <p
            v-if="formMessage"
            class="dsm-message"
            :class="`dsm-message-${formMessage.type}`"
            :role="formMessage.type === 'error' ? 'alert' : 'status'"
          >{{ formMessage.text }}</p>

          <div class="dsm-actions">
            <button
              class="dsm-button"
              type="button"
              :disabled="testing || !form.url.trim() || Boolean(urlError)"
              @click="runTest"
            ><ActionIcon name="run" />{{ testing ? "확인 중..." : "접속 테스트" }}</button>
            <button class="dsm-button dsm-button-primary" type="submit" :disabled="!canSave">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h8l2 2v8H3zM5.5 3v3h4V3M5.5 13V9.5h5V13" /></svg>
              {{ saving ? "저장 중..." : "저장" }}
            </button>
          </div>
        </form>
      </div>

      <footer v-if="!props.embedded" class="dsm-footer">
        <button class="dsm-button" type="button" @click="emit('close')">× 닫기</button>
      </footer>
    </section>
  </div>
</template>
