<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";

const props = defineProps({
  modelValue: { type: String, default: "" }
});

const emit = defineEmits(["update:modelValue"]);

const container = ref(null);
let view = null;
let ignoreUpdate = false;

onMounted(() => {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged && !ignoreUpdate) {
      emit("update:modelValue", update.state.doc.toString());
    }
  });

  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [basicSetup, javascript(), updateListener]
    }),
    parent: container.value
  });
});

watch(() => props.modelValue, (newVal) => {
  if (!view) {
    return;
  }
  const current = view.state.doc.toString();
  if (current === newVal) {
    return;
  }
  ignoreUpdate = true;
  view.dispatch({ changes: { from: 0, to: current.length, insert: newVal } });
  ignoreUpdate = false;
});

onBeforeUnmount(() => {
  if (view) {
    view.destroy();
    view = null;
  }
});
</script>

<template>
  <div ref="container" class="cm-editor-wrap" />
</template>

<style>
/* Unscoped so CodeMirror's own DOM gets styled */
.cm-editor-wrap .cm-editor {
  border: 1px solid var(--c-border);
  border-radius: 0.35rem;
  font-size: 0.82rem;
  font-family: ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace;
  min-height: 8rem;
  max-height: 26rem;
  overflow-y: auto;
}

.cm-editor-wrap .cm-editor.cm-focused {
  outline: 2px solid var(--c-primary);
  border-color: var(--c-primary);
  outline-offset: -1px;
}

.cm-editor-wrap .cm-scroller {
  min-height: 8rem;
}

/* Dark mode overrides */
[data-theme="dark"] .cm-editor-wrap .cm-editor {
  background: #1e1e2e;
  color: #cdd6f4;
}

[data-theme="dark"] .cm-editor-wrap .cm-gutters {
  background: #181825;
  color: #585b70;
  border-right-color: #313244;
}

[data-theme="dark"] .cm-editor-wrap .cm-activeLineGutter,
[data-theme="dark"] .cm-editor-wrap .cm-activeLine {
  background: #2a2a3a;
}

[data-theme="dark"] .cm-editor-wrap .cm-selectionBackground {
  background: #3d4267 !important;
}

[data-theme="dark"] .cm-editor-wrap .cm-cursor {
  border-left-color: #cdd6f4;
}
</style>
