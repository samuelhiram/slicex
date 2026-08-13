#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";

const root = process.cwd();
const localFile = path.join(root, ".env.local");
const exampleFile = path.join(root, ".env.example");
const REQUIRED = ["VITE_APP_URL"];

async function parseEnv(filePath) {
  const map = {};
  const raw = await fs.readFile(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1);
    map[key] = val;
  }
  return map;
}

async function writeEnv(filePath, map) {
  const lines = Object.entries(map).map(([k, v]) => `${k}=${v}`);
  await fs.writeFile(filePath, lines.join("\n"), "utf8");
}

async function main() {
  let localExists = true;
  try {
    await fs.access(localFile);
  } catch (e) {
    localExists = false;
  }

  if (!localExists) {
    // Try to copy from example if available
    try {
      await fs.access(exampleFile);
      const exampleMap = await parseEnv(exampleFile);
      const toWrite = {};
      for (const k of REQUIRED) {
        if (k in exampleMap) toWrite[k] = exampleMap[k];
      }
      if (Object.keys(toWrite).length === 0) {
        // Fallback defaults
        toWrite["VITE_APP_URL"] = "http://localhost:4321";
      }
      await writeEnv(localFile, toWrite);
      console.log(
        "✅ check-env: created .env.local from .env.example or defaults",
      );
      process.exit(0);
    } catch (e) {
      // Create minimal .env.local
      const defaults = { VITE_APP_URL: "http://localhost:4321" };
      await writeEnv(localFile, defaults);
      console.log("✅ check-env: created minimal .env.local");
      process.exit(0);
    }
  }

  // Validate existing .env.local
  try {
    const map = await parseEnv(localFile);
    const missing = REQUIRED.filter((k) => !(k in map));
    if (missing.length === 0) {
      console.log("✅ check-env: OK");
      process.exit(0);
    }

    // Try to fill from example
    const fill = {};
    try {
      await fs.access(exampleFile);
      const exampleMap = await parseEnv(exampleFile);
      for (const k of missing) {
        if (k in exampleMap) fill[k] = exampleMap[k];
      }
    } catch (e) {
      // no example
    }

    if (Object.keys(fill).length > 0) {
      const newMap = { ...map, ...fill };
      await writeEnv(localFile, newMap);
      console.log("✅ check-env: synchronized missing keys from .env.example");
      process.exit(0);
    }

    console.error("❌ check-env: missing env keys:", missing.join(", "));
    process.exit(2);
  } catch (err) {
    console.error("check-env error:", err);
    process.exit(3);
  }
}

main();
