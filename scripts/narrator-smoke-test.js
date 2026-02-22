#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const serviceRoot = path.join(repoRoot, "services", "mythic-api");

const child = spawnSync(
  "npm",
  ["exec", "--", "tsx", "scripts/narrator-smoke-test.ts"],
  {
    cwd: serviceRoot,
    stdio: "inherit",
  },
);

if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}

process.exit(typeof child.status === "number" ? child.status : 1);
