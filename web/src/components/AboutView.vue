<script setup>
import pkg from "../../../package.json";
</script>

<template>
  <div class="adm-view about-view">
    <div class="adm-card about-card">
      <h2>Sigvis</h2>
      <p class="about-desc">Node + Vue time-series dashboard</p>
      <p class="about-version">Version {{ pkg.version }}</p>
    </div>
  </div>
</template>

<style scoped>
.about-card {
  max-width: 28rem;
}

.about-desc {
  margin: 0 0 0.5rem;
  color: var(--c-text-2);
  font-size: 0.9rem;
}

.about-version {
  margin: 0;
  color: var(--c-text-3);
  font-size: 0.85rem;
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
</style>
