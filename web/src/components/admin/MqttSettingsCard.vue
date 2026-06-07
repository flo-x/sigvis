<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { getConfig, updateConfig } from "../../services/adminApi.js";

const brokerUrl   = ref("");
const clientId    = ref("");
const username    = ref("");
const password    = ref("");
const ingestTopic = ref("");
const debugMode   = ref(false);

const mqttStatus    = ref("disconnected");
const mqttLastError = ref("");

const saving   = ref(false);
const msg      = ref("");
const msgError = ref(false);

let pollTimer = null;

const badgeClass = computed(() => {
  const s = mqttStatus.value;
  if (["connected", "connecting", "error", "disconnected"].includes(s)) {
    return `adm-badge adm-badge-${s}`;
  }
  return "adm-badge adm-badge-disconnected";
});

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollStatus() {
  try {
    const d = await getConfig();
    const m = d.mqtt || {};
    mqttStatus.value    = m.status    || "disconnected";
    mqttLastError.value = m.lastError || "";
    if (m.status === "connected") {
      stopPoll();
      msg.value      = "Connected to broker.";
      msgError.value = false;
    } else if (m.status === "error") {
      stopPoll();
      msg.value      = `Connection error: ${m.lastError || "unknown"}`;
      msgError.value = true;
    } else if (m.status === "disconnected") {
      stopPoll();
    }
  } catch {
    /* ignore transient errors during polling */
  }
}

function startPoll() {
  stopPoll();
  pollTimer = setInterval(pollStatus, 1500);
}

onMounted(async () => {
  try {
    const d = await getConfig();
    const m = d.mqtt || {};
    brokerUrl.value   = m.brokerUrl   || "";
    clientId.value    = m.clientId    || "";
    username.value    = m.username    || "";
    ingestTopic.value = m.ingestTopic || "";
    debugMode.value   = Boolean(m.debugMode);
    mqttStatus.value    = m.status    || "disconnected";
    mqttLastError.value = m.lastError || "";
    if (m.status === "connecting") {
      startPoll();
    }
  } catch (e) {
    msg.value     = "Failed to load MQTT settings.";
    msgError.value = true;
  }
});

onBeforeUnmount(() => { stopPoll(); });

async function save() {
  stopPoll();
  saving.value = true;
  msg.value    = "";
  try {
    const d = await updateConfig({
      mqtt: {
        brokerUrl:   brokerUrl.value.trim(),
        clientId:    clientId.value.trim(),
        username:    username.value,
        password:    password.value,
        ingestTopic: ingestTopic.value.trim(),
        debugMode:   debugMode.value
      }
    });
    const m = d.mqtt || {};
    brokerUrl.value   = m.brokerUrl   || "";
    clientId.value    = m.clientId    || "";
    username.value    = m.username    || "";
    password.value    = "";
    ingestTopic.value = m.ingestTopic || "";
    debugMode.value   = Boolean(m.debugMode);
    mqttStatus.value    = m.status    || "disconnected";
    mqttLastError.value = m.lastError || "";
    if (m.brokerUrl) {
      msg.value      = "Saved — waiting for broker…";
      msgError.value = false;
      startPoll();
    } else {
      msg.value      = "Saved — MQTT disabled.";
      msgError.value = false;
    }
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
    <h2>MQTT Ingestion</h2>

    <div class="adm-status-row">
      Status:
      <span :class="badgeClass">{{ mqttStatus }}</span>
      <span v-if="mqttLastError" style="color: var(--c-danger); font-size: 0.8rem">({{ mqttLastError }})</span>
      <button class="adm-btn" style="margin-left: auto" type="button" @click="pollStatus">
        Refresh
      </button>
    </div>

    <hr />

    <div class="adm-field">
      <label for="mqttBroker">Broker URL</label>
      <input id="mqttBroker" v-model="brokerUrl" type="text" placeholder="mqtt://localhost:1883" />
    </div>

    <div class="adm-row">
      <div class="adm-field">
        <label for="mqttClientId">Client ID</label>
        <input id="mqttClientId" v-model="clientId" type="text" placeholder="(auto-generated)" />
      </div>
      <div class="adm-field">
        <label for="mqttUsername">Username</label>
        <input id="mqttUsername" v-model="username" type="text" placeholder="(optional)" />
      </div>
    </div>

    <div class="adm-field">
      <label for="mqttPassword">Password</label>
      <input id="mqttPassword" v-model="password" type="password" placeholder="(leave blank to keep current)" />
    </div>

    <div class="adm-field">
      <label for="mqttIngestTopic">Ingest topic</label>
      <input id="mqttIngestTopic" v-model="ingestTopic" type="text" placeholder="cmnd/sigvis/ingest" />
    </div>

    <div class="adm-field-row">
      <input id="mqttDebugMode" v-model="debugMode" type="checkbox" style="width: auto; margin: 0" />
      <label for="mqttDebugMode" style="font-weight: normal; margin: 0">
        Debug mode — log every received message in the Ingest Log
      </label>
    </div>

    <p class="adm-help-text">
      Clear Broker URL to disable MQTT. Leave topic blank to use the default
      (<code>cmnd/sigvis/ingest</code>).
    </p>

    <details class="adm-details">
      <summary>Message format example</summary>
      <p style="margin: 0.5rem 0 0.3rem; color: var(--c-text-3)">
        Publish a JSON payload to the ingest topic. The shape is identical to the HTTP ingest API:
      </p>
      <pre>{{`{
  "measurementName": "sensors",
  "points": {
    "timestamps": [1748000000000, 1748000001000],
    "series": {
      "temperature": [22.4, 22.6],
      "humidity":    [55.1, 55.3]
    }
  }
}`}}</pre>
      <p style="margin: 0.4rem 0 0; color: var(--c-text-3); font-size: 0.8rem">
        <code>timestamps</code> — Unix epoch in <strong>milliseconds</strong>, strictly increasing.<br />
        Multiple series can be sent in a single message.<br />
        Add <code>"clearMeasurement": true</code> to replace all existing data for that measurement.<br />
        Add <code>"time": false</code> to indicate timestamps are simple numbers, not Unix epoch milliseconds.
      </p>
    </details>

    <button class="adm-save-btn" :disabled="saving" type="button" @click="save">Save</button>
    <p v-if="msg" class="adm-msg" :class="msgError ? 'adm-msg-error' : 'adm-msg-ok'">
      {{ msg }}
    </p>
  </div>
</template>
