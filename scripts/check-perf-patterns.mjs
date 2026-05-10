#!/usr/bin/env node
// Lint estático de anti-patrones de performance.
//
// Las reglas viven en docs/performance-canon.md. Este script las hace
// mecánicas: cada violación es un error de build (mismo gate que
// check-imports + check-js-siblings). No hay warnings — la regla pasa
// o no pasa.
//
// Para excepciones legítimas, usar el comentario marker `// PERF-EXEMPT:
// <razón corta>` en la misma línea o la inmediatamente anterior.
import fs from "fs/promises";
import path from "path";

const root = process.cwd();
const startDirs = ["apps", "packages"];
const IGNORES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  "tests",
]);
const FILE_EXT = /\.(ts|tsx)$/i;
const EXEMPT_RE = /\bPERF-EXEMPT\b/;

// Pixi DisplayObject names that should never be `new`-ed in steady-state.
// They may only be constructed inside the createPlaylistRenderer init
// block (one-shot at construction). Files allowed to do that listed below.
const PIXI_CONSTRUCTOR_RE =
  /\bnew\s+(Text|Sprite|Graphics|Container|Mesh|TilingSprite)\s*\(/g;
const PIXI_CONSTRUCTOR_ALLOWED_FILES = new Set([
  // Renderer init owns all DisplayObjects.
  "packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts",
]);

// Idempotency-required actions. The reducer cases for these must contain a
// short-circuit return BEFORE building a new state object. Static check
// uses a window of the next ~6 lines after the case label.
const IDEMPOTENT_ACTIONS = [
  "ADVANCE_PLAY_POSITION",
  "SET_HOVER",
  "SET_PLAY_POSITION",
  "SET_PLAY_RUNNING",
  "SET_VIEWPORT_SIZE",
  "UPDATE_VIEWPORT",
  "SET_TOOL",
  "SET_SNAP_MODE",
  "SET_STRETCH_MODE",
  "SET_TRANSPORT_MODE",
];

// Files where the reducer cases live. If new files appear, add here.
const REDUCER_FILES = new Set([
  "packages/canvas/src/playlist-core/reducer.ts",
]);

// Infinity caps in getMaxScroll* outside geometry.ts are regressions.
const SCROLL_CAP_RE =
  /\bgetMax(?:Horizontal|Vertical)?Scroll[XY]\s*[\s\S]{0,80}?return\s+(\d|Math\.max)/g;

// Runaway `while (acc < bottom)` loops that don't pre-skip should be
// flagged. Heuristic: look for `while.*?<.*?bottom` and require a `skip`
// or `Math.floor` within ~3 lines before. Easy to false-positive; we'll
// only warn on files outside the renderer/presentation that already
// document the pattern.
// Keep this off until we have a stable false-positive rate; the canon
// has the rule and tests catch regressions.

async function walk(dir, files = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const e of entries) {
    if (IGNORES.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, files);
    } else if (FILE_EXT.test(e.name)) {
      files.push(full);
    }
  }
  return files;
}

function lineOf(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function isLineExempt(content, index) {
  // Check the line containing `index` and the previous one for PERF-EXEMPT.
  const before = content.slice(0, index);
  const after = content.slice(index);
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineEnd = index + after.indexOf("\n");
  const line = content.slice(lineStart, lineEnd >= index ? lineEnd : content.length);
  if (EXEMPT_RE.test(line)) return true;
  const prevLineEnd = before.lastIndexOf("\n");
  if (prevLineEnd <= 0) return false;
  const prevLineStart = before.lastIndexOf("\n", prevLineEnd - 1) + 1;
  const prev = content.slice(prevLineStart, prevLineEnd);
  return EXEMPT_RE.test(prev);
}

function checkPixiConstructors(file, content) {
  const violations = [];
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (PIXI_CONSTRUCTOR_ALLOWED_FILES.has(rel)) {
    return violations;
  }
  // Don't flag react/dom code or non-canvas packages — restrict to canvas src.
  if (!rel.startsWith("packages/canvas/src/")) {
    return violations;
  }
  PIXI_CONSTRUCTOR_RE.lastIndex = 0;
  let m;
  while ((m = PIXI_CONSTRUCTOR_RE.exec(content)) !== null) {
    if (isLineExempt(content, m.index)) continue;
    violations.push({
      file,
      line: lineOf(content, m.index),
      rule: "pixi-constructor-outside-renderer-init",
      detail: `\`new ${m[1]}(\` only allowed inside renderer-impl.ts init block; use the pool helper.`,
    });
  }
  return violations;
}

function checkIdempotentReducerCases(file, content) {
  const violations = [];
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (!REDUCER_FILES.has(rel)) return violations;
  for (const actionType of IDEMPOTENT_ACTIONS) {
    const caseRe = new RegExp(`case\\s+"${actionType}"\\s*:`, "g");
    let m;
    while ((m = caseRe.exec(content)) !== null) {
      const startIdx = m.index;
      // Window: next 1200 chars (covers most case bodies).
      const window = content.slice(startIdx, startIdx + 1200);
      // Idempotency evidence: any of these patterns proves the case can
      // bail with the input state unchanged before allocating.
      //   - `return state;` or `return state\n}`
      //   - `? state :` (ternary returning the input state)
      //   - explicit PERF-EXEMPT marker
      const hasShortCircuit =
        /\breturn\s+state\b[\s;}]/.test(window) ||
        /\?\s*state\s*:/.test(window) ||
        EXEMPT_RE.test(window);
      if (hasShortCircuit) continue;
      violations.push({
        file,
        line: lineOf(content, startIdx),
        rule: "non-idempotent-hot-action",
        detail: `Action "${actionType}" is invoked at ≥30Hz; the reducer case must short-circuit (return state / ? state :) when nothing changed. See docs/performance-canon.md §4.`,
      });
    }
  }
  return violations;
}

function checkScrollCapRegression(file, content) {
  const violations = [];
  const rel = path.relative(root, file).replace(/\\/g, "/");
  if (
    rel === "packages/canvas/src/playlist-core/geometry.ts" ||
    rel === "docs/performance-canon.md" ||
    rel.endsWith(".spec.ts")
  ) {
    return violations;
  }
  if (!rel.startsWith("packages/canvas/src/")) return violations;
  // Look for new definitions of these helpers (function declarations).
  const decl = /export\s+function\s+getMax(?:Horizontal|Vertical)?Scroll[XY]/g;
  let m;
  while ((m = decl.exec(content)) !== null) {
    if (isLineExempt(content, m.index)) continue;
    violations.push({
      file,
      line: lineOf(content, m.index),
      rule: "scroll-cap-outside-geometry",
      detail: `getMaxScrollX/Y must live in geometry.ts and return Infinity (timeline is infinite). See docs/performance-canon.md §2.5.`,
    });
  }
  return violations;
}

async function main() {
  const files = [];
  for (const d of startDirs) {
    await walk(path.join(root, d), files);
  }
  const violations = [];
  for (const file of files) {
    try {
      const content = await fs.readFile(file, "utf8");
      violations.push(...checkPixiConstructors(file, content));
      violations.push(...checkIdempotentReducerCases(file, content));
      violations.push(...checkScrollCapRegression(file, content));
    } catch {
      // skip
    }
  }
  if (violations.length === 0) {
    console.log("✅ check-perf-patterns: 0 violaciones de performance");
    process.exit(0);
  }
  console.error(
    `❌ check-perf-patterns: ${violations.length} violación(es) de performance`,
  );
  for (const v of violations) {
    console.error(
      `${path.relative(root, v.file)}:${v.line} [${v.rule}] ${v.detail}`,
    );
  }
  console.error(
    `\nLas reglas están documentadas en docs/performance-canon.md. ` +
      `Si necesitas una excepción específica, añade \`// PERF-EXEMPT: <razón>\` ` +
      `en la línea afectada.`,
  );
  process.exit(2);
}

main().catch((err) => {
  console.error("check-perf-patterns error:", err);
  process.exit(3);
});
