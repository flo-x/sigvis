import { ref } from "vue";

const renderSubscribers = new Set();

let renderTimer = null;
let renderIntervalMs = 50;
let lastTickAt = null;

// EMA-smoothed total time (ms) to run all render callbacks on each tick.
// Time constant τ = 2 s; α = 1 − exp(−Δt / τ) per tick.
const EMA_TAU_MS = 500;
const cadenceRenderMs = ref(null);

function toIntervalMs(hz, fallbackMs = 50) {
  const parsed = Number(hz);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMs;
  }
  return Math.max(1, Math.round(1000 / parsed));
}

function restartRenderTimer() {
  if (renderTimer) {
    clearInterval(renderTimer);
    renderTimer = null;
  }
  if (renderSubscribers.size === 0) {
    lastTickAt = null;
    cadenceRenderMs.value = null;
    return;
  }
  renderTimer = setInterval(() => {
    const nowMs = performance.now();

    renderSubscribers.forEach((callback) => callback(nowMs));
    const sample = performance.now() - nowMs;

    if (cadenceRenderMs.value === null) {
      cadenceRenderMs.value = sample;
    } else {
      const deltaT = lastTickAt != null ? nowMs - lastTickAt : renderIntervalMs;
      const alpha = 1 - Math.exp(-deltaT / EMA_TAU_MS);
      cadenceRenderMs.value = alpha * sample + (1 - alpha) * cadenceRenderMs.value;
    }

    lastTickAt = nowMs;
  }, renderIntervalMs);
}

function setGlobalRenderHz(hz) {
  renderIntervalMs = toIntervalMs(hz, renderIntervalMs);
  restartRenderTimer();
}

function subscribeGlobalRender(callback) {
  renderSubscribers.add(callback);
  restartRenderTimer();
  return () => {
    renderSubscribers.delete(callback);
    restartRenderTimer();
  };
}

export {
  cadenceRenderMs,
  setGlobalRenderHz,
  subscribeGlobalRender
};
