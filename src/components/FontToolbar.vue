<script setup>
import { onMounted, onUnmounted, ref, watch } from "vue";
import {
  CASE_MODES,
  FONT_FAMILIES,
  FONT_SIZES,
  HIGHLIGHT_COLORS,
  STANDARD_COLORS,
  TEXT_EFFECTS,
  THEME_COLORS,
  UNDERLINE_STYLES,
  clampFontSize,
  getFontLabel,
  getFontStack,
} from "../text-style.js";

const props = defineProps({
  styleState: {
    type: Object,
    default: () => ({}),
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  targetLabel: {
    type: String,
    default: "",
  },
});

const emit = defineEmits([
  "apply",
  "toggle",
  "font-size",
  "grow",
  "shrink",
  "change-case",
  "clear",
  "align",
]);

const ALIGN_OPTIONS = [
  { value: "left", label: "왼쪽 맞춤", lines: ["M2 3h12", "M2 6.5h8", "M2 10h12", "M2 13.5h8"] },
  { value: "center", label: "가운데 맞춤", lines: ["M2 3h12", "M4 6.5h8", "M2 10h12", "M4 13.5h8"] },
  { value: "right", label: "오른쪽 맞춤", lines: ["M2 3h12", "M6 6.5h8", "M2 10h12", "M6 13.5h8"] },
  { value: "justify", label: "양쪽 맞춤", lines: ["M2 3h12", "M2 6.5h12", "M2 10h12", "M2 13.5h12"] },
];

const root = ref(null);
const openMenu = ref("");
const sizeText = ref("");
const lastHighlight = ref("#ffff00");
const lastColor = ref("#ff0000");

watch(
  () => props.styleState.fontSize,
  (value) => {
    sizeText.value = value ? String(value) : "";
  },
  { immediate: true },
);

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) openMenu.value = "";
  },
);

function toggleMenu(name) {
  if (props.disabled) return;
  openMenu.value = openMenu.value === name ? "" : name;
}

function closeMenu() {
  openMenu.value = "";
}

function apply(patch) {
  emit("apply", patch);
  closeMenu();
}

function commitSize() {
  const size = clampFontSize(sizeText.value);
  if (size === null) {
    sizeText.value = props.styleState.fontSize ? String(props.styleState.fontSize) : "";
    return;
  }
  sizeText.value = String(size);
  if (size !== Number(props.styleState.fontSize)) emit("font-size", size);
}

function chooseSize(size) {
  sizeText.value = String(size);
  emit("font-size", size);
  closeMenu();
}

function chooseHighlight(color) {
  if (color) lastHighlight.value = color;
  apply({ highlight: color });
}

function chooseColor(color) {
  if (color) lastColor.value = color;
  apply({ color });
}

function chooseUnderlineStyle(style) {
  apply({ underline: true, underlineStyle: style === "solid" ? "" : style });
}

function chooseUnderlineColor(color) {
  apply({ underline: true, underlineColor: color });
}

function handleDocumentPointerDown(event) {
  if (openMenu.value && root.value && !root.value.contains(event.target)) {
    closeMenu();
  }
}

function handleKeydown(event) {
  if (event.key === "Escape" && openMenu.value) {
    event.stopPropagation();
    closeMenu();
  }
}

onMounted(() => document.addEventListener("pointerdown", handleDocumentPointerDown));
onUnmounted(() => document.removeEventListener("pointerdown", handleDocumentPointerDown));
</script>

<template>
  <div
    ref="root"
    class="font-ribbon"
    :class="{ 'font-ribbon-disabled': disabled }"
    role="toolbar"
    aria-label="글꼴 서식"
    @keydown="handleKeydown"
  >
    <span class="fr-group-label">글꼴</span>

    <div class="fr-group">
      <!-- 글꼴 -->
      <div class="fr-menu-anchor">
        <button
          class="fr-select fr-font-select"
          type="button"
          :disabled="disabled"
          :aria-expanded="openMenu === 'font'"
          aria-haspopup="listbox"
          title="글꼴"
          :style="{ fontFamily: getFontStack(styleState.fontFamily) }"
          @click="toggleMenu('font')"
        >
          <span>{{ getFontLabel(styleState.fontFamily) }}</span>
          <i class="fr-caret" aria-hidden="true"></i>
        </button>
        <div v-if="openMenu === 'font'" class="fr-popover fr-font-list" role="listbox" aria-label="글꼴">
          <button
            type="button"
            role="option"
            class="fr-list-item"
            :class="{ 'fr-list-item-active': !styleState.fontFamily }"
            :aria-selected="!styleState.fontFamily"
            @click="apply({ fontFamily: '' })"
          >기본 글꼴 <small>보고서 기본값</small></button>
          <div class="fr-list-divider"></div>
          <button
            v-for="font in FONT_FAMILIES"
            :key="font.value"
            type="button"
            role="option"
            class="fr-list-item"
            :class="{ 'fr-list-item-active': styleState.fontFamily === font.value }"
            :aria-selected="styleState.fontFamily === font.value"
            :style="{ fontFamily: font.stack }"
            @click="apply({ fontFamily: font.value })"
          >{{ font.label }}</button>
        </div>
      </div>

      <!-- 글꼴 크기 -->
      <div class="fr-menu-anchor fr-size">
        <input
          v-model="sizeText"
          class="fr-size-input"
          type="text"
          inputmode="decimal"
          :disabled="disabled"
          aria-label="글꼴 크기"
          title="글꼴 크기 (px)"
          @keydown.enter.prevent="commitSize(); $event.target.blur()"
          @blur="commitSize"
        />
        <button
          class="fr-size-toggle"
          type="button"
          :disabled="disabled"
          aria-label="글꼴 크기 목록"
          :aria-expanded="openMenu === 'size'"
          @click="toggleMenu('size')"
        ><i class="fr-caret" aria-hidden="true"></i></button>
        <div v-if="openMenu === 'size'" class="fr-popover fr-size-list" role="listbox" aria-label="글꼴 크기">
          <button
            v-for="size in FONT_SIZES"
            :key="size"
            type="button"
            role="option"
            class="fr-list-item"
            :class="{ 'fr-list-item-active': Number(styleState.fontSize) === size }"
            :aria-selected="Number(styleState.fontSize) === size"
            @click="chooseSize(size)"
          >{{ size }}</button>
        </div>
      </div>

      <button class="fr-btn" type="button" :disabled="disabled" title="글꼴 크기 크게 (Ctrl+Shift+>)" aria-label="글꼴 크기 크게" @click="emit('grow')">
        <span class="fr-glyph">가<sup>▲</sup></span>
      </button>
      <button class="fr-btn" type="button" :disabled="disabled" title="글꼴 크기 작게 (Ctrl+Shift+<)" aria-label="글꼴 크기 작게" @click="emit('shrink')">
        <span class="fr-glyph fr-glyph-sm">가<sup>▼</sup></span>
      </button>

      <span class="fr-sep" aria-hidden="true"></span>

      <!-- 대/소문자 바꾸기 -->
      <div class="fr-menu-anchor">
        <button
          class="fr-btn fr-btn-menu"
          type="button"
          :disabled="disabled"
          title="대/소문자 바꾸기 (Shift+F3)"
          aria-label="대/소문자 바꾸기"
          :aria-expanded="openMenu === 'case'"
          @click="toggleMenu('case')"
        ><span class="fr-glyph">Aa</span><i class="fr-caret" aria-hidden="true"></i></button>
        <div v-if="openMenu === 'case'" class="fr-popover fr-menu" role="menu">
          <button
            v-for="mode in CASE_MODES"
            :key="mode.value"
            type="button"
            role="menuitem"
            class="fr-list-item"
            @click="emit('change-case', mode.value); closeMenu()"
          >{{ mode.label }}</button>
        </div>
      </div>

      <button class="fr-btn" type="button" :disabled="disabled" title="모든 서식 지우기" aria-label="모든 서식 지우기" @click="emit('clear')">
        <span class="fr-glyph fr-clear">가<i aria-hidden="true"></i></span>
      </button>

      <button
        class="fr-btn"
        :class="{ 'fr-btn-on': styleState.border }"
        type="button"
        :disabled="disabled"
        :aria-pressed="Boolean(styleState.border)"
        title="문자 테두리"
        aria-label="문자 테두리"
        @click="emit('toggle', 'border')"
      ><span class="fr-glyph fr-boxed">가</span></button>
    </div>

    <span class="fr-sep fr-sep-tall" aria-hidden="true"></span>

    <div class="fr-group">
      <button
        class="fr-btn"
        :class="{ 'fr-btn-on': styleState.bold }"
        type="button"
        :disabled="disabled"
        :aria-pressed="Boolean(styleState.bold)"
        title="굵게 (Ctrl+B)"
        aria-label="굵게"
        @click="emit('toggle', 'bold')"
      ><span class="fr-glyph" style="font-weight: 800">가</span></button>
      <button
        class="fr-btn"
        :class="{ 'fr-btn-on': styleState.italic }"
        type="button"
        :disabled="disabled"
        :aria-pressed="Boolean(styleState.italic)"
        title="기울임꼴 (Ctrl+I)"
        aria-label="기울임꼴"
        @click="emit('toggle', 'italic')"
      ><span class="fr-glyph" style="font-style: italic; transform: skewX(-12deg)">가</span></button>

      <!-- 밑줄 (분할 버튼) -->
      <div class="fr-menu-anchor fr-split">
        <button
          class="fr-btn fr-split-main"
          :class="{ 'fr-btn-on': styleState.underline }"
          type="button"
          :disabled="disabled"
          :aria-pressed="Boolean(styleState.underline)"
          title="밑줄 (Ctrl+U)"
          aria-label="밑줄"
          @click="emit('toggle', 'underline')"
        ><span class="fr-glyph" :style="{ textDecoration: 'underline', textDecorationStyle: styleState.underlineStyle || 'solid' }">가</span></button>
        <button
          class="fr-btn fr-split-caret"
          type="button"
          :disabled="disabled"
          aria-label="밑줄 스타일"
          :aria-expanded="openMenu === 'underline'"
          @click="toggleMenu('underline')"
        ><i class="fr-caret" aria-hidden="true"></i></button>
        <div v-if="openMenu === 'underline'" class="fr-popover fr-menu fr-underline-menu" role="menu">
          <button
            v-for="line in UNDERLINE_STYLES"
            :key="line.value"
            type="button"
            role="menuitem"
            class="fr-list-item fr-underline-item"
            :class="{ 'fr-list-item-active': styleState.underline && (styleState.underlineStyle || 'solid') === line.value }"
            @click="chooseUnderlineStyle(line.value)"
          >
            <span :style="{ borderBottom: `${line.value === 'double' ? 3 : 2}px ${line.value === 'wavy' ? 'dotted' : line.value} currentColor` }"></span>
            {{ line.label }}
          </button>
          <div class="fr-list-divider"></div>
          <p class="fr-menu-caption">밑줄 색</p>
          <div class="fr-swatches fr-swatches-compact">
            <button
              type="button"
              class="fr-swatch fr-swatch-auto"
              title="자동"
              aria-label="밑줄 색 자동"
              @click="chooseUnderlineColor('')"
            >자동</button>
            <button
              v-for="color in STANDARD_COLORS"
              :key="color.value"
              type="button"
              class="fr-swatch"
              :class="{ 'fr-swatch-active': styleState.underlineColor === color.value }"
              :style="{ background: color.value }"
              :title="color.label"
              :aria-label="`밑줄 색 ${color.label}`"
              @click="chooseUnderlineColor(color.value)"
            ></button>
          </div>
        </div>
      </div>

      <button
        class="fr-btn"
        :class="{ 'fr-btn-on': styleState.strike }"
        type="button"
        :disabled="disabled"
        :aria-pressed="Boolean(styleState.strike)"
        title="취소선"
        aria-label="취소선"
        @click="emit('toggle', 'strike')"
      ><span class="fr-glyph fr-glyph-latin" style="text-decoration: line-through">abc</span></button>
      <button
        class="fr-btn"
        :class="{ 'fr-btn-on': styleState.script === 'sub' }"
        type="button"
        :disabled="disabled"
        :aria-pressed="styleState.script === 'sub'"
        title="아래 첨자"
        aria-label="아래 첨자"
        @click="emit('apply', { script: styleState.script === 'sub' ? '' : 'sub' })"
      ><span class="fr-glyph fr-glyph-latin">x<sub>2</sub></span></button>
      <button
        class="fr-btn"
        :class="{ 'fr-btn-on': styleState.script === 'super' }"
        type="button"
        :disabled="disabled"
        :aria-pressed="styleState.script === 'super'"
        title="위 첨자"
        aria-label="위 첨자"
        @click="emit('apply', { script: styleState.script === 'super' ? '' : 'super' })"
      ><span class="fr-glyph fr-glyph-latin">x<sup>2</sup></span></button>

      <span class="fr-sep" aria-hidden="true"></span>

      <!-- 텍스트 효과 -->
      <div class="fr-menu-anchor">
        <button
          class="fr-btn fr-btn-menu"
          :class="{ 'fr-btn-on': styleState.effect }"
          type="button"
          :disabled="disabled"
          title="텍스트 효과"
          aria-label="텍스트 효과"
          :aria-expanded="openMenu === 'effect'"
          @click="toggleMenu('effect')"
        ><span class="fr-glyph fr-effect">가</span><i class="fr-caret" aria-hidden="true"></i></button>
        <div v-if="openMenu === 'effect'" class="fr-popover fr-menu" role="menu">
          <button
            v-for="effect in TEXT_EFFECTS"
            :key="effect.value"
            type="button"
            role="menuitem"
            class="fr-list-item fr-effect-item"
            :class="{ 'fr-list-item-active': (styleState.effect || '') === effect.value }"
            @click="apply({ effect: effect.value })"
          >
            <span class="fr-effect-preview" :class="`fr-effect-${effect.value || 'none'}`">가</span>
            {{ effect.label }}
          </button>
        </div>
      </div>

      <!-- 형광펜 (분할 버튼) -->
      <div class="fr-menu-anchor fr-split">
        <button
          class="fr-btn fr-split-main"
          type="button"
          :disabled="disabled"
          :title="`텍스트 강조 색 (${HIGHLIGHT_COLORS.find((c) => c.value === lastHighlight)?.label ?? '사용자 지정'})`"
          aria-label="텍스트 강조 색"
          @click="emit('apply', { highlight: styleState.highlight === lastHighlight ? '' : lastHighlight })"
        >
          <span class="fr-color-glyph">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m11.5 3.5 5 5-6.5 6.5H5v-5z" /><path d="m5 15-2 2h4" /></svg>
            <i :style="{ background: lastHighlight }"></i>
          </span>
        </button>
        <button
          class="fr-btn fr-split-caret"
          type="button"
          :disabled="disabled"
          aria-label="강조 색 목록"
          :aria-expanded="openMenu === 'highlight'"
          @click="toggleMenu('highlight')"
        ><i class="fr-caret" aria-hidden="true"></i></button>
        <div v-if="openMenu === 'highlight'" class="fr-popover fr-color-menu" role="menu" aria-label="텍스트 강조 색">
          <div class="fr-swatches fr-swatches-5">
            <button
              v-for="color in HIGHLIGHT_COLORS"
              :key="color.value"
              type="button"
              class="fr-swatch fr-swatch-lg"
              :class="{ 'fr-swatch-active': styleState.highlight === color.value }"
              :style="{ background: color.value }"
              :title="color.label"
              :aria-label="color.label"
              @click="chooseHighlight(color.value)"
            ></button>
          </div>
          <div class="fr-list-divider"></div>
          <button type="button" class="fr-list-item" @click="chooseHighlight('')">
            <span class="fr-no-color" aria-hidden="true"></span> 색 없음
          </button>
        </div>
      </div>

      <!-- 글꼴 색 (분할 버튼) -->
      <div class="fr-menu-anchor fr-split">
        <button
          class="fr-btn fr-split-main"
          type="button"
          :disabled="disabled"
          title="글꼴 색"
          aria-label="글꼴 색"
          @click="emit('apply', { color: styleState.color === lastColor ? '' : lastColor })"
        >
          <span class="fr-color-glyph">
            <span class="fr-glyph">가</span>
            <i :style="{ background: lastColor }"></i>
          </span>
        </button>
        <button
          class="fr-btn fr-split-caret"
          type="button"
          :disabled="disabled"
          aria-label="글꼴 색 목록"
          :aria-expanded="openMenu === 'color'"
          @click="toggleMenu('color')"
        ><i class="fr-caret" aria-hidden="true"></i></button>
        <div v-if="openMenu === 'color'" class="fr-popover fr-color-menu fr-color-menu-wide" role="menu" aria-label="글꼴 색">
          <button type="button" class="fr-list-item" @click="chooseColor('')">
            <span class="fr-auto-color" aria-hidden="true"></span> 자동
          </button>
          <div class="fr-list-divider"></div>
          <p class="fr-menu-caption">테마 색</p>
          <div class="fr-theme-grid">
            <div
              v-for="(row, rowIndex) in THEME_COLORS"
              :key="rowIndex"
              class="fr-swatches fr-swatches-10"
              :class="{ 'fr-theme-first-row': rowIndex === 0 }"
            >
              <button
                v-for="color in row"
                :key="`${rowIndex}-${color.value}`"
                type="button"
                class="fr-swatch"
                :class="{ 'fr-swatch-active': styleState.color === color.value }"
                :style="{ background: color.value }"
                :title="color.label"
                :aria-label="color.label"
                @click="chooseColor(color.value)"
              ></button>
            </div>
          </div>
          <p class="fr-menu-caption">표준 색</p>
          <div class="fr-swatches fr-swatches-10">
            <button
              v-for="color in STANDARD_COLORS"
              :key="color.value"
              type="button"
              class="fr-swatch"
              :class="{ 'fr-swatch-active': styleState.color === color.value }"
              :style="{ background: color.value }"
              :title="color.label"
              :aria-label="color.label"
              @click="chooseColor(color.value)"
            ></button>
          </div>
          <div class="fr-list-divider"></div>
          <label class="fr-list-item fr-custom-color">
            <input
              type="color"
              :value="styleState.color || lastColor"
              @change="chooseColor($event.target.value)"
            />
            다른 색...
          </label>
        </div>
      </div>

      <button
        class="fr-btn"
        :class="{ 'fr-btn-on': styleState.shading }"
        type="button"
        :disabled="disabled"
        :aria-pressed="Boolean(styleState.shading)"
        title="문자 음영"
        aria-label="문자 음영"
        @click="emit('toggle', 'shading')"
      ><span class="fr-glyph fr-shaded">가</span></button>
      <button
        class="fr-btn"
        :class="{ 'fr-btn-on': styleState.enclosed }"
        type="button"
        :disabled="disabled"
        :aria-pressed="Boolean(styleState.enclosed)"
        title="원 문자 (둥근 테두리)"
        aria-label="원 문자"
        @click="emit('toggle', 'enclosed')"
      ><span class="fr-glyph fr-circled">가</span></button>
    </div>

    <span class="fr-sep fr-sep-tall" aria-hidden="true"></span>

    <div class="fr-group" role="radiogroup" aria-label="정렬">
      <button
        v-for="option in ALIGN_OPTIONS"
        :key="option.value"
        class="fr-btn"
        :class="{ 'fr-btn-on': styleState.align === option.value }"
        type="button"
        role="radio"
        :disabled="disabled"
        :aria-checked="styleState.align === option.value"
        :title="option.label"
        :aria-label="option.label"
        @click="emit('align', option.value)"
      >
        <svg class="fr-align-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path v-for="(line, index) in option.lines" :key="index" :d="line" />
        </svg>
      </button>
    </div>

    <span v-if="targetLabel" class="fr-target" :title="targetLabel">{{ targetLabel }}</span>
  </div>
</template>
