#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";

const root = process.cwd();
const startDirs = ["apps", "packages", "src"];
const IGNORES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
]);
const FILE_EXT = /\.(ts|tsx|js|jsx)$/i;
const TS_EXT = new Set([".ts", ".tsx"]);
const MIRROR_EXTS = [".js", ".jsx"];

async function walk(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, files);
    } else if (FILE_EXT.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const files = [];
  for (const dir of startDirs) {
    const fullDir = path.join(root, dir);
    try {
      await fs.access(fullDir);
      await walk(fullDir, files);
    } catch {
      // ignore missing folders
    }
  }

  const violations = [];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!TS_EXT.has(ext)) continue;
    if (file.endsWith(".d.ts") || file.endsWith(".d.tsx")) continue;

    const dir = path.dirname(file);
    const baseName = path.basename(file, ext);

    for (const mirrorExt of MIRROR_EXTS) {
      const mirrorPath = path.join(dir, `${baseName}${mirrorExt}`);
      try {
        await fs.access(mirrorPath);
        violations.push({ source: file, mirror: mirrorPath });
      } catch {
        // no mirror with this extension
      }
    }
  }

  if (violations.length === 0) {
    console.log("✅ check-js-siblings: 0 sibling mirrors");
    process.exit(0);
  }

  console.error(`❌ check-js-siblings: ${violations.length} sibling mirrors`);
  for (const violation of violations) {
    console.error(
      `${path.relative(root, violation.source)} <-> ${path.relative(root, violation.mirror)}`,
    );
  }
  process.exit(2);
}

main().catch((err) => {
  console.error("check-js-siblings error:", err);
  process.exit(3);
});
