import { ref } from "vue";

/**
 * Provides HTML5 drag-and-drop reordering for a reactive list.
 *
 * @param {import('vue').Ref<Array>} items - reactive array of items
 * @param {(newItems: Array) => void} onReordered - called with the reordered array
 */
export function useDragReorder(items, onReordered) {
  const dragIndex    = ref(null);
  const dropIndex    = ref(null);
  const dropPosition = ref(null); // "before" | "after"

  function onDragStart(e, index) {
    dragIndex.value = index;
    e.dataTransfer.effectAllowed = "move";
    // Transparent drag image so the row itself acts as the ghost
    e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
  }

  function onDragOver(e, index) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragIndex.value === null || dragIndex.value === index) {
      dropIndex.value    = null;
      dropPosition.value = null;
      return;
    }
    // Determine whether to insert before or after the hovered item
    const rect   = e.currentTarget.getBoundingClientRect();
    const mid    = rect.top + rect.height / 2;
    dropIndex.value    = index;
    dropPosition.value = e.clientY < mid ? "before" : "after";
  }

  function onDrop(e, index) {
    e.preventDefault();
    const from = dragIndex.value;
    const to   = index;
    reset();
    if (from === null || from === to) {
      return;
    }
    const next = [...items.value];
    const [moved] = next.splice(from, 1);
    // Adjust target index after removal
    const insertAt = from < to ? to - 1 : to;
    next.splice(insertAt + (dropPosition.value === "after" ? 1 : 0), 0, moved);
    // Commit optimistically (parent will also re-fetch from server)
    items.value = next;
    onReordered(next);
  }

  function onDragEnd() {
    reset();
  }

  function reset() {
    dragIndex.value    = null;
    dropIndex.value    = null;
    dropPosition.value = null;
  }

  function isDragOver(index) {
    return dropIndex.value === index;
  }

  function dropClass(index) {
    if (dropIndex.value !== index) {
      return null;
    }
    return dropPosition.value === "before" ? "drag-drop-before" : "drag-drop-after";
  }

  return {
    dragIndex,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    isDragOver,
    dropClass
  };
}
