<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import {
  bulkUpdateAdminUsers,
  createAdminGroup,
  getAdminGroups,
  getAdminUsers,
  updateAdminGroup,
} from "../../reports-api.js";
import {
  ROLE_LABELS,
  ROLE_OPTIONS,
  STATUS_LABELS,
  avatarHue,
  buildGroupTree,
  descendantGroupCds,
  filterUsers,
  formatDateTime,
  formatRelative,
  initials,
  matchesQuery,
  sortUsers,
  toCsv,
  userStatus,
} from "../../user-admin.js";
import AdminPicker from "./AdminPicker.vue";
import GroupPanel from "./GroupPanel.vue";
import UserImportDialog from "./UserImportDialog.vue";
import UserPanel from "./UserPanel.vue";
import { downloadTextFile, readStored, todayStamp, writeStored } from "./admin-dom.js";
import "./user-admin.css";

const props = defineProps({
  authUser: { type: Object, required: true },
  embedded: { type: Boolean, default: false },
});

// ---------- 데이터 ----------

const users = ref([]);
const groups = ref([]);
const loading = ref(true);
const loadError = ref("");
const busy = ref(false);

async function reload({ silent = false } = {}) {
  if (!silent) loading.value = true;
  try {
    const [userRows, groupRows] = await Promise.all([getAdminUsers(), getAdminGroups()]);
    users.value = userRows.map((user) => ({ ...user, groupCds: user.groupCds ?? [] }));
    groups.value = groupRows;
    loadError.value = "";
    const known = new Set(userRows.map((user) => user.userCd));
    for (const userCd of [...selection.value]) if (!known.has(userCd)) selection.value.delete(userCd);
    if (selectedGroupCd.value && !selectedGroupCd.value.startsWith("__") &&
      !groupRows.some((group) => group.groupCd === selectedGroupCd.value)) {
      selectedGroupCd.value = "";
    }
    if (panel.value?.type === "user" && !known.has(panel.value.userCd)) panel.value = null;
    if (panel.value?.type === "group" && !groupRows.some((group) => group.groupCd === panel.value.groupCd)) panel.value = null;
  } catch (error) {
    if (!users.value.length) loadError.value = error.message;
    else toast(error.message, "error");
  } finally {
    loading.value = false;
  }
}

const userByCd = computed(() => new Map(users.value.map((user) => [user.userCd, user])));
const groupTree = computed(() => buildGroupTree(groups.value));
const groupByCd = computed(() => new Map(groupTree.value.map((group) => [group.groupCd, group])));
const groupNames = computed(() => new Map(groups.value.map((group) => [group.groupCd, group.name])));
const existingUserIds = computed(() => users.value.map((user) => user.userId));

// ---------- 토스트 & 확인 창 ----------

const toasts = ref([]);
let toastSeq = 0;

function toast(message, tone = "success", undo = null) {
  const id = ++toastSeq;
  toasts.value.push({ id, message, tone, undo });
  if (toasts.value.length > 4) toasts.value.shift();
  setTimeout(() => dismissToast(id), undo ? 9000 : tone === "error" ? 8000 : 4500);
}

function dismissToast(id) {
  toasts.value = toasts.value.filter((item) => item.id !== id);
}

async function runUndo(item) {
  dismissToast(item.id);
  try {
    await item.undo();
    await reload({ silent: true });
    toast("되돌렸습니다.", "info");
  } catch (error) {
    toast(`되돌리지 못했습니다: ${error.message}`, "error");
  }
}

const confirmState = ref(null);
const confirmButton = ref(null);

function confirm(options) {
  return new Promise((resolve) => {
    confirmState.value = { tone: "primary", confirmLabel: "확인", altLabel: "", ...options, resolve };
    nextTick(() => confirmButton.value?.focus());
  });
}

function settleConfirm(answer) {
  confirmState.value?.resolve(answer);
  confirmState.value = null;
}

provide("adminUi", { toast, confirm });

// ---------- 보기 상태 ----------

const query = ref("");
const groupQuery = ref("");
const roleFilter = ref("");
const statusFilter = ref("");
const selectedGroupCd = ref("");
const includeSubgroups = ref(readStored("uga.includeSubgroups", true));
const sortKey = ref("name");
const sortDir = ref("asc");
const collapsed = ref(new Set(readStored("uga.collapsed", [])));
const searchInput = ref(null);

watch(includeSubgroups, (value) => writeStored("uga.includeSubgroups", value));

const selectedGroup = computed(() =>
  selectedGroupCd.value && !selectedGroupCd.value.startsWith("__") ? groupByCd.value.get(selectedGroupCd.value) : null);

const scopeCds = computed(() => {
  if (!selectedGroup.value) return null;
  return includeSubgroups.value
    ? descendantGroupCds(groups.value, selectedGroup.value.groupCd)
    : new Set([selectedGroup.value.groupCd]);
});

const baseUsers = computed(() => filterUsers(users.value, {
  groupCd: selectedGroupCd.value,
  scopeCds: scopeCds.value,
  groupNames: groupNames.value,
  query: query.value,
}));

const filteredUsers = computed(() => sortUsers(
  baseUsers.value.filter((user) => {
    if (roleFilter.value && user.role !== roleFilter.value) return false;
    if (statusFilter.value === "online") return user.activeSessions > 0;
    if (statusFilter.value) return userStatus(user) === statusFilter.value;
    return true;
  }),
  sortKey.value,
  sortDir.value,
));

const stats = computed(() => {
  const list = users.value;
  return {
    total: list.length,
    noGroup: list.filter((user) => !user.groupCds.length).length,
    locked: list.filter((user) => userStatus(user) === "locked").length,
  };
});

const scopeStats = computed(() => {
  const list = baseUsers.value;
  const byRole = { ADMIN: 0, EDITOR: 0, VIEWER: 0 };
  list.forEach((user) => { byRole[user.role] = (byRole[user.role] ?? 0) + 1; });
  return {
    total: list.length,
    online: list.filter((user) => user.activeSessions > 0).length,
    active: list.filter((user) => userStatus(user) === "active").length,
    locked: list.filter((user) => userStatus(user) === "locked").length,
    disabled: list.filter((user) => userStatus(user) === "disabled").length,
    byRole,
  };
});

const hasFilters = computed(() => Boolean(query.value || roleFilter.value || statusFilter.value));

function resetFilters() {
  query.value = "";
  roleFilter.value = "";
  statusFilter.value = "";
}

function setSort(key) {
  if (sortKey.value === key) sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  else {
    sortKey.value = key;
    sortDir.value = key === "lastLogin" ? "desc" : "asc";
  }
}

function ariaSort(key) {
  if (sortKey.value !== key) return "none";
  return sortDir.value === "asc" ? "ascending" : "descending";
}

// ---------- 그룹 트리 ----------

const parentMap = computed(() => new Map(groups.value.map((group) => [group.groupCd, group.parentGroupCd])));

function ancestorsOf(groupCd) {
  const result = [];
  let cursor = parentMap.value.get(groupCd);
  const seen = new Set();
  while (cursor && !seen.has(cursor) && groupByCd.value.has(cursor)) {
    seen.add(cursor);
    result.push(cursor);
    cursor = parentMap.value.get(cursor);
  }
  return result;
}

const visibleTree = computed(() => {
  if (groupQuery.value.trim()) {
    const matched = new Set();
    for (const group of groupTree.value) {
      if (matchesQuery([group.name, group.description], groupQuery.value)) {
        matched.add(group.groupCd);
        ancestorsOf(group.groupCd).forEach((cd) => matched.add(cd));
      }
    }
    return groupTree.value.filter((group) => matched.has(group.groupCd));
  }
  return groupTree.value.filter((group) => !ancestorsOf(group.groupCd).some((cd) => collapsed.value.has(cd)));
});

function toggleCollapse(groupCd) {
  if (collapsed.value.has(groupCd)) collapsed.value.delete(groupCd);
  else collapsed.value.add(groupCd);
  writeStored("uga.collapsed", [...collapsed.value]);
}

function memberCount(group) {
  return group.users?.length ?? 0;
}

async function selectGroup(groupCd) {
  if (selectedGroupCd.value === groupCd) return;
  selectedGroupCd.value = groupCd;
  selection.value.clear();
  lastIndex = null;
  if (groupCd && !groupCd.startsWith("__")) {
    ancestorsOf(groupCd).forEach((cd) => collapsed.value.delete(cd));
  }
}

// ---------- 선택 ----------

const selection = ref(new Set());
let lastIndex = null;
let shiftPressed = false;

const selectedUsers = computed(() => users.value.filter((user) => selection.value.has(user.userCd)));
const visibleSelectedCount = computed(() => filteredUsers.value.filter((user) => selection.value.has(user.userCd)).length);
const allVisibleSelected = computed(() =>
  filteredUsers.value.length > 0 && visibleSelectedCount.value === filteredUsers.value.length);
const selectionIncludesSelf = computed(() => selection.value.has(props.authUser.userCd));

function toggleAll() {
  if (allVisibleSelected.value) filteredUsers.value.forEach((user) => selection.value.delete(user.userCd));
  else filteredUsers.value.forEach((user) => selection.value.add(user.userCd));
}

function selectRange(index) {
  const start = Math.min(lastIndex ?? index, index);
  const end = Math.max(lastIndex ?? index, index);
  filteredUsers.value.slice(start, end + 1).forEach((user) => selection.value.add(user.userCd));
}

function onCheckChange(user, index) {
  if (shiftPressed && lastIndex !== null) selectRange(index);
  else if (selection.value.has(user.userCd)) selection.value.delete(user.userCd);
  else selection.value.add(user.userCd);
  lastIndex = index;
  shiftPressed = false;
}

function onRowClick(event, user, index) {
  if (event.target.closest("input, select, button, a, label")) return;
  if (event.shiftKey) {
    event.preventDefault();
    selectRange(index);
    lastIndex = index;
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    if (selection.value.has(user.userCd)) selection.value.delete(user.userCd);
    else selection.value.add(user.userCd);
    lastIndex = index;
    return;
  }
  lastIndex = index;
  openUser(user.userCd);
}

function clearSelection() {
  selection.value.clear();
  lastIndex = null;
}

// ---------- 패널 ----------

const panel = ref(null);
const panelRef = ref(null);

async function guardPanel() {
  if (!panelRef.value?.isDirty?.()) return true;
  const answer = await confirm({
    title: "저장하지 않은 변경이 있습니다",
    message: "이 패널을 닫으면 입력한 내용이 사라집니다.",
    confirmLabel: "저장하지 않고 닫기",
    tone: "danger",
  });
  return answer === true;
}

async function openPanel(next) {
  if (panel.value && JSON.stringify(panel.value) === JSON.stringify(next)) return;
  if (!(await guardPanel())) return;
  panel.value = next;
}

function openUser(userCd) {
  openPanel({ type: "user", userCd });
}

function openNewUser() {
  const defaultGroupCds = selectedGroup.value ? [selectedGroup.value.groupCd] : [];
  openPanel({ type: "newUser", defaultGroupCds });
}

function openGroup(groupCd) {
  openPanel({ type: "group", groupCd });
}

function openNewGroup({ parentGroupCd = "", userCds = [] } = {}) {
  openPanel({ type: "newGroup", parentGroupCd, userCds });
}

async function closePanel() {
  if (!(await guardPanel())) return;
  panel.value = null;
}

async function showGroupFromPanel(groupCd) {
  if (!(await guardPanel())) return;
  panel.value = null;
  selectGroup(groupCd);
}

const panelUser = computed(() => (panel.value?.type === "user" ? userByCd.value.get(panel.value.userCd) : null));
const panelGroup = computed(() => (panel.value?.type === "group" ? groups.value.find((group) => group.groupCd === panel.value.groupCd) : null));

async function onPanelChanged({ message, close = false, deletedGroupCd = "" } = {}) {
  if (close) panel.value = null;
  if (deletedGroupCd && selectedGroupCd.value === deletedGroupCd) selectedGroupCd.value = "";
  await reload({ silent: true });
  if (message) toast(message);
}

async function onUserCreated({ message }) {
  await reload({ silent: true });
  toast(message);
}

async function onGroupCreated({ groupCd, message }) {
  panel.value = null;
  await reload({ silent: true });
  clearSelection();
  selectedGroupCd.value = groupCd;
  toast(message);
}

// ---------- 일괄 작업 ----------

async function bulk(action, value, userCds) {
  return bulkUpdateAdminUsers(userCds, action, value);
}

async function perform(task, { message, undo = null } = {}) {
  if (busy.value) return false;
  busy.value = true;
  try {
    const result = await task();
    await reload({ silent: true });
    toast(typeof message === "function" ? message(result) : message, "success", undo);
    return true;
  } catch (error) {
    toast(error.message, "error");
    await reload({ silent: true });
    return false;
  } finally {
    busy.value = false;
  }
}

function groupByValue(userCds, read) {
  const map = new Map();
  for (const userCd of userCds) {
    const key = read(userByCd.value.get(userCd));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(userCd);
  }
  return map;
}

async function changeRole(userCds, role) {
  const targets = userCds.filter((userCd) => userByCd.value.get(userCd)?.role !== role);
  if (!targets.length) return false;
  if (role === "ADMIN") {
    const ok = await confirm({
      title: `${targets.length}명에게 관리자 권한을 줄까요?`,
      message: "관리자는 모든 사용자·그룹·접속정보를 변경할 수 있습니다.",
      confirmLabel: "관리자로 지정",
    });
    if (!ok) return false;
  }
  const previous = groupByValue(targets, (user) => user.role);
  const label = ROLE_LABELS[role];
  const who = targets.length === 1 ? `${userByCd.value.get(targets[0]).name}님` : `${targets.length}명`;
  return perform(() => bulk("setRole", role, targets), {
    message: `${who}의 역할을 ${label}(으)로 바꿨습니다. 다시 로그인하면 적용됩니다.`,
    undo: async () => {
      for (const [oldRole, cds] of previous) await bulk("setRole", oldRole, cds);
    },
  });
}

async function onInlineRole(event, user) {
  const role = event.target.value;
  const changed = await changeRole([user.userCd], role);
  if (!changed) event.target.value = user.role;
}

function setEnabled(userCds, enabled) {
  const targets = userCds.filter((userCd) => userByCd.value.get(userCd)?.enabled !== enabled);
  if (!targets.length) {
    toast(enabled ? "이미 모두 사용 중입니다." : "이미 모두 중지되어 있습니다.", "info");
    return;
  }
  perform(() => bulk(enabled ? "enable" : "disable", null, targets), {
    message: enabled ? `${targets.length}명을 다시 사용하도록 했습니다.` : `${targets.length}명을 사용 중지했습니다. 즉시 로그아웃됩니다.`,
    undo: () => bulk(enabled ? "disable" : "enable", null, targets),
  });
}

function unlock(userCds) {
  const targets = userCds.filter((userCd) => userByCd.value.get(userCd)?.lockCount > 0);
  if (!targets.length) {
    toast("잠긴 사용자가 없습니다.", "info");
    return;
  }
  perform(() => bulk("unlock", null, targets), { message: `${targets.length}명의 로그인 잠금을 해제했습니다.` });
}

async function forceLogout(userCds) {
  const targets = userCds.filter((userCd) => userByCd.value.get(userCd)?.activeSessions && userCd !== props.authUser.userCd);
  if (!targets.length) {
    toast("로그인 중인 다른 사용자가 없습니다.", "info");
    return;
  }
  const ok = await confirm({
    title: `${targets.length}명을 강제 로그아웃할까요?`,
    message: "모든 기기에서 즉시 로그아웃되며, 다시 로그인하면 사용할 수 있습니다.",
    confirmLabel: "로그아웃",
  });
  if (ok) perform(() => bulk("logout", null, targets), { message: `${targets.length}명을 로그아웃했습니다.` });
}

function addToGroups(userCds, groupCds) {
  const plan = groupCds.map((groupCd) => ({
    groupCd,
    added: userCds.filter((userCd) => !userByCd.value.get(userCd)?.groupCds.includes(groupCd)),
  })).filter((step) => step.added.length);
  if (!plan.length) {
    toast("이미 모두 해당 그룹의 구성원입니다.", "info");
    return Promise.resolve(false);
  }
  const groupLabel = plan.length === 1 ? `‘${groupNames.value.get(plan[0].groupCd)}’` : `${plan.length}개 그룹`;
  const count = new Set(plan.flatMap((step) => step.added)).size;
  return perform(async () => {
    for (const step of plan) await bulk("addToGroup", step.groupCd, step.added);
  }, {
    message: `${count}명을 ${groupLabel}에 추가했습니다.`,
    undo: async () => {
      for (const step of plan) await bulk("removeFromGroup", step.groupCd, step.added);
    },
  });
}

function removeFromGroups(userCds, groupCds) {
  const plan = groupCds.map((groupCd) => ({
    groupCd,
    removed: userCds.filter((userCd) => userByCd.value.get(userCd)?.groupCds.includes(groupCd)),
  })).filter((step) => step.removed.length);
  if (!plan.length) {
    toast("선택한 사용자가 해당 그룹에 없습니다.", "info");
    return;
  }
  const groupLabel = plan.length === 1 ? `‘${groupNames.value.get(plan[0].groupCd)}’` : `${plan.length}개 그룹`;
  const count = new Set(plan.flatMap((step) => step.removed)).size;
  perform(async () => {
    for (const step of plan) await bulk("removeFromGroup", step.groupCd, step.removed);
  }, {
    message: `${count}명을 ${groupLabel}에서 제외했습니다.`,
    undo: async () => {
      for (const step of plan) await bulk("addToGroup", step.groupCd, step.removed);
    },
  });
}

async function deleteUsers(userCds) {
  const list = userCds.map((userCd) => userByCd.value.get(userCd)).filter(Boolean);
  const names = list.slice(0, 3).map((user) => user.name).join(", ") + (list.length > 3 ? ` 외 ${list.length - 3}명` : "");
  const answer = await confirm({
    title: `${list.length}명을 영구 삭제할까요?`,
    message: `${names}. 계정·그룹 소속·양식 열람 권한이 삭제되며 되돌릴 수 없습니다. 로그인만 막으려면 ‘사용 중지’를 권장합니다.`,
    confirmLabel: `${list.length}명 삭제`,
    tone: "danger",
    altLabel: "사용 중지로 대신하기",
  });
  if (answer === "alt") {
    setEnabled(userCds, false);
    return;
  }
  if (!answer) return;
  const ok = await perform(() => bulk("delete", null, userCds), { message: `${list.length}명을 삭제했습니다.` });
  if (ok) clearSelection();
}

function exportCsv(list) {
  const rows = [
    ["아이디", "이름", "이메일", "전화", "역할", "상태", "그룹", "최근 로그인", "등록일"],
    ...list.map((user) => [
      user.userId,
      user.name,
      user.email,
      user.tel,
      ROLE_LABELS[user.role],
      STATUS_LABELS[userStatus(user)],
      user.groupCds.map((cd) => groupByCd.value.get(cd)?.path.join(" › ") ?? "").join(";"),
      user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "",
      user.createdAt ? String(user.createdAt).slice(0, 10) : "",
    ]),
  ];
  downloadTextFile(`사용자목록_${todayStamp()}.csv`, toCsv(rows));
  toast(`${list.length}명을 CSV로 내보냈습니다.`, "info");
}

// ---------- 메뉴 & 피커 ----------

const menu = ref("");
const picker = ref(null);
const importOpen = ref(false);

function toggleMenu(name) {
  menu.value = menu.value === name ? "" : name;
}

function closeMenus(event) {
  if (!event.target.closest?.(".uga-menu-wrap")) menu.value = "";
  closePanelOnOutsideClick(event);
}

// 상세 패널 바깥(목록 빈 곳, 사이드바, 툴바 등)을 누르면 패널을 접습니다.
// 다른 사용자 행이나 패널을 여는 버튼은 패널을 바꿔 열어야 하므로 제외합니다.
function closePanelOnOutsideClick(event) {
  if (!panel.value || confirmState.value || picker.value || importOpen.value) return;
  if (event.button !== 0) return;
  const target = event.target;
  if (!rootEl.value?.contains(target)) return;
  if (target.closest?.(".uga-panel, .uga-table tbody tr, [data-keep-panel]")) return;
  closePanel();
}

function groupPickerItems(exclude = new Set()) {
  return groupTree.value
    .filter((group) => !exclude.has(group.groupCd))
    .map((group) => ({
      id: group.groupCd,
      label: group.name,
      sub: group.path.length > 1 ? group.path.slice(0, -1).join(" › ") : `${memberCount(group)}명`,
      depth: group.depth,
      hue: avatarHue(group.groupCd),
    }));
}

function openAddToGroupPicker() {
  menu.value = "";
  const userCds = [...selection.value];
  picker.value = {
    title: "그룹에 추가",
    description: `선택한 ${userCds.length}명을 추가할 그룹을 고르세요. 없는 그룹은 이름을 입력해 바로 만들 수 있습니다.`,
    items: groupPickerItems(),
    confirmLabel: "그룹에 추가",
    createLabel: "그룹을 만들고 추가",
    onConfirm: async (groupCds) => {
      picker.value = null;
      await addToGroups(userCds, groupCds);
    },
    onCreate: async (name) => {
      picker.value = null;
      await perform(() => createAdminGroup({ name, userCds }), { message: `‘${name}’ 그룹을 만들고 ${userCds.length}명을 추가했습니다.` });
    },
  };
}

function openRemoveFromGroupPicker() {
  menu.value = "";
  const userCds = [...selection.value];
  const present = new Set(selectedUsers.value.flatMap((user) => user.groupCds));
  picker.value = {
    title: "그룹에서 제외",
    description: `선택한 ${userCds.length}명을 제외할 그룹을 고르세요.`,
    items: groupPickerItems().filter((item) => present.has(item.id)),
    confirmLabel: "제외",
    emptyText: "선택한 사용자가 속한 그룹이 없습니다.",
    onConfirm: (groupCds) => {
      picker.value = null;
      removeFromGroups(userCds, groupCds);
    },
  };
}

function openMemberPicker() {
  const group = selectedGroup.value;
  if (!group) return;
  const members = new Set(group.users.map((user) => user.userCd));
  picker.value = {
    title: `‘${group.name}’에 구성원 추가`,
    description: "추가할 사용자를 고르세요. 여러 명을 한 번에 선택할 수 있습니다.",
    avatar: true,
    items: sortUsers(users.value.filter((user) => !members.has(user.userCd))).map((user) => ({
      id: user.userCd,
      label: user.name,
      sub: [user.userId, ROLE_LABELS[user.role], ...user.groupCds.map((cd) => groupNames.value.get(cd))].filter(Boolean).join(" · "),
      initials: initials(user.name),
      hue: avatarHue(user.userCd),
      hint: userStatus(user) === "active" ? "" : STATUS_LABELS[userStatus(user)],
    })),
    confirmLabel: "추가",
    emptyText: "모든 사용자가 이미 이 그룹의 구성원입니다.",
    onConfirm: async (userCds) => {
      picker.value = null;
      await addToGroups(userCds, [group.groupCd]);
    },
  };
}

// ---------- 드래그 & 드롭 ----------

const drag = ref(null); // { type: 'users', userCds } | { type: 'group', groupCd }
const dropTarget = ref("");
const dragGhost = ref(null);

function onUserDragStart(event, user) {
  const userCds = selection.value.has(user.userCd) ? [...selection.value] : [user.userCd];
  drag.value = { type: "users", userCds };
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("text/plain", userCds.map((cd) => userByCd.value.get(cd)?.userId).join("\n"));
  if (dragGhost.value) {
    dragGhost.value.textContent = userCds.length === 1 ? `👤 ${user.name}` : `👥 ${userCds.length}명`;
    event.dataTransfer.setDragImage(dragGhost.value, 14, 14);
  }
}

function onGroupDragStart(event, group) {
  drag.value = { type: "group", groupCd: group.groupCd };
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", group.name);
}

function canDrop(targetCd) {
  const payload = drag.value;
  if (!payload) return false;
  if (payload.type === "users") return targetCd !== "__root__" && !targetCd.startsWith("__");
  if (targetCd === "__root__") return Boolean(parentMap.value.get(payload.groupCd));
  if (targetCd.startsWith("__")) return false;
  if (descendantGroupCds(groups.value, payload.groupCd).has(targetCd)) return false;
  return parentMap.value.get(payload.groupCd) !== targetCd;
}

function onDragOver(event, targetCd) {
  if (!canDrop(targetCd)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = drag.value.type === "users" ? "copy" : "move";
  dropTarget.value = targetCd;
}

function onDragLeave(targetCd) {
  if (dropTarget.value === targetCd) dropTarget.value = "";
}

async function onDrop(event, targetCd) {
  event.preventDefault();
  const payload = drag.value;
  const allowed = canDrop(targetCd);
  dropTarget.value = "";
  drag.value = null;
  if (!payload || !allowed) return;
  if (payload.type === "users") {
    await addToGroups(payload.userCds, [targetCd]);
    return;
  }
  const group = groupByCd.value.get(payload.groupCd);
  const previousParent = parentMap.value.get(payload.groupCd) ?? null;
  const parentGroupCd = targetCd === "__root__" ? null : targetCd;
  await perform(() => updateAdminGroup(payload.groupCd, { parentGroupCd }), {
    message: parentGroupCd
      ? `‘${group.name}’을(를) ‘${groupNames.value.get(parentGroupCd)}’ 아래로 옮겼습니다.`
      : `‘${group.name}’을(를) 최상위로 옮겼습니다.`,
    undo: () => updateAdminGroup(payload.groupCd, { parentGroupCd: previousParent }),
  });
  if (parentGroupCd) collapsed.value.delete(parentGroupCd);
}

function onDragEnd() {
  drag.value = null;
  dropTarget.value = "";
}

// ---------- 단축키 ----------

function isTyping(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
}

function onKeydown(event) {
  if (confirmState.value) {
    if (event.key === "Escape") {
      event.preventDefault();
      settleConfirm(false);
    }
    return;
  }
  if (picker.value || importOpen.value) return;
  if (props.embedded && !rootEl.value?.contains(document.activeElement) && document.activeElement !== document.body) return;
  const typing = isTyping(event.target);
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
  if (event.key === "/" && !typing && plain) {
    event.preventDefault();
    searchInput.value?.focus();
    searchInput.value?.select();
  } else if (["n", "N", "ㅜ"].includes(event.key) && !typing && plain) {
    event.preventDefault();
    openNewUser();
  } else if (["g", "G", "ㅎ"].includes(event.key) && !typing && plain) {
    event.preventDefault();
    openNewGroup({ parentGroupCd: selectedGroup.value?.groupCd ?? "" });
  } else if (event.key === "Escape") {
    if (menu.value) {
      menu.value = "";
    } else if (event.target === searchInput.value && query.value) {
      query.value = "";
    } else if (panel.value) {
      event.preventDefault();
      if (props.embedded) event.stopPropagation();
      closePanel();
    } else if (selection.value.size) {
      clearSelection();
    } else if (typing) {
      event.target.blur();
    }
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && !typing) {
    event.preventDefault();
    filteredUsers.value.forEach((user) => selection.value.add(user.userCd));
  }
}

const rootEl = ref(null);

onMounted(() => {
  reload();
  window.addEventListener("keydown", onKeydown);
  document.addEventListener("mousedown", closeMenus);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  document.removeEventListener("mousedown", closeMenus);
});

// ---------- 표시 ----------

const title = computed(() => {
  if (selectedGroupCd.value === "__none__") return "그룹 미지정";
  return selectedGroup.value?.name ?? "전체 사용자";
});

const subtitle = computed(() => {
  if (selectedGroupCd.value === "__none__") return "어느 그룹에도 속하지 않은 사용자입니다. 끌어서 그룹에 넣어 보세요.";
  if (selectedGroup.value) return selectedGroup.value.description || "설명이 없습니다.";
  return "계정을 추가하고 역할과 그룹을 한곳에서 관리합니다.";
});

const statusChips = computed(() => [
  { value: "", label: "전체", count: scopeStats.value.total },
  { value: "online", label: "로그인 중", count: scopeStats.value.online, tone: "online" },
  { value: "locked", label: "잠김", count: scopeStats.value.locked, tone: "locked" },
  { value: "disabled", label: "중지", count: scopeStats.value.disabled, tone: "disabled" },
]);

function visibleGroupChips(user) {
  const sorted = [...user.groupCds].sort((a, b) => {
    if (a === selectedGroupCd.value) return -1;
    if (b === selectedGroupCd.value) return 1;
    return (groupNames.value.get(a) ?? "").localeCompare(groupNames.value.get(b) ?? "", "ko");
  });
  return { shown: sorted.slice(0, 2), rest: sorted.slice(2) };
}
</script>

<template>
  <div
    ref="rootEl"
    class="uga"
    :class="{ 'uga-embedded': embedded, 'uga-has-panel': panel, 'uga-dragging': drag }"
  >
    <div v-if="loading && !users.length" class="uga-state" role="status">
      <span class="uga-spinner" aria-hidden="true"></span> 사용자와 그룹을 불러오는 중...
    </div>
    <div v-else-if="loadError" class="uga-state uga-state-error" role="alert">
      <strong>목록을 불러오지 못했습니다</strong>
      <p>{{ loadError }}</p>
      <button type="button" class="uga-btn" @click="reload()">다시 시도</button>
    </div>
    <template v-else>
      <!-- 사이드바: 보기 & 그룹 트리 -->
      <aside class="uga-sidebar" aria-label="그룹">
        <nav class="uga-side-section">
          <button type="button" class="uga-nav-item" :class="{ active: selectedGroupCd === '' }" @click="selectGroup('')">
            <span class="uga-nav-icon" aria-hidden="true">◎</span>
            <span class="uga-nav-label">전체 사용자</span>
            <span class="uga-count">{{ stats.total }}</span>
          </button>
          <button type="button" class="uga-nav-item" :class="{ active: selectedGroupCd === '__none__' }" @click="selectGroup('__none__')">
            <span class="uga-nav-icon" aria-hidden="true">◌</span>
            <span class="uga-nav-label">그룹 미지정</span>
            <span class="uga-count" :class="{ 'is-attention': stats.noGroup }">{{ stats.noGroup }}</span>
          </button>
          <button
            v-if="stats.locked"
            type="button"
            class="uga-nav-item uga-nav-warn"
            :class="{ active: selectedGroupCd === '' && statusFilter === 'locked' }"
            @click="selectGroup(''); statusFilter = 'locked'"
          >
            <span class="uga-nav-icon" aria-hidden="true">⚠</span>
            <span class="uga-nav-label">잠긴 계정</span>
            <span class="uga-count is-warn">{{ stats.locked }}</span>
          </button>
        </nav>

        <div
          class="uga-side-head"
          :class="{ 'is-drop': dropTarget === '__root__' }"
          @dragover="onDragOver($event, '__root__')"
          @dragleave="onDragLeave('__root__')"
          @drop="onDrop($event, '__root__')"
        >
          <span>그룹 <em>{{ groups.length }}</em></span>
          <button type="button" class="uga-icon-btn" title="새 그룹 (G)" aria-label="새 그룹" data-keep-panel @click="openNewGroup({ parentGroupCd: selectedGroup?.groupCd ?? '' })">＋</button>
        </div>
        <label v-if="groups.length > 7" class="uga-search uga-search-sm uga-side-search">
          <span aria-hidden="true">⌕</span>
          <input v-model="groupQuery" placeholder="그룹 찾기" />
        </label>

        <div class="uga-tree" role="tree">
          <div
            v-for="group in visibleTree"
            :key="group.groupCd"
            class="uga-tree-row"
            :class="{
              active: selectedGroupCd === group.groupCd,
              'is-drop': dropTarget === group.groupCd,
              'is-dragged': drag?.type === 'group' && drag.groupCd === group.groupCd,
            }"
            :style="{ '--depth': group.depth, '--hue': avatarHue(group.groupCd) }"
            role="treeitem"
            :aria-selected="selectedGroupCd === group.groupCd"
            :aria-expanded="group.hasChildren ? !collapsed.has(group.groupCd) : undefined"
            tabindex="0"
            draggable="true"
            :title="group.description || group.path.join(' › ')"
            @click="selectGroup(group.groupCd)"
            @keydown.enter="selectGroup(group.groupCd)"
            @dblclick="openGroup(group.groupCd)"
            @dragstart="onGroupDragStart($event, group)"
            @dragend="onDragEnd"
            @dragover="onDragOver($event, group.groupCd)"
            @dragleave="onDragLeave(group.groupCd)"
            @drop="onDrop($event, group.groupCd)"
          >
            <button
              v-if="group.hasChildren"
              type="button"
              class="uga-caret"
              :class="{ collapsed: collapsed.has(group.groupCd) && !groupQuery }"
              :aria-label="collapsed.has(group.groupCd) ? '펼치기' : '접기'"
              @click.stop="toggleCollapse(group.groupCd)"
            >▾</button>
            <span v-else class="uga-caret-spacer"></span>
            <span class="uga-group-dot" aria-hidden="true"></span>
            <span class="uga-nav-label">{{ group.name }}</span>
            <span class="uga-count">{{ memberCount(group) }}</span>
          </div>
          <div v-if="!groups.length" class="uga-side-empty">
            <p>부서·팀·업무별로 그룹을 만들면 보고서 열람 권한을 한 번에 줄 수 있습니다.</p>
            <button type="button" class="uga-btn uga-btn-sm" @click="openNewGroup()">＋ 첫 그룹 만들기</button>
          </div>
          <p v-else-if="!visibleTree.length" class="uga-side-empty">일치하는 그룹이 없습니다.</p>
        </div>
        <p class="uga-side-hint">
          <span aria-hidden="true">⇅</span>
          사용자를 끌어 그룹에 놓으면 추가되고, 그룹끼리 끌어 놓으면 하위 그룹이 됩니다.
        </p>
      </aside>

      <!-- 메인: 목록 -->
      <section class="uga-main" aria-label="사용자 목록">
        <header class="uga-main-head">
          <div class="uga-title">
            <nav v-if="selectedGroup && selectedGroup.path.length > 1" class="uga-crumbs" aria-label="상위 그룹">
              <template v-for="(cd, index) in ancestorsOf(selectedGroup.groupCd).reverse()" :key="cd">
                <button type="button" class="uga-link" @click="selectGroup(cd)">{{ groupNames.get(cd) }}</button>
                <span aria-hidden="true">›</span>
              </template>
            </nav>
            <h2>
              <span v-if="selectedGroup" class="uga-group-dot uga-group-dot-lg" :style="{ '--hue': avatarHue(selectedGroup.groupCd) }" aria-hidden="true"></span>
              {{ title }}
              <span class="uga-title-count">{{ scopeStats.total }}명</span>
            </h2>
            <p>{{ subtitle }}</p>
          </div>
          <div class="uga-head-actions">
            <template v-if="selectedGroup">
              <button type="button" class="uga-btn" @click="openMemberPicker">＋ 구성원 추가</button>
              <button type="button" class="uga-btn" data-keep-panel @click="openGroup(selectedGroup.groupCd)">그룹 설정</button>
            </template>
            <div class="uga-menu-wrap">
              <button type="button" class="uga-btn" :aria-expanded="menu === 'io'" @click="toggleMenu('io')">가져오기·내보내기 ▾</button>
              <div v-if="menu === 'io'" class="uga-menu uga-menu-right" role="menu">
                <button type="button" role="menuitem" @click="menu = ''; importOpen = true">
                  <strong>⬆ 엑셀·CSV에서 가져오기</strong><small>표를 붙여넣어 여러 명을 한 번에 등록</small>
                </button>
                <button type="button" role="menuitem" :disabled="!filteredUsers.length" @click="menu = ''; exportCsv(filteredUsers)">
                  <strong>⬇ 현재 목록 내보내기</strong><small>표시된 {{ filteredUsers.length }}명을 CSV(엑셀)로 저장</small>
                </button>
              </div>
            </div>
            <button type="button" class="uga-btn uga-btn-primary" title="사용자 추가 (N)" data-keep-panel @click="openNewUser">
              ＋ 사용자 추가 <kbd>N</kbd>
            </button>
          </div>
        </header>

        <div class="uga-toolbar">
          <label class="uga-search">
            <span aria-hidden="true">⌕</span>
            <input
              ref="searchInput"
              v-model="query"
              type="search"
              placeholder="이름·아이디·이메일·전화·그룹 검색 (초성 ㅎㄱㄷ 가능)"
              aria-label="사용자 검색"
            />
            <kbd v-if="!query">/</kbd>
            <button v-else type="button" class="uga-icon-btn" aria-label="검색어 지우기" @click="query = ''">×</button>
          </label>
          <div class="uga-chips" role="radiogroup" aria-label="상태">
            <button
              v-for="chip in statusChips"
              :key="chip.value"
              type="button"
              class="uga-filter-chip"
              :class="[chip.tone, { active: statusFilter === chip.value }]"
              role="radio"
              :aria-checked="statusFilter === chip.value"
              :disabled="chip.value && !chip.count && statusFilter !== chip.value"
              @click="statusFilter = chip.value"
            >
              {{ chip.label }} <b>{{ chip.count }}</b>
            </button>
          </div>
          <select v-model="roleFilter" class="uga-select" aria-label="역할">
            <option value="">모든 역할</option>
            <option v-for="role in ROLE_OPTIONS" :key="role.value" :value="role.value">
              {{ role.label }} ({{ scopeStats.byRole[role.value] }})
            </option>
          </select>
          <label v-if="selectedGroup?.hasChildren" class="uga-toggle">
            <input v-model="includeSubgroups" type="checkbox" /> 하위 그룹 포함
          </label>
        </div>

        <!-- 일괄 작업 바 -->
        <div v-if="selection.size" class="uga-bulkbar" role="toolbar" aria-label="선택한 사용자 작업">
          <span class="uga-bulk-count"><b>{{ selection.size }}</b>명 선택</span>
          <button
            v-if="!allVisibleSelected && filteredUsers.length > visibleSelectedCount"
            type="button"
            class="uga-link"
            @click="toggleAll"
          >표시된 {{ filteredUsers.length }}명 모두 선택</button>
          <span class="uga-bulk-sep" aria-hidden="true"></span>
          <div class="uga-menu-wrap">
            <button type="button" class="uga-btn uga-btn-sm" :disabled="busy" @click="toggleMenu('role')">역할 변경 ▾</button>
            <div v-if="menu === 'role'" class="uga-menu" role="menu">
              <button
                v-for="role in ROLE_OPTIONS"
                :key="role.value"
                type="button"
                role="menuitem"
                :disabled="selectionIncludesSelf && role.value !== 'ADMIN'"
                @click="menu = ''; changeRole([...selection], role.value)"
              >
                <strong><span class="uga-role-tag" :class="`role-${role.value.toLowerCase()}`">{{ role.label }}</span></strong>
                <small>{{ role.description }}</small>
              </button>
              <p v-if="selectionIncludesSelf" class="uga-menu-note">선택에 내 계정이 있어 관리자 외 역할은 고를 수 없습니다.</p>
            </div>
          </div>
          <button type="button" class="uga-btn uga-btn-sm" :disabled="busy" @click="openAddToGroupPicker">그룹에 추가</button>
          <button
            v-if="selectedGroup"
            type="button"
            class="uga-btn uga-btn-sm"
            :disabled="busy"
            @click="removeFromGroups([...selection], [selectedGroup.groupCd])"
          >이 그룹에서 제외</button>
          <button v-else type="button" class="uga-btn uga-btn-sm" :disabled="busy" @click="openRemoveFromGroupPicker">그룹에서 제외</button>
          <button type="button" class="uga-btn uga-btn-sm" :disabled="busy" data-keep-panel @click="openNewGroup({ userCds: [...selection] })">새 그룹으로 묶기</button>
          <div class="uga-menu-wrap">
            <button type="button" class="uga-btn uga-btn-sm" :disabled="busy" @click="toggleMenu('more')">더보기 ▾</button>
            <div v-if="menu === 'more'" class="uga-menu" role="menu">
              <button type="button" role="menuitem" @click="menu = ''; setEnabled([...selection], true)"><strong>▶ 다시 사용</strong></button>
              <button type="button" role="menuitem" :disabled="selectionIncludesSelf" @click="menu = ''; setEnabled([...selection], false)">
                <strong>⏸ 사용 중지</strong><small>삭제하지 않고 로그인만 막습니다</small>
              </button>
              <button type="button" role="menuitem" @click="menu = ''; unlock([...selection])"><strong>🔓 잠금 해제</strong></button>
              <button type="button" role="menuitem" @click="menu = ''; forceLogout([...selection])"><strong>⎋ 강제 로그아웃</strong></button>
              <button type="button" role="menuitem" @click="menu = ''; exportCsv(selectedUsers)"><strong>⬇ 선택 항목 내보내기</strong></button>
              <hr />
              <button type="button" role="menuitem" class="danger" :disabled="selectionIncludesSelf" @click="menu = ''; deleteUsers([...selection])">
                <strong>🗑 삭제</strong><small v-if="selectionIncludesSelf">내 계정은 삭제할 수 없습니다</small>
              </button>
            </div>
          </div>
          <button type="button" class="uga-bulk-close" aria-label="선택 해제 (Esc)" title="선택 해제 (Esc)" @click="clearSelection">×</button>
        </div>

        <div class="uga-table-wrap">
          <table v-if="filteredUsers.length" class="uga-table">
            <thead>
              <tr>
                <th class="uga-col-check">
                  <input
                    type="checkbox"
                    :checked="allVisibleSelected"
                    :indeterminate.prop="visibleSelectedCount > 0 && !allVisibleSelected"
                    aria-label="표시된 사용자 모두 선택"
                    @change="toggleAll"
                  />
                </th>
                <th :aria-sort="ariaSort('name')"><button type="button" class="uga-sort" :class="sortKey === 'name' && sortDir" @click="setSort('name')">사용자</button></th>
                <th :aria-sort="ariaSort('role')" class="uga-col-role"><button type="button" class="uga-sort" :class="sortKey === 'role' && sortDir" @click="setSort('role')">역할</button></th>
                <th :aria-sort="ariaSort('groups')" class="uga-col-groups"><button type="button" class="uga-sort" :class="sortKey === 'groups' && sortDir" @click="setSort('groups')">그룹</button></th>
                <th :aria-sort="ariaSort('status')" class="uga-col-status"><button type="button" class="uga-sort" :class="sortKey === 'status' && sortDir" @click="setSort('status')">상태</button></th>
                <th :aria-sort="ariaSort('lastLogin')" class="uga-col-login"><button type="button" class="uga-sort" :class="sortKey === 'lastLogin' && sortDir" @click="setSort('lastLogin')">최근 로그인</button></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(user, index) in filteredUsers"
                :key="user.userCd"
                :class="{
                  'is-selected': selection.has(user.userCd),
                  'is-open': panel?.type === 'user' && panel.userCd === user.userCd,
                  'is-inactive': userStatus(user) !== 'active',
                }"
                draggable="true"
                @click="onRowClick($event, user, index)"
                @dragstart="onUserDragStart($event, user)"
                @dragend="onDragEnd"
              >
                <td class="uga-col-check">
                  <input
                    type="checkbox"
                    :checked="selection.has(user.userCd)"
                    :aria-label="`${user.name} 선택`"
                    @click="shiftPressed = $event.shiftKey"
                    @change="onCheckChange(user, index)"
                  />
                </td>
                <td>
                  <div class="uga-user-cell">
                    <span class="uga-avatar" :style="{ '--hue': avatarHue(user.userCd) }" aria-hidden="true">
                      {{ initials(user.name) }}
                      <i v-if="user.activeSessions" class="uga-online"></i>
                    </span>
                    <span class="uga-user-text">
                      <strong>{{ user.name }} <em v-if="user.userCd === authUser.userCd" class="uga-me">나</em></strong>
                      <small><span class="uga-mono">{{ user.userId }}</span><template v-if="user.email"> · {{ user.email }}</template></small>
                    </span>
                  </div>
                </td>
                <td class="uga-col-role">
                  <select
                    class="uga-role-select"
                    :class="`role-${user.role.toLowerCase()}`"
                    :value="user.role"
                    :disabled="busy || user.userCd === authUser.userCd"
                    :title="user.userCd === authUser.userCd ? '자기 계정의 역할은 다른 관리자가 변경할 수 있습니다.' : '역할 바로 변경'"
                    :aria-label="`${user.name} 역할`"
                    @change="onInlineRole($event, user)"
                  >
                    <option v-for="role in ROLE_OPTIONS" :key="role.value" :value="role.value">{{ role.label }}</option>
                  </select>
                </td>
                <td class="uga-col-groups">
                  <div class="uga-group-chips">
                    <button
                      v-for="groupCd in visibleGroupChips(user).shown"
                      :key="groupCd"
                      type="button"
                      class="uga-chip"
                      :class="{ 'is-current': groupCd === selectedGroupCd }"
                      :style="{ '--hue': avatarHue(groupCd) }"
                      :title="groupByCd.get(groupCd)?.path.join(' › ')"
                      @click="selectGroup(groupCd)"
                    >{{ groupNames.get(groupCd) }}</button>
                    <span
                      v-if="visibleGroupChips(user).rest.length"
                      class="uga-chip uga-chip-more"
                      :title="visibleGroupChips(user).rest.map((cd) => groupNames.get(cd)).join(', ')"
                    >+{{ visibleGroupChips(user).rest.length }}</span>
                    <span v-if="!user.groupCds.length" class="uga-muted">—</span>
                  </div>
                </td>
                <td class="uga-col-status">
                  <span class="uga-status" :class="userStatus(user)">{{ STATUS_LABELS[userStatus(user)] }}</span>
                  <button
                    v-if="userStatus(user) === 'locked'"
                    type="button"
                    class="uga-link uga-inline-action"
                    :disabled="busy"
                    @click="unlock([user.userCd])"
                  >해제</button>
                </td>
                <td class="uga-col-login" :title="formatDateTime(user.lastLoginAt)">
                  <span :class="{ 'uga-muted': !user.lastLoginAt }">{{ formatRelative(user.lastLoginAt) }}</span>
                </td>
              </tr>
            </tbody>
          </table>

          <div v-else-if="!users.length" class="uga-empty">
            <span class="uga-empty-art" aria-hidden="true">👥</span>
            <h3>첫 사용자를 추가해 보세요</h3>
            <p>한 명씩 추가하거나, 엑셀 명단을 붙여넣어 한 번에 등록할 수 있습니다.</p>
            <div>
              <button type="button" class="uga-btn uga-btn-primary" @click="openNewUser">＋ 사용자 추가</button>
              <button type="button" class="uga-btn" @click="importOpen = true">⬆ 엑셀로 가져오기</button>
            </div>
          </div>
          <div v-else-if="selectedGroup && !baseUsers.length && !query" class="uga-empty">
            <span class="uga-empty-art" aria-hidden="true">🗂</span>
            <h3>‘{{ selectedGroup.name }}’에 아직 구성원이 없습니다</h3>
            <p>구성원을 고르거나, ‘전체 사용자’에서 사용자를 끌어 왼쪽 그룹에 놓으세요.</p>
            <div>
              <button type="button" class="uga-btn uga-btn-primary" @click="openMemberPicker">＋ 구성원 추가</button>
              <button type="button" class="uga-btn" @click="openNewUser">새 사용자 만들기</button>
            </div>
          </div>
          <div v-else class="uga-empty">
            <span class="uga-empty-art" aria-hidden="true">🔍</span>
            <h3>조건에 맞는 사용자가 없습니다</h3>
            <p v-if="query">‘{{ query }}’ 검색 결과가 없습니다.</p>
            <div>
              <button v-if="hasFilters" type="button" class="uga-btn" @click="resetFilters">필터 초기화</button>
              <button type="button" class="uga-btn uga-btn-primary" @click="openNewUser">＋ 사용자 추가</button>
            </div>
          </div>
        </div>

        <footer class="uga-main-foot">
          <span>{{ filteredUsers.length }}명 표시<template v-if="filteredUsers.length !== users.length"> · 전체 {{ users.length }}명</template></span>
          <span class="uga-shortcuts">
            <kbd>/</kbd> 검색 <kbd>N</kbd> 사용자 <kbd>G</kbd> 그룹 <kbd>Shift</kbd>+클릭 범위 선택 <kbd>Esc</kbd> 닫기
          </span>
        </footer>
      </section>

      <!-- 상세 패널 -->
      <aside v-if="panel" class="uga-panel" aria-label="상세">
        <button
          type="button"
          class="uga-panel-handle"
          aria-label="상세 패널 접기 (Esc)"
          title="상세 패널 접기 (Esc · 바깥 영역 클릭)"
          @click="closePanel"
        >
          <span aria-hidden="true">»</span>
          <span class="uga-panel-handle-text">접기</span>
        </button>
        <UserPanel
          v-if="panel.type === 'user' && panelUser"
          ref="panelRef"
          :key="`u-${panel.userCd}`"
          :user="panelUser"
          :groups="groupTree"
          :existing-user-ids="existingUserIds"
          :self-user-cd="authUser.userCd"
          @close="closePanel"
          @changed="onPanelChanged"
          @open-group="showGroupFromPanel"
        />
        <UserPanel
          v-else-if="panel.type === 'newUser'"
          ref="panelRef"
          key="new-user"
          :user="null"
          :groups="groupTree"
          :existing-user-ids="existingUserIds"
          :default-group-cds="panel.defaultGroupCds"
          :self-user-cd="authUser.userCd"
          @close="panel = null"
          @created="onUserCreated"
          @open-group="selectGroup"
        />
        <GroupPanel
          v-else-if="panel.type === 'group' && panelGroup"
          ref="panelRef"
          :key="`g-${panel.groupCd}`"
          :group="panelGroup"
          :groups="groupTree"
          :users="users"
          @close="closePanel"
          @changed="onPanelChanged"
          @open-user="openUser"
          @open-group="openGroup"
        />
        <GroupPanel
          v-else-if="panel.type === 'newGroup'"
          ref="panelRef"
          key="new-group"
          :group="null"
          :groups="groupTree"
          :users="users"
          :default-parent-cd="panel.parentGroupCd"
          :initial-user-cds="panel.userCds"
          @close="panel = null"
          @created="onGroupCreated"
          @open-user="openUser"
        />
      </aside>
    </template>

    <AdminPicker
      v-if="picker"
      :title="picker.title"
      :description="picker.description"
      :items="picker.items"
      :confirm-label="picker.confirmLabel"
      :create-label="picker.createLabel || ''"
      :empty-text="picker.emptyText || '선택할 항목이 없습니다.'"
      :avatar="Boolean(picker.avatar)"
      @confirm="picker.onConfirm"
      @create="picker.onCreate"
      @close="picker = null"
    />

    <UserImportDialog
      v-if="importOpen"
      :groups="groups"
      :existing-user-ids="existingUserIds"
      @close="importOpen = false"
      @imported="onPanelChanged"
    />

    <Teleport to="body">
      <div v-if="confirmState" class="uga-layer uga-backdrop">
        <section class="uga-confirm" role="alertdialog" aria-modal="true" aria-labelledby="uga-confirm-title">
          <header class="popup-titlebar uga-confirm-head"><h3 id="uga-confirm-title">{{ confirmState.title }}</h3></header>
          <p>{{ confirmState.message }}</p>
          <footer>
            <button v-if="confirmState.altLabel" type="button" class="uga-btn uga-confirm-alt" @click="settleConfirm('alt')">{{ confirmState.altLabel }}</button>
            <button type="button" class="uga-btn" @click="settleConfirm(false)">취소</button>
            <button
              ref="confirmButton"
              type="button"
              class="uga-btn"
              :class="confirmState.tone === 'danger' ? 'uga-btn-danger-solid' : 'uga-btn-primary'"
              @click="settleConfirm(true)"
            >{{ confirmState.confirmLabel }}</button>
          </footer>
        </section>
      </div>

      <div class="uga-layer uga-toasts" aria-live="polite">
        <TransitionGroup name="uga-toast">
          <div v-for="item in toasts" :key="item.id" class="uga-toast" :class="item.tone" role="status">
            <span class="uga-toast-icon" aria-hidden="true">{{ item.tone === "error" ? "!" : item.tone === "info" ? "i" : "✓" }}</span>
            <span class="uga-toast-text">{{ item.message }}</span>
            <button v-if="item.undo" type="button" class="uga-toast-undo" @click="runUndo(item)">실행 취소</button>
            <button type="button" class="uga-toast-x" aria-label="닫기" @click="dismissToast(item.id)">×</button>
          </div>
        </TransitionGroup>
      </div>

      <div ref="dragGhost" class="uga-layer uga-drag-ghost" aria-hidden="true"></div>
    </Teleport>
  </div>
</template>
