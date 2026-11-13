<script setup>
import { computed } from "vue";
import ReportCanvas from "./ReportCanvas.vue";

const props = defineProps({ report: { type: Object, required: true } });
const pages = computed(() => props.report.pages?.length ? props.report.pages : [{ blocks: props.report.blocks }]);
</script>

<template>
  <div>
    <ReportCanvas
      v-for="(page, index) in pages"
      :key="index"
      :report-type="report.layoutType || report.type"
      :date="report.date"
      :blocks="page.blocks"
      :header-footer="report.headerFooter"
      :page-index="index"
      :page-count="pages.length"
      :report-title="report.reportTitle || report.templateName || '보고서'"
      :page-setup="report.pageSetup"
    />
  </div>
</template>
