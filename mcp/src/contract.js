// The published tool contract, loaded from the schema files beside it.
//
// The schemas are the contract. This file only reads them, so a change to a
// schema changes the client with no second edit.

import manifest from '../schemas/tools.json' with { type: 'json' };
import limits from '../schemas/limits.json' with { type: 'json' };
import checkStackOutput from '../schemas/check_stack.output.schema.json' with { type: 'json' };
import getClusterOutput from '../schemas/get_cluster.output.schema.json' with { type: 'json' };
import cheapestEquivalentOutput from '../schemas/cheapest_equivalent.output.schema.json' with { type: 'json' };

export const CONTRACT_VERSION = manifest.contract_version;
export const SERVER = Object.freeze({ ...manifest.server });
export const PROTOCOL_VERSIONS = Object.freeze([...manifest.protocol_versions]);
export const PAYMENT = Object.freeze({ ...manifest.payment });
export const TOOLS = Object.freeze(manifest.tools.map((t) => Object.freeze({ ...t })));
export const TOOL_NAMES = Object.freeze(TOOLS.map((t) => t.name));

/** What the method cannot see. The same four constraints the server returns. */
export const LIMITS = Object.freeze([...limits.limits]);
export const METHOD_VERSION = limits.method_version;

export const OUTPUT_SCHEMAS = Object.freeze({
  check_stack: checkStackOutput,
  get_cluster: getClusterOutput,
  cheapest_equivalent: cheapestEquivalentOutput,
});

/** @param {string} name */
export function toolDefinition(name) {
  return TOOLS.find((t) => t.name === name) || null;
}
