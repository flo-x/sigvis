<script setup>
import { ref, onMounted } from "vue";
import GeneratorsCard from "./admin/GeneratorsCard.vue";
import ProcessorsCard from "./admin/ProcessorsCard.vue";
import { getPrebuiltsCatalog, getRawSeriesCatalog } from "../services/adminApi.js";

const prebuiltsCatalog = ref([]);
const seriesCatalog    = ref([]);

onMounted(async () => {
  const [pbs, sc] = await Promise.allSettled([
    getPrebuiltsCatalog(),
    getRawSeriesCatalog()
  ]);
  if (pbs.status === "fulfilled") {
    prebuiltsCatalog.value = pbs.value;
  }
  if (sc.status === "fulfilled") {
    seriesCatalog.value = sc.value;
  }
});
</script>

<template>
  <div class="adm-view">
    <GeneratorsCard
      :prebuilts-catalog="prebuiltsCatalog"
      :series-catalog="seriesCatalog"
    />
    <ProcessorsCard
      :prebuilts-catalog="prebuiltsCatalog"
      :series-catalog="seriesCatalog"
    />
  </div>
</template>
