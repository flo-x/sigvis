"use strict";
/**
 * Validates a prebuilt configuration object against a parameter schema.
 *
 * @param {object[]} schema      - paramSchema array from the prebuilt definition
 * @param {object}   config      - key/value config supplied by the user
 * @param {Function} [validateFn] - optional domain validator from the prebuilt
 * @returns {object} Map of param name → error message string. Empty means valid.
 */
function validateConfig(schema, config, validateFn) {
  const errors = {};
  for (const param of schema) {
    const raw = config[param.name];
    const missing = raw === undefined || raw === null || raw === "";
    if (param.required && missing) {
      errors[param.name] = `"${param.label}" is required.`;
      continue;
    }
    if (missing) continue;
    if (param.type === "number") {
      const n = Number(raw);
      if (Number.isNaN(n)) { errors[param.name] = `"${param.label}" must be a number.`; continue; }
      if (param.min !== undefined && n < param.min) {
        errors[param.name] = `"${param.label}" must be ≥ ${param.min}.`;
        continue;
      }
      if (param.max !== undefined && n > param.max) {
        errors[param.name] = `"${param.label}" must be ≤ ${param.max}.`;
      }
    }
  }

  // Run prebuilt-supplied domain validation only after schema checks pass,
  // to avoid confusing cascading error messages.
  if (typeof validateFn === "function" && Object.keys(errors).length === 0) {
    try {
      const custom = validateFn(config) || {};
      Object.assign(errors, custom);
    } catch (err) {
      errors._ = `validateFn threw: ${err.message}`;
    }
  }

  return errors;
}

module.exports = { validateConfig };
