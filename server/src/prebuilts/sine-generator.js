"use strict";

/**
 * Prebuilt generator: Sine wave
 *
 * Produces a sinusoidal time series at a configurable frequency, amplitude,
 * and sample rate. Uses a deterministic phase accumulator anchored to wall-clock
 * time so the waveform stays coherent even if ticks fire slightly late.
 *
 * Optional amplitude modulation (AM):
 *   envelope(t) = 1 + (amplitudeModDepthPct / 100) × cos(2π × amplitudeModRateHz × t)
 *   Setting amplitudeModDepthPct = 0 (default) disables AM.
 *
 * Optional frequency modulation (FM):
 *   instFreq(t) = freqHz + freqModDepthHz × cos(2π × freqModRateHz × t)
 *   Phase is accumulated per-sample from instFreq.
 *   Setting freqModDepthHz = 0 (default) disables FM.
 *
 * Optional noise / jitter:
 *   noiseAmplitude    — uniform additive noise on the sample value.
 *   timestampJitterMs — uniform random offset added to each sample's timestamp.
 *   phaseJitterRad    — uniform random kick added to the phase accumulator each step
 *                       (produces a random walk on frequency / phase noise).
 */
module.exports = {
  id:          "sine-generator",
  displayName: "Sine wave generator",
  kind:        "generator",
  description: "Generates a sinusoidal time series with optional AM, FM, additive noise, " +
               "timestamp jitter, and phase jitter. Produces a batch of samples per tick " +
               "so the series stays smooth regardless of the generator interval.",

  paramSchema: [
    /* ── Core ──────────────────────────────────────────────────────────── */
    {
      name:     "measurement",
      label:    "Generated measurement name",
      type:     "measurement",
      default:  "",
      required: true
    },
    {
      name:     "seriesName",
      label:    "Generated series name",
      type:     "string",
      default:  "value",
      required: true
    },
    {
      name:    "freqHz",
      label:   "Frequency (Hz)",
      type:    "number",
      default: 1,
      min:     0.001,
      max:     1e6,
      help:    "Frequency of the sine wave in Hz.\nMust be less than half the sample rate (Nyquist limit).\nExample: freqHz = 1 with sampleHz = 50 gives a clean 1 Hz sine."
    },
    {
      name:    "amplitude",
      label:   "Amplitude",
      type:    "number",
      default: 1,
      help:    "Peak amplitude of the sine wave.\nThe waveform oscillates between -amplitude and +amplitude.\nExample: amplitude = 1 gives values in [-1, 1]."
    },
    {
      name:    "sampleHz",
      label:   "Sample rate (Hz)",
      type:    "number",
      default: 50,
      min:     1,
      max:     10000,
      help:    "Number of data points produced per second.\nMust be more than 2× the signal frequency (Nyquist).\nThe effective maximum is 1000 ÷ interval_ms.\nExample: interval = 100 ms → max useful sample rate = 10 Hz per tick × 10 ticks/s = 100 Hz effective."
    },
    /* ── Amplitude modulation ───────────────────────────────────────────── */
    {
      name:    "amplitudeModRateHz",
      label:   "AM rate (Hz)",
      type:    "number",
      default: 0.1,
      min:     0.001,
      help:    "Frequency of the amplitude modulation envelope in Hz.\nOnly active when AM depth > 0.\nExample: 0.1 Hz makes the amplitude rise and fall once every 10 seconds."
    },
    {
      name:    "amplitudeModDepthPct",
      label:   "AM depth (%)",
      type:    "number",
      default: 0,
      min:     0,
      max:     100,
      help:    "Amplitude modulation depth as a percentage of the carrier amplitude.\n0 = no AM (pure sine).\n100 = the envelope swings between 0 and 2× amplitude.\nFormula: envelope = 1 + (depth/100) × cos(2π × amRate × t)"
    },
    /* ── Frequency modulation ───────────────────────────────────────────── */
    {
      name:    "freqModRateHz",
      label:   "FM rate (Hz)",
      type:    "number",
      default: 0.1,
      min:     0.001,
      help:    "Frequency of the frequency modulation oscillator in Hz.\nOnly active when FM depth > 0.\nExample: 0.1 Hz sweeps the carrier frequency up and down once every 10 seconds."
    },
    {
      name:    "freqModDepthHz",
      label:   "FM depth (Hz)",
      type:    "number",
      default: 0,
      min:     0,
      help:    "Frequency deviation in Hz — how far the instantaneous frequency swings above and below the carrier.\n0 = no FM (fixed frequency).\nFormula: instFreq(t) = freqHz + freqModDepthHz × cos(2π × fmRate × t)\nEnsure freqHz + freqModDepthHz < sampleHz / 2 (Nyquist)."
    },
    /* ── Noise / jitter ─────────────────────────────────────────────────── */
    {
      name:    "noiseAmplitude",
      label:   "Noise amplitude",
      type:    "number",
      default: 0,
      min:     0,
      help:    "Peak amplitude of uniform additive noise added to each sample value.\n0 = no noise.\nExample: noiseAmplitude = 0.1 with amplitude = 1 adds ±0.1 noise to a ±1 sine."
    },
    {
      name:    "timestampJitterMs",
      label:   "Timestamp jitter (ms)",
      type:    "number",
      default: 0,
      min:     0,
      help:    "Maximum random displacement (±) added to each sample's timestamp in milliseconds.\n0 = perfectly regular sampling.\nThe jitter is automatically clamped to ¼ of the sample period (stepMs / 4) to guarantee timestamps remain strictly increasing."
    },
    {
      name:    "phaseJitterRad",
      label:   "Phase jitter (rad)",
      type:    "number",
      default: 0,
      min:     0,
      help:    "Maximum random phase kick (±) applied to the phase accumulator on each step, in radians.\nProduces a random walk on frequency — the oscillator wanders slightly from tick to tick.\n0 = no phase jitter.\nExample: 0.05 rad adds subtle cycle-to-cycle variation; 0.5 rad makes the signal visibly incoherent."
    }
  ],

  validateFn(config) {
    const errors   = {};
    const freqHz   = Number(config.freqHz);
    const sampleHz = Number(config.sampleHz);
    const fmDepth  = Number(config.freqModDepthHz) || 0;
    // Maximum instantaneous frequency must stay below Nyquist.
    const maxFreq  = freqHz + fmDepth;
    if (freqHz > 0 && sampleHz > 0 && maxFreq >= sampleHz / 2) {
      const nyquist = sampleHz / 2;
      errors.freqHz = fmDepth > 0
        ? `Max instantaneous frequency (${freqHz} + ${fmDepth} = ${maxFreq} Hz) must be less than half the sample rate (${nyquist} Hz) — Nyquist limit.`
        : `Frequency (${freqHz} Hz) must be less than half the sample rate (${nyquist} Hz) — Nyquist limit.`;
    }
    return errors;
  },

  initFn(state, config, _api) {
    // Round current time to nearest 0.1 s (100 ms) for a clean start.
    state.nextTs   = Math.round(Date.now() / 100) * 100;
    state.phaseRad = 0;
    state.stepMs   = 1000 / (config.sampleHz || 50);
  },

  processFn(state, config, api) {
    const carrierHz    = Number(config.freqHz)               || 1;
    const amplitude    = Number(config.amplitude)            ?? 1;
    const amRateHz     = Number(config.amplitudeModRateHz)   || 0.1;
    const amDepthPct   = Number(config.amplitudeModDepthPct) || 0;
    const fmRateHz     = Number(config.freqModRateHz)        || 0.1;
    const fmDepthHz    = Number(config.freqModDepthHz)       || 0;
    const noiseAmp     = Number(config.noiseAmplitude)       || 0;
    const tsJitterMs   = Number(config.timestampJitterMs)    || 0;
    const phJitterRad  = Number(config.phaseJitterRad)       || 0;

    const amActive     = amDepthPct !== 0;
    const fmActive     = fmDepthHz  !== 0;
    const stepSec      = state.stepMs / 1000;
    const now          = Date.now();

    const timestamps = [];
    const values     = [];

    let ts = state.nextTs + state.stepMs;
    while (ts <= now) {
      const tSec = ts / 1000;

      // FM: instantaneous frequency drives phase accumulation.
      const instFreqHz = fmActive
        ? carrierHz + fmDepthHz * Math.cos(2 * Math.PI * fmRateHz * tSec)
        : carrierHz;
      state.phaseRad += 2 * Math.PI * instFreqHz * stepSec;

      // Phase jitter: random walk on the phase accumulator.
      if (phJitterRad > 0) {
        state.phaseRad += (Math.random() * 2 - 1) * phJitterRad;
      }

      // AM envelope.
      const envelope = amActive
        ? 1 + (amDepthPct / 100) * Math.cos(2 * Math.PI * amRateHz * tSec)
        : 1;

      // Additive noise.
      const noise = noiseAmp > 0 ? (Math.random() * 2 - 1) * noiseAmp : 0;

      // Timestamp jitter — clamped to ¼ of the step so adjacent samples can
      // never swap order (worst-case gap = stepMs − 2×effectiveJitter = stepMs/2).
      const effectiveJitterMs = Math.min(tsJitterMs, state.stepMs / 4);
      const jitteredTs = effectiveJitterMs > 0
        ? ts + (Math.random() * 2 - 1) * effectiveJitterMs
        : ts;

      timestamps.push(jitteredTs);
      values.push(+(amplitude * envelope * Math.sin(state.phaseRad) + noise).toFixed(6));
      ts += state.stepMs;
    }

    if (timestamps.length === 0) {
      return;
    }

    // Advance bookmark using the un-jittered ts so spacing stays regular.
    state.nextTs = ts - state.stepMs;

    api.ingest({
      measurementName: config.measurement || "sine_gen",
      points: {
        timestamps,
        series: { [config.seriesName || "value"]: values }
      }
    });
  }
};
