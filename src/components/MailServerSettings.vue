<script setup>
import { onMounted, ref } from "vue";

const form = ref({ host: "", port: 587, security: "starttls", username: "", password: "", sender: "" });
const hasPassword = ref(false);
const ready = ref(false);
const busy = ref(false);
const message = ref("");
const failed = ref(false);

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "메일 서버 요청에 실패했습니다.");
  return data;
}
async function load() {
  busy.value = true;
  try {
    const { server } = await request("/api/mail/server");
    if (server) {
      form.value = { ...server, password: "" };
      hasPassword.value = server.hasPassword;
    }
    ready.value = true;
    message.value = "";
  } catch (error) {
    failed.value = true;
    message.value = error.message;
  } finally { busy.value = false; }
}
async function save() {
  busy.value = true;
  try {
    const { server } = await request("/api/mail/server", { method: "PUT", body: JSON.stringify(form.value) });
    form.value = { ...server, password: "" };
    hasPassword.value = server.hasPassword;
    failed.value = false;
    message.value = "메일 서버 설정을 저장했습니다.";
  } catch (error) { failed.value = true; message.value = error.message; }
  finally { busy.value = false; }
}
async function testConnection() {
  busy.value = true;
  try {
    await request("/api/mail/server/test", { method: "POST" });
    failed.value = false;
    message.value = "저장된 메일 서버에 연결했습니다.";
  } catch (error) { failed.value = true; message.value = error.message; }
  finally { busy.value = false; }
}
onMounted(load);
</script>

<template>
  <div class="ai-key-settings">
    <h3>메일 서버 설정</h3>
    <p>양식별 메일 전송에 사용할 SMTP 서버를 설정합니다. 서버 인증 비밀번호는 암호화해 저장하며 다시 표시하지 않습니다.</p>
    <p v-if="message" :class="['ai-key-message', { error: failed }]" role="status">{{ message }}</p>
    <button v-if="!ready" type="button" class="dsm-button" :disabled="busy" @click="load">설정 불러오기</button>
    <form v-else class="ai-key-card" @submit.prevent="save">
      <label>SMTP 서버 주소 <input v-model="form.host" required maxlength="253" placeholder="smtp.example.com" /></label>
      <label>포트 <input v-model.number="form.port" type="number" min="1" max="65535" required /></label>
      <label>암호화 방식
        <select v-model="form.security"><option value="starttls">STARTTLS</option><option value="tls">TLS</option></select>
      </label>
      <label>보내는 사람 이메일 <input v-model="form.sender" type="email" required maxlength="254" /></label>
      <label>인증 사용자 이름 <input v-model="form.username" maxlength="255" autocomplete="off" /></label>
      <label>인증 비밀번호 <input v-model="form.password" type="password" maxlength="1000" autocomplete="new-password" :placeholder="hasPassword ? '변경할 때만 입력' : '인증을 사용하는 경우 입력'" /></label>
      <div class="ai-key-actions">
        <button class="dsm-button dsm-button-primary" type="submit" :disabled="busy">저장</button>
        <button class="dsm-button" type="button" :disabled="busy" @click="testConnection">저장된 설정 연결 확인</button>
      </div>
    </form>
  </div>
</template>
