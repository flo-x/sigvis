"use strict";

/**
 * Prebuilt catalog.
 *
 * Add new prebuilts by:
 *   1. Creating a new file in this directory.
 *   2. Requiring it here and pushing it into the CATALOG array.
 *
 * Each entry must conform to the PrebuiltDef shape:
 *   {
 *     id:          string       — unique slug, used as the key in the Map
 *     displayName: string       — shown in the UI dropdown
 *     kind:        "generator" | "processor"
 *     description: string       — shown in the UI
 *     paramSchema: ParamDef[]   — drives the dynamic config form
 *     initFn(state, config, api): void
 *     processFn(state, config, api): void
 *   }
 *
 * ParamDef shape:
 *   { name, label, type: "string"|"number", default, required?, min?, max? }
 */

const CATALOG_ARRAY = [
  require("./sine-generator"),
  require("./ema-processor"),
  require("./median-processor"),
];

/** Map<id, PrebuiltDef> */
const CATALOG = new Map(CATALOG_ARRAY.map((d) => [d.id, d]));

/**
 * Returns catalog metadata suitable for JSON serialisation (no functions).
 * @returns {{ id, displayName, kind, description, paramSchema }[]}
 */
function getCatalogMeta() {
  return CATALOG_ARRAY.map(({ id, displayName, kind, description, paramSchema }) => ({
    id, displayName, kind, description, paramSchema
  }));
}

module.exports = { CATALOG, getCatalogMeta };
