#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

const root = process.cwd();
const startDirs = ['apps', 'packages', 'src'];
const IGNORES = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage']);
const FILE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const DEEP_IMPORT_RE = /^@slicex\/[^\/]+\/.+/;

async function walk(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
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

function findImports(content) {
  const imports = [];
  const staticRe = /(?:import|export)\s+(?:[^'";]+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicRe = /import\(['"]([^'"]+)['"]\)/g;
  let m;
  while ((m = staticRe.exec(content)) !== null) {
    imports.push({ spec: m[1], index: m.index });
  }
  while ((m = dynamicRe.exec(content)) !== null) {
    imports.push({ spec: m[1], index: m.index });
  }
  return imports;
}

function lineFromIndex(content, idx) {
  return content.slice(0, idx).split(/\r?\n/).length;
}

async function main() {
  const files = [];
  for (const d of startDirs) {
    const p = path.join(root, d);
    try {
      await fs.access(p);
      await walk(p, files);
    } catch (e) {
      // ignore missing folders
    }
  }

  const violations = [];

  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf8');
      const imports = findImports(content);
      for (const imp of imports) {
        const spec = imp.spec;
        if (DEEP_IMPORT_RE.test(spec)) {
          const line = lineFromIndex(content, imp.index);
          violations.push({ file, line, spec });
        }
      }
    } catch (e) {
      // skip unreadable files
    }
  }

  if (violations.length === 0) {
    console.log('✅ check-imports: 0 violaciones arquitectónicas');
    process.exit(0);
  }

  console.error(`❌ check-imports: ${violations.length} violaciones arquitectónicas`);
  for (const v of violations) {
    console.error(`${path.relative(root, v.file)}:${v.line} → ${v.spec}`);
  }
  process.exit(2);
}

main().catch((err) => {
  console.error('check-imports error:', err);
  process.exit(3);
});
