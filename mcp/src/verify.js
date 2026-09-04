// Check a Crosspeel response against the four rules Crosspeel states it holds
// itself to.
//
// This exists so the claim is checkable by the caller rather than taken on
// trust. It runs on the client side, against a response that has already
// arrived, and it needs nothing from Crosspeel to run.
//
//   1. No match is returned where confidence is below moderate.
//   2. Every price carries the date it was observed.
//   3. coverage is present.
//   4. limits are present, all four, unaltered.
//
// A violation is a defect in the server. Report it to disputes@crosspeel.com.

import { LIMITS } from './contract.js';

const RETURNABLE_CONFIDENCE = ['high', 'moderate'];

/**
 * @param {unknown} payload a tool response, structuredContent or the parsed text block
 * @returns {{ ok: boolean, violations: {rule: number, path: string, detail: string}[] }}
 */
export function verifyResponse(payload) {
  const violations = [];
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, violations: [{ rule: 0, path: '$', detail: 'the response was not an object' }] };
  }

  walk(payload, (node, path) => {
    // Rule 1
    if (Object.prototype.hasOwnProperty.call(node, 'confidence')) {
      const c = node.confidence;
      if (c !== null && c !== undefined && !RETURNABLE_CONFIDENCE.includes(c)) {
        violations.push({ rule: 1, path, detail: `confidence ${JSON.stringify(c)} was returned` });
      }
    }
    // Rule 2
    for (const [key, value] of Object.entries(node)) {
      if (!key.endsWith('_usd') || value === null || value === undefined) continue;
      const specific = `${key.slice(0, -'_usd'.length)}_observed_at`;
      const date = isNonEmptyString(node[specific]) ? node[specific] : node.observed_at;
      if (!isNonEmptyString(date)) {
        violations.push({ rule: 2, path: `${path}.${key}`, detail: 'a price was returned with no date' });
      }
    }
  });

  // Rule 3
  const coverage = payload.coverage;
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) {
    violations.push({ rule: 3, path: '$.coverage', detail: 'coverage is absent' });
  } else {
    for (const key of ['known', 'unknown']) {
      if (!Number.isInteger(coverage[key]) || coverage[key] < 0) {
        violations.push({ rule: 3, path: `$.coverage.${key}`, detail: 'coverage is not a count' });
      }
    }
  }

  // Rule 4
  if (!Array.isArray(payload.limits)) {
    violations.push({ rule: 4, path: '$.limits', detail: 'limits are absent' });
  } else if (payload.limits.length !== LIMITS.length) {
    violations.push({
      rule: 4,
      path: '$.limits',
      detail: `${payload.limits.length} constraints were returned and ${LIMITS.length} are published`,
    });
  } else {
    for (let i = 0; i < LIMITS.length; i++) {
      if (payload.limits[i] !== LIMITS[i]) {
        violations.push({ rule: 4, path: `$.limits[${i}]`, detail: 'a constraint differs from the published text' });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Same check, raising rather than reporting. For a caller that would rather stop
 * than act on a response that broke the rules.
 * @param {unknown} payload
 */
export function assertVerified(payload) {
  const { ok, violations } = verifyResponse(payload);
  if (!ok) {
    const lines = violations.map((v) => `rule ${v.rule} at ${v.path}: ${v.detail}`).join('; ');
    throw new Error(`the response did not hold to the published rules - ${lines}`);
  }
  return payload;
}

function walk(root, visit) {
  const seen = new Set();
  const stack = [[root, '$']];
  while (stack.length > 0) {
    const [node, path] = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((child, i) => stack.push([child, `${path}[${i}]`]));
      continue;
    }
    visit(node, path);
    for (const [key, child] of Object.entries(node)) {
      if (child !== null && typeof child === 'object') stack.push([child, `${path}.${key}`]);
    }
  }
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}
