<script setup>
import PushSettingsCard from "./admin/PushSettingsCard.vue";
import MqttSettingsCard from "./admin/MqttSettingsCard.vue";
import IngestErrorsCard from "./admin/IngestErrorsCard.vue";
</script>

<template>
  <div class="adm-view">
    <PushSettingsCard />
    <MqttSettingsCard />
    <IngestErrorsCard />
  </div>
</template>
