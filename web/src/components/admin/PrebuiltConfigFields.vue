<script setup>
/**
 * Renders a dynamic config form for a prebuilt generator or processor.
 * Supports param types: measurement, series, select, number, string.
 */
import { ref, watch, onBeforeUnmount } from "vue";

const props = defineProps({
  schema:       { type: Array,  default: () => [] },
  modelValue:   { type: Object, default: () => ({}) },
  errors:       { type: Object, default: () => ({}) },
  seriesCatalog:{ type: Array,  default: () => [] }
});

const emit = defineEmits(["update:modelValue"]);

// ── Help popover ──────────────────────────────────────────────────────────────
const popover = ref({ visible: false, text: "", top: 0, left: 0, width: 0 });

function openHelp(event, text) {
  const r   = event.currentTarget.getBoundingClientRect();
  const vw  = window.innerWidth;
  const pw  = Math.min(300, vw - 24);
  let left  = r.left;
  if (left + pw > vw - 12) {
    left = vw - pw - 12;
  }
  popover.value = { visible: true, text, top: r.bottom + 6, left, width: pw };
  document.addEventListener("click", closeOnOutside, true);
  document.addEventListener("keydown", closeOnEscape, true);
}

function closeHelp() {
  popover.value.visible = false;
  document.removeEventListener("click", closeOnOutside, true);
  document.removeEventListener("keydown", closeOnEscape, true);
}

function closeOnOutside(e) {
  if (!e.target.closest(".adm-param-help-btn")) {
    closeHelp();
  }
}

function closeOnEscape(e) {
  if (e.key === "Escape") {
    closeHelp();
  }
}

onBeforeUnmount(closeHelp);

// ── Seed defaults into modelValue whenever the schema changes ─────────────────
// Without this, fields that have a param.default but are never touched by the
// user are absent from formConfig, causing server-side "required" errors.
watch(
  () => props.schema,
  (schema) => {
    const patch = {};
    for (const p of schema) {
      if (props.modelValue[p.name] === undefined && p.default !== undefined) {
        patch[p.name] = p.default;
      }
    }
    if (Object.keys(patch).length > 0) {
      emit("update:modelValue", { ...props.modelValue, ...patch });
    }
  },
  { immediate: true }
);

// ── Field helpers ─────────────────────────────────────────────────────────────
function fieldValue(param) {
  const v = props.modelValue[param.name];
  return v !== undefined ? v : (param.default ?? "");
}

function onInput(param, value) {
  const updated = { ...props.modelValue, [param.name]: param.type === "number" ? (value === "" ? "" : Number(value)) : value };
  emit("update:modelValue", updated);
}

function measurementsForParam() {
  return props.seriesCatalog.map((m) => m.measurementName);
}

function seriesForParam(param) {
  const measParam = param.measurementParam;
  if (!measParam) {
    return [];
  }
  const measVal = String(props.modelValue[measParam] || "");
  const entry   = props.seriesCatalog.find((m) => m.measurementName === measVal);
  return entry ? entry.series.map((s) => s.name) : [];
}
</script>

<template>
  <div v-if="schema.length" class="adm-config-fields">
    <table class="adm-config-table">
      <tbody>
        <tr v-for="param in schema" :key="param.name">
          <td class="adm-config-label">
            <label :for="`cfg_${param.name}`">{{ param.label }}</label>
            <button
              v-if="param.help"
              type="button"
              class="adm-param-help-btn"
              :aria-label="`Help for ${param.label}`"
              @click.stop="openHelp($event, param.help)"
            >i</button>
          </td>
          <td class="adm-config-value">
            <!-- select -->
            <template v-if="param.type === 'select' && param.options">
              <select
                :id="`cfg_${param.name}`"
                :value="fieldValue(param)"
                @change="onInput(param, $event.target.value)"
              >
                <option v-for="opt in param.options" :key="opt" :value="String(opt)">{{ opt }}</option>
              </select>
            </template>

            <!-- measurement -->
            <template v-else-if="param.type === 'measurement'">
              <input
                :id="`cfg_${param.name}`"
                type="text"
                :value="fieldValue(param)"
                :list="`dl_${param.name}`"
                autocomplete="off"
                @input="onInput(param, $event.target.value)"
              />
              <datalist :id="`dl_${param.name}`">
                <option v-for="m in measurementsForParam()" :key="m" :value="m" />
              </datalist>
            </template>

            <!-- series (depends on a measurement param) -->
            <template v-else-if="param.type === 'series'">
              <input
                :id="`cfg_${param.name}`"
                type="text"
                :value="fieldValue(param)"
                :list="`dl_${param.name}`"
                autocomplete="off"
                @input="onInput(param, $event.target.value)"
              />
              <datalist :id="`dl_${param.name}`">
                <option v-for="s in seriesForParam(param)" :key="s" :value="s" />
              </datalist>
            </template>

            <!-- number -->
            <template v-else-if="param.type === 'number'">
              <input
                :id="`cfg_${param.name}`"
                type="number"
                :value="fieldValue(param)"
                :min="param.min"
                :max="param.max"
                @input="onInput(param, $event.target.value)"
              />
            </template>

            <!-- string / default -->
            <template v-else>
              <input
                :id="`cfg_${param.name}`"
                type="text"
                :value="fieldValue(param)"
                @input="onInput(param, $event.target.value)"
              />
            </template>

            <div v-if="errors[param.name]" class="adm-config-field-error">
              {{ errors[param.name] }}
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Floating help popover -->
  <Teleport to="body">
    <Transition name="help-pop">
      <div
        v-if="popover.visible"
        class="adm-help-popover"
        :style="{ top: popover.top + 'px', left: popover.left + 'px', width: popover.width + 'px' }"
      >
        {{ popover.text }}
      </div>
    </Transition>
  </Teleport>
</template>
