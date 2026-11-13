<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  setupRequired: { type: Boolean, default: false },
  user: { type: Object, default: null },
});
const emit = defineEmits(["authenticated", "select-tool", "logout", "help"]);

const userId = ref("");
const name = ref("");
const password = ref("");
const passwordConfirm = ref("");
const busy = ref(false);
const errorMessage = ref("");
const setupMode = computed(() => props.setupRequired && !props.user);

async function submit() {
  if (busy.value) return;
  errorMessage.value = "";
  if (setupMode.value && password.value !== passwordConfirm.value) {
    errorMessage.value = "비밀번호 확인이 일치하지 않습니다.";
    return;
  }
  busy.value = true;
  try {
    const response = await fetch(setupMode.value ? "/api/auth/setup" : "/api/auth/login", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: userId.value,
        name: name.value,
        password: password.value,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `로그인에 실패했습니다 (${response.status}).`);
    emit("authenticated", result.user);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="auth-page entry-page" :class="user ? 'entry-choice' : 'entry-login'">
    <div class="entry-layout">
      <Transition name="entry-background-transition">
      <div v-if="!user" class="entry-waves" aria-hidden="true">
        <svg class="entry-wave entry-wave-back" viewBox="0 0 1600 800" preserveAspectRatio="none">
          <defs>
            <linearGradient id="entry-wave-back-gradient" x1="0" y1="0" x2="1" y2="1">
              <stop stop-color="#55b5e7" stop-opacity=".02" />
              <stop offset=".5" stop-color="#4f9bdc" stop-opacity=".35" />
              <stop offset="1" stop-color="#566bd7" stop-opacity=".03" />
            </linearGradient>
          </defs>
          <path d="M0 400 C240 200 440 250 670 370 S1120 550 1600 220 V800 H0Z" fill="url(#entry-wave-back-gradient)" />
          <path d="M0 400 C240 200 440 250 670 370 S1120 550 1600 220" fill="none" stroke="#8dcffd" stroke-opacity=".23" stroke-width="2" />
        </svg>
        <svg class="entry-wave entry-wave-front" viewBox="0 0 1600 800" preserveAspectRatio="none">
          <defs>
            <linearGradient id="entry-wave-front-gradient" x1="0" y1="0" x2="1" y2="1">
              <stop stop-color="#4a8ee0" stop-opacity=".03" />
              <stop offset=".5" stop-color="#478dd0" stop-opacity=".27" />
              <stop offset="1" stop-color="#6574d5" stop-opacity=".06" />
            </linearGradient>
          </defs>
          <path d="M0 490 C290 320 470 390 720 510 S1170 610 1600 360 V800 H0Z" fill="url(#entry-wave-front-gradient)" />
          <path d="M0 490 C290 320 470 390 720 510 S1170 610 1600 360" fill="none" stroke="#a1d9ff" stroke-opacity=".18" stroke-width="2" />
        </svg>
      </div>
      </Transition>
      <div class="entry-dashboard" aria-hidden="true">
          <div class="entry-dash-sidebar">
            <img src="/codvill-logo-white.png" alt="" />
            <span class="entry-dash-nav active">▦ &nbsp; Overview</span>
            <span class="entry-dash-nav">▤ &nbsp; Reports</span>
            <span class="entry-dash-nav">◷ &nbsp; Analytics</span>
            <span class="entry-dash-nav">◇ &nbsp; Workspace</span>
            <span class="entry-dash-nav">⚙ &nbsp; Settings</span>
          </div>
          <div class="entry-dash-main">
            <div class="entry-dash-top"><span>Dashboard <small> / Overview</small></span><span>···</span></div>
            <div class="entry-dash-heading"><div><small>REPORT OVERVIEW</small><strong>Performance overview</strong></div><span>Monthly report &nbsp;⌄</span></div>
            <div class="entry-dash-metrics">
              <div><small>TOTAL PERFORMANCE</small><strong>128,450</strong><span>↗ 12.4%</span></div>
              <div><small>ACHIEVEMENT</small><strong>94.8%</strong><span>↗ 8.2%</span></div>
              <div><small>REPORTS</small><strong>24</strong><span>THIS MONTH</span></div>
            </div>
            <div class="entry-dash-grid">
              <div class="entry-dash-card entry-dash-line">
                <div class="entry-dash-card-head"><span>Performance trends<small>Monthly analysis</small></span><span>···</span></div>
                <svg viewBox="0 0 360 150" preserveAspectRatio="none">
                  <defs><linearGradient id="entry-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#4f9cff" stop-opacity=".35"/><stop offset="1" stop-color="#4f9cff" stop-opacity="0"/></linearGradient></defs>
                  <path d="M0 125 C30 120 30 88 60 95 S100 113 125 76 S160 65 185 70 S220 30 245 48 S280 60 305 25 S340 32 360 8 V150 H0Z" fill="url(#entry-chart-fill)"/>
                  <path d="M0 125 C30 120 30 88 60 95 S100 113 125 76 S160 65 185 70 S220 30 245 48 S280 60 305 25 S340 32 360 8" fill="none" stroke="#61a9ff" stroke-width="2.5"/>
                  <path d="M0 135 C30 113 40 122 65 104 S100 80 125 95 S160 102 185 72 S220 80 245 60 S280 46 305 54 S340 22 360 25" fill="none" stroke="#55d5d3" stroke-width="2"/>
                </svg>
                <div class="entry-dash-months"><span>JAN</span><span>FEB</span><span>MAR</span><span>APR</span><span>MAY</span><span>JUN</span></div>
              </div>
              <div class="entry-dash-card">
                <div class="entry-dash-card-head"><span>Report activity<small>Monthly summary</small></span><span>···</span></div>
                <div class="entry-dash-bars"><i style="height: 35%"></i><i style="height: 55%"></i><i style="height: 46%"></i><i style="height: 68%"></i><i style="height: 60%"></i><i style="height: 84%"></i><i style="height: 74%"></i><i style="height: 96%"></i></div>
                <div class="entry-dash-months"><span>JAN</span><span>MAR</span><span>MAY</span><span>JUL</span></div>
              </div>
              <div class="entry-dash-card entry-dash-summary"><span>REPORT INSIGHTS</span><strong>Make data meaningful.</strong><div><i></i><i></i><i></i></div></div>
              <div class="entry-dash-card entry-dash-summary"><span>MONTHLY GOAL</span><strong>94.8% <small>completed</small></strong><div><i></i><i></i><i></i></div></div>
            </div>
          </div>
      </div>
      <section class="entry-showcase" aria-label="COD Report 소개">
        <div class="entry-showcase-copy entry-login-copy">
          <p>COD-REPORT <span>/</span> 리포트 관리 솔루션</p>
          <h2>리포트 업무를<br /><span>한곳에서 관리합니다.</span></h2>
          <div>데이터 연결부터 보고서 작성과 조회까지,<br />업무에 필요한 리포트 기능을 제공합니다.</div>
          <ul class="entry-capabilities">
            <li>데이터 소스 연동</li>
            <li>리포트 양식 및 자동 생성 관리</li>
            <li>역할별 보고서 조회 및 사용자 관리</li>
          </ul>
        </div>
        <div class="entry-showcase-caption">REPORTING PLATFORM / CODVILL</div>
      </section>

      <section class="entry-panel">
        <div class="entry-panel-inner">
          <a class="entry-logo" href="/" aria-label="CODVILL 홈"><img src="/codvill-logo-white.png" alt="CODVILL" /></a>
          <p class="entry-product">COD-REPORT <span>|</span> Reporting Platform</p>

          <div v-if="user" key="choice" class="entry-card">
              <p class="entry-card-kicker">YOUR WORKSPACE</p>
              <div class="entry-choice-heading">
                <h1>어떤 도구를 사용하시겠어요?</h1>
                <button type="button" class="entry-help-button" @click="emit('help')"><span aria-hidden="true">?</span> 도움말</button>
              </div>
              <p class="entry-card-description">{{ user.name }}님, {{ user.role === "ADMIN" ? "관리자" : user.role === "EDITOR" ? "에디터" : "뷰어" }}로 로그인했습니다.</p>
              <div class="entry-tools">
                <button v-if="['ADMIN', 'EDITOR'].includes(user.role)" type="button" class="entry-tool" @click="emit('select-tool', 'editor')">
                  <span class="entry-tool-icon" aria-hidden="true">✎</span>
                  <span><strong>리포트 에디터</strong><small>양식과 자동 생성 설정을 관리합니다.</small></span>
                  <span class="entry-tool-arrow" aria-hidden="true">→</span>
                </button>
                <button type="button" class="entry-tool" @click="emit('select-tool', 'viewer')">
                  <span class="entry-tool-icon" aria-hidden="true">▤</span>
                  <span><strong>리포트 뷰어</strong><small>권한이 부여된 생성 보고서를 확인합니다.</small></span>
                  <span class="entry-tool-arrow" aria-hidden="true">→</span>
                </button>
                <button v-if="user.role === 'ADMIN'" type="button" class="entry-tool" @click="emit('select-tool', 'admin')">
                  <span class="entry-tool-icon" aria-hidden="true">♙</span>
                  <span><strong>사용자·그룹 관리</strong><small>사용자와 그룹 권한을 관리합니다.</small></span>
                  <span class="entry-tool-arrow" aria-hidden="true">→</span>
                </button>
              </div>
              <button type="button" class="entry-logout" @click="emit('logout')">로그아웃</button>
          </div>
          <div v-else key="login" class="entry-card">
              <p class="entry-card-kicker">{{ setupMode ? "GETTING STARTED" : "WELCOME BACK" }}</p>
              <h1>{{ setupMode ? "최초 관리자 계정을 만드세요" : "리포트 업무의 새로운 기준" }}</h1>
              <p class="entry-card-description">{{ setupMode ? "워크스페이스를 시작할 관리자 계정을 설정해 주세요." : "COD-REPORT 통합 리포팅 플랫폼에 접속하세요." }}</p>
              <form class="auth-form entry-form" @submit.prevent="submit">
                <label for="auth-user-id">아이디</label>
                <input id="auth-user-id" v-model="userId" required maxlength="200" autocomplete="username" placeholder="아이디를 입력하세요" />
                <template v-if="setupMode">
                  <label for="auth-name">이름</label>
                  <input id="auth-name" v-model="name" required maxlength="200" autocomplete="name" placeholder="이름을 입력하세요" />
                </template>
                <label for="auth-password">비밀번호</label>
                <input id="auth-password" v-model="password" type="password" required minlength="12" maxlength="256" :autocomplete="setupMode ? 'new-password' : 'current-password'" placeholder="비밀번호를 입력하세요" />
                <template v-if="setupMode">
                  <small class="entry-hint">보안을 위해 12자 이상 입력해 주세요.</small>
                  <label for="auth-password-confirm">비밀번호 확인</label>
                  <input id="auth-password-confirm" v-model="passwordConfirm" type="password" required minlength="12" maxlength="256" autocomplete="new-password" placeholder="비밀번호를 다시 입력하세요" />
                </template>
                <p v-if="errorMessage" class="entry-error" role="alert">{{ errorMessage }}</p>
                <button class="entry-submit" type="submit" :disabled="busy">
                  {{ busy ? "처리 중..." : setupMode ? "관리자 계정 생성" : "로그인" }}
                </button>
              </form>
              <p class="entry-card-note">{{ setupMode ? "이 계정으로 사용자와 리포트 설정을 관리합니다." : "안전한 리포트 워크스페이스" }}</p>
          </div>
          <p v-if="!user && !setupMode" class="entry-help">계정 정보가 필요하신가요? <strong>관리자에게 문의해 주세요.</strong></p>
          <p class="entry-copyright">© CODVILL. All rights reserved.</p>
        </div>
      </section>
    </div>
  </main>
</template>
