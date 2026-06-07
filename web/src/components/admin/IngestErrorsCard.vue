<script setup>
import { ref, onMounted } from "vue";
import { getIngestErrors, clearIngestErrors } from "../../services/adminApi.js";

const errors  = ref([]);
const loading = ref(false);

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString();
}

async function load() {
  loading.value = true;
  try {
    errors.value = await getIngestErrors();
  } catch {
    /* non-critical */
  } finally {
    loading.value = false;
  }
}

async function clear() {
  try {
    await clearIngestErrors();
    errors.value = [];
  } catch {
    /* ignore */
  }
}

onMounted(load);
</script>

<template>
  <div class="adm-card">
    <div style="display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 0.6rem">
      <h2 style="margin: 0">Ingest Errors</h2>
      <button class="adm-btn" type="button" :disabled="loading" @click="load">Refresh</button>
      <button class="adm-btn adm-btn-danger" type="button" @click="clear">Clear</button>
    </div>
    <p style="font-size: 0.82rem; color: var(--c-text-3); margin: 0 0 0.5rem">
      Recent errors from all ingestion paths: HTTP API, MQTT, generators, and processors.
      When MQTT debug mode is enabled, every received message is also logged here (source: <em>MQTT Debug</em>).
      Capped at the 50 most recent entries.
    </p>
    <div class="adm-errors-wrap">
      <table class="adm-errors-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Source</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="errors.length === 0">
            <td colspan="3" class="adm-ie-empty">No errors recorded.</td>
          </tr>
          <tr v-for="(e, i) in [...errors].reverse()" :key="i">
            <td class="adm-ie-time">{{ formatTime(e.ts) }}</td>
            <td class="adm-ie-source">{{ e.source }}</td>
            <td class="adm-ie-message">
              {{ e.message }}
              <details v-if="e.payload != null" style="margin-top: 0.25rem">
                <summary style="cursor: pointer; font-size: 0.75rem; color: var(--c-text-3)">
                  Received message
                </summary>
                <pre style="margin: 0.25rem 0 0; font-size: 0.72rem; white-space: pre-wrap; word-break: break-all; background: var(--c-surface-subtle); border: 1px solid var(--c-border-subtle); border-radius: 3px; padding: 0.3rem 0.4rem; max-height: 8rem; overflow-y: auto">{{ e.payload }}</pre>
              </details>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
