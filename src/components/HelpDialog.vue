<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { helpCategories, searchHelp } from "../help-content.js";
import "./help.css";

const emit = defineEmits(["close"]);
const query = ref("");
const selectedId = ref("workspace");
const expanded = ref(Object.fromEntries(helpCategories.flatMap((category) =>
  [category, ...category.groups].map((node) => [node.id, true]))));
const searchInput = ref(null);
const dialog = ref(null);
const content = ref(null);
const results = computed(() => searchHelp(helpCategories, query.value));
const allArticles = computed(() => results.value.flatMap((category) =>
  category.groups.flatMap((group) => group.articles.map((article) => ({
    ...article, category: category.title, categoryId: category.id, group: group.title, groupId: group.id,
  })))));
const article = computed(() => allArticles.value.find((item) => item.id === selectedId.value));
const index = computed(() => allArticles.value.findIndex((item) => item.id === selectedId.value));

watch(results, () => {
  if (!allArticles.value.some((item) => item.id === selectedId.value)) {
    selectedId.value = allArticles.value[0]?.id ?? "";
    if (content.value) content.value.scrollTop = 0;
  }
  if (!query.value.trim() && article.value) {
    expanded.value = { ...expanded.value, [article.value.categoryId]: true, [article.value.groupId]: true };
  }
});

function selectArticle(id) {
  selectedId.value = id;
  const selected = allArticles.value.find((item) => item.id === id);
  if (selected) expanded.value = { ...expanded.value, [selected.categoryId]: true, [selected.groupId]: true };
  if (content.value) content.value.scrollTop = 0;
}

function toggleNode(id) {
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] };
}

function onKeydown(event) {
  event.stopPropagation();
  if (event.key !== "Tab") return;
  const elements = [...dialog.value.querySelectorAll('button:not(:disabled), input:not(:disabled), [href]')]
    .filter((element) => element.getClientRects().length > 0);
  if (!elements.length) return;
  if (event.shiftKey && document.activeElement === elements[0]) {
    event.preventDefault();
    elements[elements.length - 1].focus();
  } else if (!event.shiftKey && document.activeElement === elements[elements.length - 1]) {
    event.preventDefault();
    elements[0].focus();
  }
}

onMounted(() => nextTick(() => searchInput.value?.focus()));
</script>

<template>
  <Teleport to="body">
    <div class="help-backdrop" @keydown="onKeydown">
      <section ref="dialog" class="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header class="help-header">
          <div class="help-brand">
            <span class="help-brand-icon" aria-hidden="true">?</span>
            <div><p>COD-REPORT GUIDE</p><h2 id="help-title">사용 설명서</h2></div>
          </div>
          <button class="help-close" type="button" aria-label="도움말 닫기" @click="emit('close')">×</button>
        </header>
        <div class="help-body">
          <aside class="help-sidebar">
            <label class="help-search">
              <span>기능 검색</span>
              <input ref="searchInput" v-model="query" type="search" placeholder="예: AI, 표, 자동 생성" />
            </label>
            <div class="help-tree-heading"><strong>목차</strong><span v-if="query.trim()">{{ allArticles.length }}개 결과</span></div>
            <nav class="help-tree" aria-label="사용 설명서 목차">
              <section v-for="category in results" :key="category.id">
                <button class="help-category" type="button" :aria-expanded="Boolean(query.trim()) || expanded[category.id]" :disabled="Boolean(query.trim())" @click="toggleNode(category.id)">
                  <span>{{ category.title }}</span><span aria-hidden="true">{{ query.trim() || expanded[category.id] ? '−' : '+' }}</span>
                </button>
                <ul v-if="query.trim() || expanded[category.id]" class="help-groups">
                  <li v-for="group in category.groups" :key="group.id">
                    <button class="help-group" type="button" :aria-expanded="Boolean(query.trim()) || expanded[group.id]" :disabled="Boolean(query.trim())" @click="toggleNode(group.id)">
                      <span>{{ group.title }}</span><span aria-hidden="true">{{ query.trim() || expanded[group.id] ? '−' : '+' }}</span>
                    </button>
                    <ul v-if="query.trim() || expanded[group.id]" class="help-articles">
                      <li v-for="item in group.articles" :key="item.id">
                        <button type="button" :class="{ active: selectedId === item.id }" :aria-current="selectedId === item.id ? 'page' : undefined" @click="selectArticle(item.id)">{{ item.title }}</button>
                      </li>
                    </ul>
                  </li>
                </ul>
              </section>
              <p v-if="!results.length" class="help-no-results">검색 결과가 없습니다. 다른 검색어를 입력해 주세요.</p>
            </nav>
          </aside>
          <main ref="content" class="help-content">
            <article v-if="article" :key="article.id" class="help-article">
              <p class="help-breadcrumb">사용 설명서 <span>›</span> {{ article.category }} <span>›</span> {{ article.group }} <span>›</span> {{ article.title }}</p>
              <h1>{{ article.title }}</h1>
              <p class="help-intro">{{ article.intro }}</p>
              <figure>
                <img :src="`/help/${article.image}`" :alt="article.caption" />
                <figcaption>{{ article.caption }} · 화면은 권한 및 설정에 따라 다를 수 있습니다.</figcaption>
                <a class="help-image-link" :href="`/help/${article.image}`" target="_blank" rel="noopener noreferrer" :aria-label="`${article.caption} 이미지 원본 열기 (새 창)`">이미지 크게 보기 ↗</a>
              </figure>
              <h2>사용 방법</h2>
              <ol class="help-steps"><li v-for="step in article.steps" :key="step">{{ step }}</li></ol>
              <figure v-for="figure in article.figures ?? []" :key="figure.image" class="help-detail-figure">
                <img :src="`/help/${figure.image}`" :alt="figure.caption" loading="lazy" />
                <figcaption>{{ figure.caption }} · 예시 화면</figcaption>
                <a class="help-image-link" :href="`/help/${figure.image}`" target="_blank" rel="noopener noreferrer" :aria-label="`${figure.caption} 이미지 원본 열기 (새 창)`">이미지 크게 보기 ↗</a>
              </figure>
              <div v-if="article.note" class="help-note"><strong>알아두세요</strong><p>{{ article.note }}</p></div>
              <footer class="help-pagination">
                <button v-if="index > 0" type="button" @click="selectArticle(allArticles[index - 1].id)">← {{ allArticles[index - 1].title }}</button>
                <button v-if="index < allArticles.length - 1" type="button" @click="selectArticle(allArticles[index + 1].id)">{{ allArticles[index + 1].title }} →</button>
              </footer>
            </article>
            <div v-else class="help-empty"><strong>찾는 기능이 없나요?</strong><p>검색어를 바꾸거나 검색을 지워 목차를 확인해 주세요.</p><button type="button" @click="query = ''; searchInput?.focus()">검색 지우기</button></div>
          </main>
        </div>
      </section>
    </div>
  </Teleport>
</template>
