"use strict";
/**
 * Shared utilities for compiling and running user-defined scripts inside
 * Node vm sandboxes, used by ProcessorService and GeneratorService.
 */
const vm = require("vm");

const EXEC_TIMEOUT_MS = 5000;

// Safe subset of Node/JS globals exposed to every sandbox.
const SANDBOX_GLOBALS = Object.freeze({
  Math, JSON, Date, undefined, NaN, Infinity,
  isFinite, isNaN, parseFloat, parseInt,
  Array, Object, Map, Set, Error, String, Number, Boolean
});

/**
 * Escape a string so it is safe to embed inside a RegExp literal.
 * @param {string} str
 * @returns {string}
 */
function escapeForRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract a ` (line N)` suffix from an error stack for a given vm filename.
 * Returns an empty string when no match is found.
 * @param {string|undefined} stack
 * @param {string} filename
 * @returns {string}
 */
function extractLineInfo(stack, filename) {
  const m = stack?.match(new RegExp(`${escapeForRegex(filename)}:(\\d+)`));
  return m ? ` (line ${m[1]})` : "";
}

/**
 * Compile a vm.Script, returning `{ script }` on success or `{ error }` on failure.
 * The `filename` is used for stack-trace attribution and must match what you pass
 * to `runScript` / `extractLineInfo` when reporting errors.
 * @param {string} code
 * @param {string} filename
 * @returns {{ script: vm.Script } | { error: string }}
 */
function compileScript(code, filename) {
  try {
    return { script: new vm.Script(code, { filename }) };
  } catch (compileErr) {
    const lineInfo = extractLineInfo(compileErr.stack, filename);
    return { error: `Compile error: ${compileErr.message}${lineInfo}` };
  }
}

/**
 * Run a pre-compiled vm.Script in a new context.
 * Returns `null` on success or an error string (with line info) on failure.
 * @param {vm.Script} script
 * @param {object} sandbox
 * @param {string} filename  — used only for extracting line numbers from errors
 * @returns {string|null}
 */
function runScript(script, sandbox, filename) {
  try {
    script.runInNewContext(sandbox, { timeout: EXEC_TIMEOUT_MS });
    return null;
  } catch (runErr) {
    return `${runErr.message}${extractLineInfo(runErr.stack, filename)}`;
  }
}

/**
 * Build a `require()` shim backed by the given module-registry Map.
 * Throws a descriptive error for unknown module names.
 * @param {Map<string, any>} moduleRegistry
 * @returns {(name: string) => any}
 */
function makeRequire(moduleRegistry) {
  return function requireModule(name) {
    if (!moduleRegistry.has(name)) {
      const available = [...moduleRegistry.keys()].join(", ");
      throw new Error(`Unknown module: "${name}". Available: ${available}`);
    }
    return moduleRegistry.get(name);
  };
}

/**
 * Build the full vm sandbox context for a custom script.
 * Merges the safe global subset, the service-specific API object, the script's
 * persistent state, and the require() shim.
 *
 * NOTE: `api.log` is used for all three console channels so that console output
 * from scripts is routed through the service's labelled logger.
 *
 * @param {object}           api            — service-specific api object
 * @param {object}           state          — persistent state for this script
 * @param {Map<string, any>} moduleRegistry — modules available via require()
 * @returns {object}
 */
function buildSandbox(api, state, moduleRegistry) {
  return {
    ...SANDBOX_GLOBALS,
    ...api,
    state,
    require: makeRequire(moduleRegistry),
    console: { log: api.log, warn: api.log, error: api.log }
  };
}

module.exports = { compileScript, runScript, makeRequire, buildSandbox, extractLineInfo };
