/* Independent verification of runbook step D1 - design tokens and self-hosted fonts.
 *
 * These tests were written by a sub-agent that did not write the CSS, from
 * document 01 and the declared interface only, per the separation rule in
 * document 09. They assert over the delivered file contents rather than over a
 * rendered page, because document 01 is a specification about the source.
 *
 * Root override. CROSSPEEL_D1_ROOT points the whole suite at a different tree.
 * It exists so the suite can be observed failing against a deliberately broken
 * duplicate of the design layer before it is run against the real files - the
 * failing-first rule in document 09. It defaults to this repository, and
 * nothing in the build reads it.
 *
 * Several word lists below are assembled from fragments at runtime. That is not
 * obfuscation for its own sake: this repository is public, and a test that
 * searches the tree for a word would otherwise match itself and report a false
 * positive, while the document 07 list would be sitting in a public file.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.CROSSPEEL_D1_ROOT
  ? path.resolve(process.env.CROSSPEEL_D1_ROOT)
  : path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const STYLES = path.join(ROOT, 'src', 'styles');
const PUBLIC = path.join(ROOT, 'public');

const tokensPath = path.join(STYLES, 'tokens.css');
const basePath = path.join(STYLES, 'base.css');

const tokensRaw = fs.readFileSync(tokensPath, 'utf8');
const baseRaw = fs.readFileSync(basePath, 'utf8');

/* ---------- helpers ---------- */

// Comments carry prose from document 01 that quotes values and banned words.
// Every assertion about what the CSS does runs against the stripped text.
function strip(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const tokens = strip(tokensRaw);
const base = strip(baseRaw);

// Minimal rule extractor. Sufficient for hand-written CSS with no strings
// containing braces, which is what document 01 mandates. At-rule blocks are
// returned with their selector so @font-face and @media can be filtered.
function extractRules(css) {
  const out = [];
  const stack = [];
  let buf = '';
  for (const c of css) {
    if (c === '{') {
      stack.push(buf.trim());
      buf = '';
    } else if (c === '}') {
      const selector = stack.pop();
      if (selector !== undefined) out.push({ selector, body: buf });
      buf = '';
    } else {
      buf += c;
    }
  }
  return out;
}

function declarations(body) {
  return body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':');
      if (i === -1) return null;
      return { prop: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim() };
    })
    .filter(Boolean);
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.astro', 'dist', 'coverage', '.wrangler', '.vercel',
]);
const BINARY_EXT = new Set([
  '.woff2', '.woff', '.ttf', '.otf', '.eot', '.png', '.jpg', '.jpeg', '.gif',
  '.webp', '.ico', '.pdf', '.zip', '.avif', '.mp4', '.sqlite',
]);

function walkTextFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkTextFiles(full, acc);
    } else if (entry.isFile()) {
      if (BINARY_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      acc.push(full);
    }
  }
  return acc;
}

const allTextFiles = walkTextFiles(ROOT);
const styleSourceFiles = allTextFiles.filter((f) =>
  ['.css', '.astro', '.html', '.svelte', '.vue', '.jsx', '.tsx'].includes(
    path.extname(f).toLowerCase(),
  ),
);

function rel(f) {
  return path.relative(ROOT, f);
}

/* ---------- 1. colour ---------- */

// The seven values, transcribed from document 01 part two, "Colour is semantic,
// not decorative". Seven values. There is no eighth.
const SEVEN_COLOURS = [
  ['--page', '#FAFBF9'],
  ['--field', '#EFF2EE'],
  ['--rule', '#CFD6D0'],
  ['--ink', '#14201B'],
  ['--ink-2', '#55635C'],
  ['--delta', '#2B3A8F'],
  ['--delta-wash', '#E8EAF5'],
];

describe('T1 colour - exactly the seven documented tokens, no eighth', () => {
  for (const [name, value] of SEVEN_COLOURS) {
    it(`defines ${name} as ${value}`, () => {
      const re = new RegExp(`${name.replace('-', '\\-')}\\s*:\\s*(#[0-9A-Fa-f]{3,8})\\s*;`);
      const m = tokens.match(re);
      expect(m, `${name} is not defined in tokens.css`).not.toBeNull();
      expect(m[1].toUpperCase()).toBe(value);
    });
  }

  it('defines each of the seven exactly once', () => {
    for (const [name] of SEVEN_COLOURS) {
      const count = (tokens.match(new RegExp(`${name.replace('-', '\\-')}\\s*:`, 'g')) || []).length;
      expect(count, `${name} is declared ${count} times in tokens.css`).toBe(1);
    }
  });

  it('contains no eighth colour value anywhere in tokens.css', () => {
    const found = (tokens.match(/#[0-9A-Fa-f]{3,8}\b/g) || []).map((h) => h.toUpperCase());
    const documented = new Set(SEVEN_COLOURS.map(([, v]) => v));
    const extra = found.filter((h) => !documented.has(h));
    expect(extra, `undocumented colour literals in tokens.css: ${extra.join(', ')}`).toEqual([]);
    expect(new Set(found).size).toBe(7);
  });

  it('uses no colour function in tokens.css', () => {
    const fns = tokens.match(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/gi) || [];
    expect(fns, `colour functions found: ${fns.join(', ')}`).toEqual([]);
  });

  it('uses no CSS named colour in tokens.css', () => {
    // A short list is enough - any named colour would be an eighth value, and
    // these are the ones a generated palette reaches for.
    const named = [
      'red', 'blue', 'green', 'black', 'white', 'grey', 'gray', 'orange',
      'amber', 'yellow', 'purple', 'teal', 'navy', 'crimson', 'gold', 'silver',
      'aqua', 'fuchsia', 'lime', 'maroon', 'olive', 'tomato', 'salmon', 'plum',
    ];
    const hits = named.filter((n) => new RegExp(`:\\s*[^;{]*\\b${n}\\b`, 'i').test(tokens));
    expect(hits, `named colours found in tokens.css: ${hits.join(', ')}`).toEqual([]);
  });

  it('introduces no colour literal in base.css - every colour resolves to a token', () => {
    const hex = baseRaw.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9A-Fa-f]{3,8}\b/g) || [];
    expect(hex, `base.css declares raw colours: ${hex.join(', ')}`).toEqual([]);
    const fns = base.match(/\b(rgba?|hsla?|oklch)\s*\(/gi) || [];
    expect(fns, `base.css uses colour functions: ${fns.join(', ')}`).toEqual([]);
  });
});

describe('T1 colour - contrast at WCAG AA minimum for all text', () => {
  const value = (name) => {
    const m = tokens.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})\\s*;`));
    return m ? m[1] : null;
  };

  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };

  const luminance = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return (
      0.2126 * channel((n >> 16) & 255) +
      0.7152 * channel((n >> 8) & 255) +
      0.0722 * channel(n & 255)
    );
  };

  const ratio = (a, b) => {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  // Every text token against every surface it is specified to sit on.
  const TEXT_PAIRS = [
    ['--ink', '--page'],
    ['--ink-2', '--page'],
    ['--delta', '--page'],
    ['--ink', '--field'],
    ['--ink-2', '--field'],
    ['--delta', '--delta-wash'],
    ['--ink', '--delta-wash'],
  ];

  for (const [fg, bg] of TEXT_PAIRS) {
    it(`${fg} on ${bg} meets 4.50 to 1`, () => {
      const a = value(fg);
      const b = value(bg);
      expect(a, `${fg} is not defined`).toBeTruthy();
      expect(b, `${bg} is not defined`).toBeTruthy();
      const r = ratio(a, b);
      expect(
        r,
        `${fg} on ${bg} is ${r.toFixed(2)} to 1, below the 4.50 AA minimum`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});

/* ---------- 2. type scale ---------- */

// Scale, in rem on a 16px root, from document 01 part two, "Type".
const TYPE_SCALE = [
  ['display', '2.25rem', '1.15'],
  ['h2', '1.50rem', '1.25'],
  ['h3', '1.125rem', '1.30'],
  ['body', '1.00rem', '1.55'],
  ['small', '0.875rem', '1.45'],
  ['data', '0.875rem', '1.40'],
  ['micro', '0.75rem', '1.40'],
];

function numericRem(value) {
  const m = String(value).trim().match(/^([0-9.]+)rem$/);
  return m ? Number(m[1]) : NaN;
}

describe('T1 type - every documented step exists at its documented size and leading', () => {
  for (const [step, size, leading] of TYPE_SCALE) {
    it(`--size-${step} is ${size} and --leading-${step} is ${leading}`, () => {
      const sizeMatch = tokens.match(new RegExp(`--size-${step}\\s*:\\s*([^;]+);`));
      const leadMatch = tokens.match(new RegExp(`--leading-${step}\\s*:\\s*([^;]+);`));
      expect(sizeMatch, `--size-${step} is not defined`).not.toBeNull();
      expect(leadMatch, `--leading-${step} is not defined`).not.toBeNull();
      // Compare numerically so 1.50rem and 1.5rem are both acceptable, but a
      // different step is not.
      expect(numericRem(sizeMatch[1])).toBeCloseTo(numericRem(size), 5);
      expect(Number(leadMatch[1].trim())).toBeCloseTo(Number(leading), 5);
    });
  }

  it('defines no type step outside the seven documented ones', () => {
    const sizes = [...tokens.matchAll(/--size-([a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    const leadings = [...tokens.matchAll(/--leading-([a-z0-9-]+)\s*:/g)].map((m) => m[1]);
    const documented = new Set(TYPE_SCALE.map(([s]) => s));
    expect(sizes.filter((s) => !documented.has(s))).toEqual([]);
    expect(leadings.filter((s) => !documented.has(s))).toEqual([]);
    expect(sizes.length).toBe(7);
    expect(leadings.length).toBe(7);
  });

  it('ships only weight 400 and weight 600', () => {
    expect(tokens).toMatch(/--weight-regular\s*:\s*400\s*;/);
    expect(tokens).toMatch(/--weight-semibold\s*:\s*600\s*;/);
    expect(tokens).not.toMatch(/--weight-[a-z]+\s*:\s*(100|200|300|500|700|800|900)\s*;/);
  });

  it('declares both Plex families with a fallback stack', () => {
    expect(tokens).toMatch(/--font-sans\s*:\s*"IBM Plex Sans"\s*,/);
    expect(tokens).toMatch(/--font-mono\s*:\s*"IBM Plex Mono"\s*,/);
    expect(tokens).toMatch(/--font-sans\s*:[^;]*sans-serif\s*;/);
    expect(tokens).toMatch(/--font-mono\s*:[^;]*monospace\s*;/);
  });
});

describe('T2 type - base.css binds the element defaults to the scale tokens', () => {
  const rules = extractRules(base);
  // The reset lists every heading in one selector, so match on the rule that
  // actually sets type rather than on the first rule naming the element.
  const find = (selector) =>
    rules.find(
      (r) =>
        r.selector.split(',').map((s) => s.trim()).includes(selector) &&
        /font-size\s*:/.test(r.body),
    );

  const bindings = [
    ['h1', 'display'],
    ['h2', 'h2'],
    ['h3', 'h3'],
    ['body', 'body'],
  ];

  for (const [selector, step] of bindings) {
    it(`${selector} uses --size-${step} and --leading-${step}`, () => {
      const rule = find(selector);
      expect(rule, `no rule for ${selector} in base.css`).toBeTruthy();
      expect(rule.body).toContain(`var(--size-${step})`);
      expect(rule.body).toContain(`var(--leading-${step})`);
    });
  }

  it('.data and .micro are mono at the data and micro steps', () => {
    const dataRule = rules.find((r) => r.selector.includes('.data') && r.body.includes('font-family'));
    const microRule = rules.find((r) => r.selector.includes('.micro') && r.body.includes('font-family'));
    expect(dataRule, 'no .data typography rule').toBeTruthy();
    expect(microRule, 'no .micro typography rule').toBeTruthy();
    expect(dataRule.body).toContain('var(--font-mono)');
    expect(dataRule.body).toContain('var(--size-data)');
    expect(microRule.body).toContain('var(--font-mono)');
    expect(microRule.body).toContain('var(--size-micro)');
  });

  it('sets tabular figures on the number-bearing selectors', () => {
    const rule = rules.find((r) => /font-variant-numeric\s*:\s*tabular-nums/.test(r.body));
    expect(rule, 'no tabular-nums rule in base.css').toBeTruthy();
    for (const selector of ['th', 'td', 'time', '.data', '.micro', '.num', '.tabular']) {
      const covered = rules.some(
        (r) =>
          /font-variant-numeric\s*:\s*tabular-nums/.test(r.body) &&
          r.selector.split(',').map((s) => s.trim()).includes(selector),
      );
      expect(covered, `${selector} does not carry tabular-nums`).toBe(true);
    }
  });
});

/* ---------- 3. shadows ---------- */

function shadowLayers(value) {
  return value.split(',').map((layer) => layer.trim());
}

// Blur is the third length in a box-shadow layer. Document 01: elevation is
// communicated by rule weight and background, never by blur.
function blurOf(layer) {
  const lengths = layer.replace(/\binset\b/gi, '').match(/-?\d*\.?\d+(?:px|rem|em|%)?/g) || [];
  if (lengths.length < 3) return 0;
  return parseFloat(lengths[2]);
}

describe('T1 shadow - shadows do not exist in this system', () => {
  it('declares no box-shadow anywhere in the design layer', () => {
    expect(tokens, 'tokens.css declares a box-shadow').not.toMatch(/box-shadow/i);
    expect(base, 'base.css declares a box-shadow').not.toMatch(/box-shadow/i);
  });

  it('declares no text-shadow or drop-shadow filter in the design layer', () => {
    expect(tokens).not.toMatch(/text-shadow|drop-shadow/i);
    expect(base).not.toMatch(/text-shadow|drop-shadow/i);
  });

  it('contains no rgba black shadow anywhere in the repository', () => {
    const offenders = [];
    for (const file of allTextFiles) {
      const text = fs.readFileSync(file, 'utf8');
      if (/rgba?\(\s*0\s*[, ]\s*0\s*[, ]\s*0\s*[,/ )]/i.test(text)) offenders.push(rel(file));
    }
    expect(offenders, `rgba black found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('contains no blurred shadow anywhere in the repository', () => {
    const offenders = [];
    for (const file of styleSourceFiles) {
      const text = strip(fs.readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/box-shadow\s*:\s*([^;}]+)/gi)) {
        for (const layer of shadowLayers(m[1])) {
          if (/^none$/i.test(layer.trim())) continue;
          if (blurOf(layer) !== 0) offenders.push(`${rel(file)}: ${layer}`);
        }
      }
      for (const m of text.matchAll(/text-shadow\s*:\s*([^;}]+)/gi)) {
        if (!/^none$/i.test(m[1].trim())) offenders.push(`${rel(file)}: text-shadow ${m[1]}`);
      }
      for (const m of text.matchAll(/drop-shadow\s*\(([^)]*)\)/gi)) {
        offenders.push(`${rel(file)}: drop-shadow(${m[1]})`);
      }
    }
    expect(offenders, `blurred shadows found: ${offenders.join(' | ')}`).toEqual([]);
  });

  // Reported separately so the box-shadow declarations that do exist outside
  // the design layer are named in the output rather than absorbed by the blur
  // test and never surfaced.
  it('every box-shadow outside the design layer is a zero-blur hairline in a token colour', () => {
    const seen = [];
    for (const file of styleSourceFiles) {
      if (file === tokensPath || file === basePath) continue;
      const text = strip(fs.readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/box-shadow\s*:\s*([^;}]+)/gi)) {
        for (const layer of shadowLayers(m[1])) {
          seen.push(`${rel(file)}: ${layer}`);
          expect(blurOf(layer), `${rel(file)} draws a blurred shadow: ${layer}`).toBe(0);
          expect(layer, `${rel(file)} draws a shadow in a non-token colour: ${layer}`).toMatch(
            /var\(--(page|field|rule|ink|ink-2|delta|delta-wash)\)/,
          );
        }
      }
    }
    // Not an assertion, a record. The count appears in the run output.
    expect(Array.isArray(seen)).toBe(true);
  });
});

/* ---------- 4. banned frameworks ---------- */

describe('T1 frameworks - no utility CSS framework, no component library', () => {
  it('no banned framework name appears anywhere in the repository', () => {
    // Assembled at runtime so this test file does not itself contain the
    // literal strings it searches for, which would guarantee a false positive.
    const banned = ['tail' + 'wind', 'shad' + 'cn'];
    const offenders = [];
    for (const file of allTextFiles) {
      const text = fs.readFileSync(file, 'utf8').toLowerCase();
      for (const word of banned) {
        if (text.includes(word)) offenders.push(`${rel(file)} contains ${word}`);
      }
    }
    expect(offenders, offenders.join(' | ')).toEqual([]);
  });

  it('declares no CSS framework or component library dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
    const banned = deps.filter((d) =>
      /^(tail|shad|bootstrap|bulma|foundation|@radix-ui|@mui|antd|chakra|daisy|unocss|windi)/i.test(d),
    );
    expect(banned, `framework dependencies declared: ${banned.join(', ')}`).toEqual([]);
  });
});

/* ---------- 5. self-hosted fonts ---------- */

const fontFaces = [...baseRaw.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
  const body = strip(m[1]);
  const get = (prop) => {
    const hit = body.match(new RegExp(`${prop}\\s*:\\s*([^;]+);`, 'i'));
    return hit ? hit[1].trim() : null;
  };
  return {
    body,
    family: (get('font-family') || '').replace(/["']/g, ''),
    weight: get('font-weight'),
    style: get('font-style'),
    display: get('font-display'),
    urls: [...body.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((u) => u[1].trim()),
  };
});

describe('T1 fonts - three faces, self-hosted, no runtime third-party request', () => {
  it('declares exactly three @font-face rules', () => {
    expect(fontFaces.length).toBe(3);
  });

  it('declares sans 400, sans 600 and mono 400 and nothing else', () => {
    const got = fontFaces.map((f) => `${f.family} ${f.weight} ${f.style}`).sort();
    expect(got).toEqual([
      'IBM Plex Mono 400 normal',
      'IBM Plex Sans 400 normal',
      'IBM Plex Sans 600 normal',
    ]);
  });

  it('declares no italic face and no weight 700', () => {
    expect(baseRaw).not.toMatch(/font-style\s*:\s*italic/i);
    for (const face of fontFaces) {
      expect(['400', '600']).toContain(String(face.weight));
    }
  });

  it('sets font-display: swap on every face', () => {
    for (const face of fontFaces) {
      expect(face.display, `${face.family} ${face.weight} has font-display ${face.display}`).toBe('swap');
    }
  });

  it('serves every face from a local path under /fonts/, never over http or https', () => {
    for (const face of fontFaces) {
      expect(face.urls.length, `${face.family} ${face.weight} declares no src url`).toBeGreaterThan(0);
      for (const url of face.urls) {
        expect(url, `${face.family} ${face.weight} loads a remote font: ${url}`).not.toMatch(/^(https?:)?\/\//i);
        expect(url, `${face.family} ${face.weight} src is not under /fonts/: ${url}`).toMatch(/^\/fonts\//);
        expect(url).toMatch(/\.woff2$/);
      }
    }
  });

  it('names no font CDN anywhere in the design layer', () => {
    for (const [name, text] of [['tokens.css', tokensRaw], ['base.css', baseRaw]]) {
      expect(text, `${name} references a font CDN`).not.toMatch(
        /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit|cdn\.jsdelivr|unpkg\.com/i,
      );
    }
  });
});

describe('T4 fonts - every declared src resolves to a real woff2 on disk', () => {
  for (const face of fontFaces) {
    for (const url of face.urls) {
      it(`${url} exists in public/ and is a woff2 file`, () => {
        const onDisk = path.join(PUBLIC, url.replace(/^\//, ''));
        expect(fs.existsSync(onDisk), `${url} is declared but ${rel(onDisk)} does not exist`).toBe(true);
        const magic = fs.readFileSync(onDisk).subarray(0, 4).toString('latin1');
        expect(magic, `${rel(onDisk)} is not a woff2 file`).toBe('wOF2');
        expect(fs.statSync(onDisk).size).toBeGreaterThan(1024);
      });
    }
  }

  it('ships no font file that no @font-face rule names', () => {
    const declared = new Set(fontFaces.flatMap((f) => f.urls.map((u) => path.basename(u))));
    const dir = path.join(PUBLIC, 'fonts');
    const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith('.')) : [];
    expect(onDisk.length).toBe(3);
    for (const file of onDisk) {
      expect(declared.has(file), `${file} is shipped but no @font-face names it`).toBe(true);
    }
  });
});

/* ---------- 6. border radius ---------- */

const CONTROL_SELECTORS = new Set([
  'input', 'textarea', 'select', 'button',
  '[type="button"]', '[type="submit"]', '[type="reset"]',
  "[type='button']", "[type='submit']", "[type='reset']",
]);

describe('T1 radius - 2px on inputs and buttons only, 0 everywhere else', () => {
  it('--radius is 0 and --radius-control is 2px', () => {
    expect(tokens).toMatch(/--radius\s*:\s*0\s*;/);
    expect(tokens).toMatch(/--radius-control\s*:\s*2px\s*;/);
  });

  it('every border-radius declaration in base.css is either the control radius on controls, or zero', () => {
    const rules = extractRules(base).filter((r) => /border-radius/.test(r.body));
    expect(rules.length, 'base.css declares no border-radius at all').toBeGreaterThan(0);

    for (const rule of rules) {
      const value = declarations(rule.body).find((d) => d.prop === 'border-radius').value;
      const selectors = rule.selector.split(',').map((s) => s.trim()).filter(Boolean);
      const allControls = selectors.every((s) => CONTROL_SELECTORS.has(s));

      if (allControls) {
        expect(value, `control radius on "${rule.selector}" is ${value}`).toMatch(
          /^(var\(--radius-control\)|2px)$/,
        );
      } else {
        expect(value, `non-control selector "${rule.selector}" sets radius ${value}`).toMatch(
          /^(var\(--radius\)|0|0px)$/,
        );
      }
    }
  });

  it('the control override covers every control selector documented in 01', () => {
    const rules = extractRules(base).filter(
      (r) => /border-radius/.test(r.body) && /var\(--radius-control\)|2px/.test(r.body),
    );
    const covered = new Set(rules.flatMap((r) => r.selector.split(',').map((s) => s.trim())));
    for (const selector of ['input', 'textarea', 'select', 'button']) {
      expect(covered.has(selector), `${selector} does not receive the 2px control radius`).toBe(true);
    }
  });

  it('no file outside the design layer sets a border-radius', () => {
    const offenders = [];
    for (const file of styleSourceFiles) {
      if (file === tokensPath || file === basePath) continue;
      const text = strip(fs.readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/border-radius\s*:\s*([^;}]+)/gi)) {
        const value = m[1].trim();
        if (!/^(var\(--radius\)|var\(--radius-control\)|0|0px)$/.test(value)) {
          offenders.push(`${rel(file)}: border-radius: ${value}`);
        }
      }
    }
    expect(offenders, offenders.join(' | ')).toEqual([]);
  });
});

/* ---------- 7. focus ---------- */

describe('T1 focus - a visible keyboard focus style on every interactive element', () => {
  const rules = extractRules(base);
  const focusRules = rules.filter((r) => /:focus/.test(r.selector));

  it('declares a visible outline on :focus and on :focus-visible', () => {
    const visible = (needle) =>
      focusRules.filter((r) => {
        const selectors = r.selector.split(',').map((s) => s.trim());
        const matches = selectors.some((s) => s === needle || s.endsWith(needle));
        if (!matches) return false;
        const outline = declarations(r.body).find((d) => d.prop === 'outline');
        return outline && !/^(none|0|0px)$/i.test(outline.value);
      });

    expect(visible(':focus').length, 'no visible :focus outline in base.css').toBeGreaterThan(0);
    expect(visible(':focus-visible').length, 'no visible :focus-visible outline in base.css').toBeGreaterThan(0);
  });

  it('draws the focus ring at 2px in a token colour with an offset', () => {
    const ring = focusRules.find((r) => {
      const outline = declarations(r.body).find((d) => d.prop === 'outline');
      return outline && !/^(none|0|0px)$/i.test(outline.value);
    });
    const outline = declarations(ring.body).find((d) => d.prop === 'outline').value;
    expect(outline).toMatch(/^2px solid var\(--(ink|ink-2)\)$/);
    const offset = declarations(ring.body).find((d) => d.prop === 'outline-offset');
    expect(offset, 'focus ring has no outline-offset').toBeTruthy();
    expect(offset.value).toBe('2px');
  });

  it('never removes the outline without a replacement', () => {
    for (const rule of rules) {
      const outline = declarations(rule.body).find((d) => d.prop === 'outline');
      if (!outline || !/^(none|0|0px)$/i.test(outline.value)) continue;

      // Permitted only in the standard :focus:not(:focus-visible) pattern, where
      // a matching :focus-visible rule draws the ring, or where the same rule
      // substitutes a visible ring of its own.
      const guarded = /:not\(\s*:focus-visible\s*\)/.test(rule.selector);
      const substitute = /box-shadow|border-color|background/.test(rule.body);
      expect(
        guarded || substitute,
        `"${rule.selector}" sets outline: ${outline.value} with no replacement`,
      ).toBe(true);

      if (guarded) {
        const replacement = rules.some(
          (r) =>
            /:focus-visible/.test(r.selector) &&
            !/:not\(/.test(r.selector) &&
            (declarations(r.body).find((d) => d.prop === 'outline') || { value: 'none' }).value !==
              'none',
        );
        expect(replacement, `"${rule.selector}" is guarded but no :focus-visible rule draws a ring`).toBe(true);
      }
    }
  });

  it('the skip link becomes visible on focus', () => {
    const skip = rules.find((r) => r.selector.includes('.skip-link') && r.selector.includes(':focus'));
    expect(skip, 'no .skip-link:focus rule').toBeTruthy();
    expect(skip.body).toMatch(/transform\s*:\s*translateY\(\s*0\s*\)/);
  });
});

/* ---------- 8. spacing, borders, layout ---------- */

describe('T1 spacing, borders and layout tokens', () => {
  const SPACING = [
    ['--space-8', 0.5], ['--space-16', 1], ['--space-24', 1.5],
    ['--space-40', 2.5], ['--space-64', 4], ['--space-96', 6],
  ];

  for (const [name, rem] of SPACING) {
    it(`${name} is ${rem.toFixed(2)}rem`, () => {
      const m = tokens.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
      expect(m, `${name} is not defined`).not.toBeNull();
      expect(numericRem(m[1])).toBeCloseTo(rem, 5);
    });
  }

  it('defines no spacing step outside 8, 16, 24, 40, 64, 96', () => {
    const steps = [...tokens.matchAll(/--space-(\d+)\s*:/g)].map((m) => m[1]);
    expect(steps.sort((a, b) => a - b)).toEqual(['8', '16', '24', '40', '64', '96'].sort((a, b) => a - b));
  });

  it('borders are 1px solid var(--rule)', () => {
    expect(tokens).toMatch(/--border-width\s*:\s*1px\s*;/);
    expect(tokens).toMatch(/--border\s*:\s*var\(--border-width\)\s+solid\s+var\(--rule\)\s*;/);
  });

  it('defines the two documented widths', () => {
    expect(tokens).toMatch(/--measure\s*:\s*68ch\s*;/);
    expect(tokens).toMatch(/--width-full\s*:\s*1200px\s*;/);
  });

  it('the page container is the only centred element', () => {
    const rules = extractRules(base);
    const centred = rules.filter((r) => /margin-inline\s*:\s*auto|margin\s*:\s*0 auto|text-align\s*:\s*center/.test(r.body));
    for (const rule of centred) {
      expect(rule.selector, `"${rule.selector}" is centred`).toContain('.container');
    }
    const container = rules.find((r) => r.selector.trim() === '.container');
    expect(container, 'no .container rule').toBeTruthy();
    expect(container.body).toContain('var(--width-full)');
  });

  it('.prose is capped at the 68ch measure', () => {
    const rules = extractRules(base);
    const prose = rules.find((r) => r.selector.trim() === '.prose');
    expect(prose, 'no .prose rule').toBeTruthy();
    expect(prose.body).toMatch(/max-width\s*:\s*var\(--measure\)/);
  });

  it('honours prefers-reduced-motion', () => {
    expect(base).toMatch(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/);
    const block = base.match(/@media\s*\([^)]*prefers-reduced-motion[^)]*\)\s*\{([\s\S]*?\})\s*\}/);
    expect(block, 'reduced-motion block is empty').not.toBeNull();
    expect(block[1]).toMatch(/animation-duration/);
    expect(block[1]).toMatch(/transition-duration/);
  });
});

/* ---------- 9. house rules from 00 and 07 ---------- */

describe('T1 house rules - banned words, emojis and attribution', () => {
  it('the design layer carries no accusatory word from document 07', () => {
    // Assembled from fragments. The literals do not belong in a public file,
    // and a test file containing them would match its own scan.
    const banned = [
      'resell' + 'er', 'wrap' + 'per', 'fak' + 'e', 'sca' + 'm', 'rip-' + 'off',
      'middle' + 'man', 'goug' + 'ing', 'decept' + 'ive', 'mislead' + 'ing',
      'expos' + 'ed', 'the same ' + 'company',
    ];
    for (const [name, text] of [['tokens.css', tokensRaw], ['base.css', baseRaw]]) {
      for (const word of banned) {
        expect(
          new RegExp(`\\b${word}\\b`, 'i').test(text),
          `${name} contains the banned word "${word}"`,
        ).toBe(false);
      }
    }
  });

  it('the design layer contains no emoji and no em dash', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const [name, text] of [['tokens.css', tokensRaw], ['base.css', baseRaw]]) {
      expect(emoji.test(text), `${name} contains an emoji`).toBe(false);
      expect(text.includes('—'), `${name} contains an em dash`).toBe(false);
    }
  });

  it('the design layer carries no AI attribution', () => {
    for (const [name, text] of [['tokens.css', tokensRaw], ['base.css', baseRaw]]) {
      expect(
        /claude|anthropic|generated by|co-authored-by|gpt|copilot/i.test(text),
        `${name} carries an attribution marker`,
      ).toBe(false);
    }
  });
});
