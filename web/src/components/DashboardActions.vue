<script setup>
defineProps({
  isEditMode: { type: Boolean, default: true }
});

const emit = defineEmits(["toggle-edit-mode"]);
</script>

<template>
  <div class="dashboard-actions">
    <button
      class="mode-toggle"
      :class="{ active: isEditMode }"
      @click="emit('toggle-edit-mode')"
    >Edit</button>
  </div>
</template>
