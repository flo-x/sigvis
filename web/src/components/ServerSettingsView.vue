<script setup>
import PushSettingsCard from "./admin/PushSettingsCard.vue";
import MqttSettingsCard from "./admin/MqttSettingsCard.vue";
import IngestErrorsCard from "./admin/IngestErrorsCard.vue";
import StorageSettingsCard from "./admin/StorageSettingsCard.vue";
</script>

<template>
  <div class="adm-view">
    <PushSettingsCard />
    <StorageSettingsCard />
    <MqttSettingsCard />
    <IngestErrorsCard />
  </div>
</template>
