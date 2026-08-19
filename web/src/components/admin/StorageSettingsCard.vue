<script setup>
import { ref, onMounted } from "vue";
import { getConfig, updateConfig } from "../../services/adminApi.js";

const enabled       = ref(false);
const maxPoints     = ref(500000);
const saving        = ref(false);
const msg           = ref("");
const msgError      = ref(false);

onMounted(async () => {
  try {
    const d = await getConfig();
    enabled.value   = d.sqlitePersistenceEnabled ?? false;
    maxPoints.value = d.sqliteDefaultMaxPoints   ?? 500000;
  } catch {
    msg.value      = "Failed to load storage settings.";
    msgError.value = true;
  }
});

async function save() {
  const pts = Number(maxPoints.value);
  if (!Number.isFinite(pts) || pts <= 0) {
    msg.value      = "Default max rows must be a positive number.";
    msgError.value = true;
    return;
  }
  saving.value = true;
  msg.value    = "";
  try {
    const d = await updateConfig({
      sqlitePersistenceEnabled: enabled.value,
      sqliteDefaultMaxPoints:   Math.trunc(pts)
    });
    enabled.value   = d.sqlitePersistenceEnabled;
    maxPoints.value = d.sqliteDefaultMaxPoints;
    msg.value      = "Saved.";
    msgError.value = false;
  } catch (e) {
    msg.value      = e.message;
    msgError.value = true;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="adm-card">
    <h2>Storage (SQLite)</h2>

    <div class="adm-field adm-field--inline">
      <label for="sqliteEnabled">Enable SQLite persistence</label>
      <input id="sqliteEnabled" v-model="enabled" type="checkbox" />
    </div>

    <div class="adm-field">
      <label for="sqliteMaxPts">Default max rows per measurement</label>
      <input
        id="sqliteMaxPts"
        v-model.number="maxPoints"
        type="number"
        min="1"
        step="10000"
        style="max-width: 11rem"
      />
    </div>

    <p class="adm-hint">
      When enabled, measurement data is written to <code>series.db</code> and
      reloaded on the next server restart. Toggling at runtime starts or stops
      writing immediately; historical data is only loaded on restart.
      Max 32 series per measurement.
    </p>

    <button class="adm-save-btn" :disabled="saving" type="button" @click="save">
      Save
    </button>
    <p v-if="msg" class="adm-msg" :class="msgError ? 'adm-msg-error' : 'adm-msg-ok'">
      {{ msg }}
    </p>
  </div>
</template>
