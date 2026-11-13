<script setup>
defineProps({
  name: {
    type: String,
    required: true,
  },
});
</script>

<template>
  <svg class="action-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <template v-if="name === 'view'">
      <path d="M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </template>
    <template v-else-if="name === 'save'">
      <path d="M5 4h12l3 3v13H4V4h1Z" />
      <path d="M8 4v6h8V4M8 20v-6h8v6" />
    </template>
    <template v-else-if="name === 'mail'">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4.5 7 7.5 6 7.5-6" />
    </template>
    <template v-else-if="name === 'attach'">
      <path d="M19 11.5 12.2 18.3a4.5 4.5 0 0 1-6.4-6.4l7.4-7.4a3 3 0 0 1 4.2 4.2l-7.3 7.3a1.5 1.5 0 0 1-2.1-2.1l6.6-6.6" />
    </template>
    <template v-else-if="name === 'up'">
      <path d="M12 19V5M6 11l6-6 6 6" />
    </template>
    <template v-else-if="name === 'down'">
      <path d="M12 5v14m6-6-6 6-6-6" />
    </template>
    <template v-else-if="name === 'delete'">
      <path d="M4 7h16M9 7V4h6v3m3 0-.8 13H6.8L6 7m3 3v7m6-7v7" />
    </template>
    <template v-else-if="name === 'zoom-in'">
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="M16 16l4.5 4.5M10.8 7.8v6m-3-3h6" />
    </template>
    <template v-else-if="name === 'zoom-out'">
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="M16 16l4.5 4.5M7.8 10.8h6" />
    </template>
    <template v-else-if="name === 'add'">
      <path d="M12 5v14M5 12h14" />
    </template>
    <template v-else-if="name === 'remove'">
      <path d="M5 12h14" />
    </template>
    <template v-else-if="name === 'clear'">
      <path d="m4 15 8.5-9 6.5 6-8.5 9H4v-6Z" />
      <path d="m10.5 8 6.5 6" />
    </template>
    <template v-else-if="name === 'settings'">
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
      <path d="M19.2 13.2a7.4 7.4 0 0 0 0-2.4l1.5-1.2-1.5-2.6-1.8.6a7.4 7.4 0 0 0-2.1-1.2L15 4.5h-3l-.3 1.9a7.4 7.4 0 0 0-2.1 1.2l-1.8-.6-1.5 2.6 1.5 1.2a7.4 7.4 0 0 0 0 2.4l-1.5 1.2 1.5 2.6 1.8-.6a7.4 7.4 0 0 0 2.1 1.2l.3 1.9h3l.3-1.9a7.4 7.4 0 0 0 2.1-1.2l1.8.6 1.5-2.6-1.5-1.2Z" />
    </template>
    <template v-else-if="name === 'run'">
      <path d="M6 4.8v14.4L19 12 6 4.8Z" />
    </template>
    <template v-else-if="name === 'reset'">
      <path d="M4.5 8.5A8 8 0 1 1 4 14" />
      <path d="M4.5 4.5v4h4M12 8v4l2.8 1.7" />
    </template>
    <template v-else-if="name === 'cancel'">
      <path d="m6 6 12 12M18 6 6 18" />
    </template>
    <template v-else-if="name === 'create'">
      <path d="M5 3.5h9l5 5v12H5z" />
      <path d="M14 3.5v5h5M12 12v5m-2.5-2.5h5" />
    </template>
    <template v-else-if="name === 'details'">
      <path d="M5 3.5h9l5 5v12H5z" />
      <path d="M14 3.5v5h5M8.5 12h7M8.5 15.5h7" />
    </template>
    <template v-else-if="name === 'schedule'">
      <path d="M5 5.5h14v15H5zM8 3.5v4M16 3.5v4M5 9.5h14" />
      <path d="M12 12v3l2 1" />
    </template>
    <template v-else-if="name === 'duplicate'">
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </template>
    <template v-else-if="name === 'edit'">
      <path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5 4 16.5Z" />
      <path d="m13.8 6.7 3.5 3.5" />
    </template>
    <template v-else-if="name === 'open'">
      <path d="M4 5h6l2 2h8v12H4z" />
      <path d="M12 13h5m-2-2 2 2-2 2" />
    </template>
    <template v-else-if="name === 'merge'">
      <path d="M4 5h7v6H4zM13 13h7v6h-7zM11 8h2a2 2 0 0 1 2 2v3" />
      <path d="m13 11 2 2 2-2" />
    </template>
    <template v-else-if="name === 'unmerge'">
      <path d="M4 5h7v6H4zM13 13h7v6h-7zM11 8h2a2 2 0 0 1 2 2v1M15 13V9" />
      <path d="m13 11 2-2 2 2" />
    </template>
    <template v-else-if="name === 'check'">
      <path d="m5 12.5 4.2 4.2L19 7" />
    </template>
    <template v-else-if="name === 'lock'">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M7.5 10V7a4.5 4.5 0 0 1 9 0v3M12 14v3" />
    </template>
    <template v-else-if="name === 'day'">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4m8-4v4M4 9h16M8 13h3m-3 3h3" />
    </template>
    <template v-else-if="name === 'week'">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M8 3v4m8-4v4M3.5 9h17M7 12.5h2m3 0h2m3 0h.1M7 16h2m3 0h2" />
    </template>
    <template v-else-if="name === 'month'">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M8 3v4m8-4v4M3.5 9h17M7 12.5h2m3 0h2m3 0h.1M7 16h2m3 0h2m3 0h.1" />
    </template>
    <template v-else>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4m0 4h.01" />
    </template>
  </svg>
</template>
