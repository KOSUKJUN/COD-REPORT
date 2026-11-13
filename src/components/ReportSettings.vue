<script setup>
import { ref } from "vue";
import DatasourceManager from "./DatasourceManager.vue";
import AiKeyManager from "./AiKeyManager.vue";
import AiServerSettings from "./AiServerSettings.vue";
import MailServerSettings from "./MailServerSettings.vue";

defineProps({
  authUser: { type: Object, required: true },
});
const emit = defineEmits(["close", "changed"]);
const tab = ref("datasources");
</script>

<template>
  <div class="modal-backdrop">
    <section class="editor-modal report-settings" role="dialog" aria-modal="true" aria-labelledby="report-settings-title">
      <header class="report-settings-header popup-titlebar">
        <div>
          <p>ADMINISTRATION</p>
          <h2 id="report-settings-title">리포트 설정</h2>
        </div>
        <button class="modal-close-button" type="button" aria-label="리포트 설정 닫기" title="리포트 설정 닫기" @click="emit('close')">×</button>
      </header>
      <nav class="report-settings-tabs" aria-label="리포트 설정 항목">
        <button :class="{ active: tab === 'datasources' }" type="button" @click="tab = 'datasources'">접속정보</button>
        <button :class="{ active: tab === 'local-ai' }" type="button" @click="tab = 'local-ai'">사내 AI</button>
        <button :class="{ active: tab === 'ai' }" type="button" @click="tab = 'ai'">AI API 키</button>
        <button :class="{ active: tab === 'mail' }" type="button" @click="tab = 'mail'">메일 서버</button>
      </nav>
      <div v-if="tab === 'datasources'" class="report-settings-pane">
        <DatasourceManager embedded @close="emit('close')" @changed="emit('changed', $event)" />
      </div>
      <div v-else-if="tab === 'local-ai'" class="report-settings-pane">
        <AiServerSettings />
      </div>
      <div v-else-if="tab === 'ai'" class="report-settings-pane">
        <AiKeyManager />
      </div>
      <div v-else class="report-settings-pane">
        <MailServerSettings />
      </div>
      <footer v-if="tab === 'datasources'" class="report-settings-footer">
        <span>양식 결과 열람 권한은 보고서 양식 관리 › 결과 권한에서 그룹·사용자 단위로 지정합니다.</span>
        <button type="button" @click="emit('close')">설정 닫기</button>
      </footer>
    </section>
  </div>
</template>
