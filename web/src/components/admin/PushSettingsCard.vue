<script setup>
import { ref, onMounted } from "vue";
import { getConfig, updateConfig } from "../../services/adminApi.js";

const minPushMs = ref(30);
const saving    = ref(false);
const msg       = ref("");
const msgError  = ref(false);

onMounted(async () => {
  try {
    const d = await getConfig();
    minPushMs.value = d.minPushIntervalMs;
  } catch (e) {
    msg.value     = "Failed to load settings.";
    msgError.value = true;
  }
});

async function save() {
  const value = Number(minPushMs.value);
  if (!Number.isFinite(value) || value <= 0) {
    msg.value     = "Must be a positive number.";
    msgError.value = true;
    return;
  }
  saving.value = true;
  msg.value    = "";
  try {
    const d = await updateConfig({ minPushIntervalMs: value });
    minPushMs.value = d.minPushIntervalMs;
    msg.value      = `Saved — min push interval: ${d.minPushIntervalMs} ms`;
    msgError.value = false;
  } catch (e) {
    msg.value     = e.message;
    msgError.value = true;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="adm-card">
    <h2>Push Settings</h2>
    <div class="adm-field">
      <label for="minPushMs">Min push interval (ms)</label>
      <input
        id="minPushMs"
        v-model.number="minPushMs"
        type="number"
        min="1"
        step="1"
        style="max-width: 9rem"
      />
    </div>
    <button class="adm-save-btn" :disabled="saving" type="button" @click="save">
      Save
    </button>
    <p v-if="msg" class="adm-msg" :class="msgError ? 'adm-msg-error' : 'adm-msg-ok'">
      {{ msg }}
    </p>
  </div>
</template>
