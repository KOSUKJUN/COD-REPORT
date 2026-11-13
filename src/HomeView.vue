<script setup>
defineProps({
  user: { type: Object, required: true },
});
const emit = defineEmits(["select-tool", "logout"]);
</script>

<template>
  <main class="portal">
    <header class="portal-header">
      <a class="brand" href="/" aria-label="CODVILL 홈">
        <img class="brand-logo" src="/codvill-logo-dark.png" alt="CODVILL" />
      </a>
      <div class="portal-account">
        <span>{{ user.name }}</span>
        <button type="button" @click="emit('logout')">로그아웃</button>
      </div>
    </header>
    <section class="portal-content" aria-labelledby="portal-title">
      <p class="portal-eyebrow">REPORT WORKSPACE</p>
      <h1 id="portal-title">리포트 도구를 선택하세요</h1>
      <p class="portal-description">
        보고서를 작성하거나 저장된 보고서를 열어볼 수 있습니다.
      </p>
      <div class="portal-cards">
        <button v-if="['ADMIN', 'EDITOR'].includes(user.role)" class="portal-card" type="button" @click="emit('select-tool', 'editor')">
          <span class="portal-card-icon">✎</span>
          <span class="portal-card-copy">
            <strong>리포트 에디터 툴</strong>
            <span>보고서 양식을 편집하고 저장합니다.</span>
          </span>
          <span class="portal-card-arrow" aria-hidden="true">→</span>
        </button>
        <button class="portal-card portal-card-viewer" type="button" @click="emit('select-tool', 'viewer')">
          <span class="portal-card-icon">▤</span>
          <span class="portal-card-copy">
            <strong>리포트 뷰어</strong>
            <span>저장한 일일·주간·월간 보고서를 선택해 읽고 인쇄합니다.</span>
          </span>
          <span class="portal-card-arrow" aria-hidden="true">→</span>
        </button>
        <button v-if="user.role === 'ADMIN'" class="portal-card portal-card-admin" type="button" @click="emit('select-tool', 'admin')">
          <span class="portal-card-icon">👥</span>
          <span class="portal-card-copy">
            <strong>사용자·그룹 관리</strong>
            <span>계정, 역할, 그룹 구성원을 한 화면에서 관리합니다.</span>
          </span>
          <span class="portal-card-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </section>
    <footer class="portal-footer">cod-report · Report workspace</footer>
  </main>
</template>
