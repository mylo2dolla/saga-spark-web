#!/usr/bin/env node
/**
 * Edge Functions inventory generator.
 *
 * Reads supabase/functions/<name>/index.ts for a fixed list of Mythic functions
 * and emits a diffable markdown table with:
 * - file path
 * - methods
 * - auth model
 * - request body keys (best-effort from zod RequestSchema)
 * - tables / RPCs touched (best-effort from string literal extraction)
 * - LLM usage hints
 *
 * No network calls; repo-local only.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const FUNCTIONS = [
  "mythic-apply-xp",
  "mythic-board-transition",
  "mythic-bootstrap",
  "mythic-combat-start",
  "mythic-combat-tick",
  "mythic-combat-use-skill",
  "mythic-create-campaign",
  "mythic-create-character",
  "mythic-dm-context",
  "mythic-dungeon-master",
  "mythic-field-generate",
  "mythic-generate-loot",
  "mythic-join-campaign",
  "mythic-list-campaigns",
  "mythic-recompute-character",
  "mythic-set-loadout",
  "mythic-shop-buy",
  "mythic-shop-stock",
  "mythic-tts",
  "world-content-writer",
  "world-generator",
];

function readFileMaybe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function extractRequestKeys(src) {
  const idx = src.indexOf("const RequestSchema");
  if (idx === -1) return [];
  const after = src.slice(idx);
  const objIdx = after.indexOf("z.object(");
  if (objIdx === -1) return [];
  const braceStart = after.indexOf("{", objIdx);
  if (braceStart === -1) return [];

  let i = braceStart;
  let depth = 0;
  let end = -1;
  for (; i < after.length; i += 1) {
    const ch = after[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];
  const block = after.slice(braceStart, end + 1);
  const keys = [];
  const re = /\n\s*([A-Za-z0-9_]+)\s*:\s*z\./g;
  for (;;) {
    const m = re.exec(block);
    if (!m) break;
    keys.push(m[1]);
  }
  return uniq(keys);
}

function extractTablesAndRpcs(src) {
  const tables = [];
  const rpcs = [];

  // .from("table")
  for (const m of src.matchAll(/\.from\(\s*"([^"]+)"\s*\)/g)) {
    tables.push(m[1]);
  }

  // .schema("mythic").from("table") => mythic.table
  for (const m of src.matchAll(/\.schema\(\s*"([^"]+)"\s*\)[\s\S]{0,120}?\.from\(\s*"([^"]+)"\s*\)/g)) {
    tables.push(`${m[1]}.${m[2]}`);
  }

  // .rpc("fn")
  for (const m of src.matchAll(/\.rpc\(\s*"([^"]+)"\s*,/g)) {
    rpcs.push(m[1]);
  }
  for (const m of src.matchAll(/\.rpc\(\s*"([^"]+)"\s*\)/g)) {
    rpcs.push(m[1]);
  }

  return { tables: uniq(tables).sort(), rpcs: uniq(rpcs).sort() };
}

function detectMethods(src) {
  const methods = new Set();
  if (src.includes('req.method === "OPTIONS"')) methods.add("OPTIONS");
  if (src.includes('req.method !== "POST"') || src.includes('req.method === "POST"')) methods.add("POST");
  if (src.includes('req.method !== "GET"') || src.includes('req.method === "GET"')) methods.add("GET");
  if (src.includes('req.method === "PUT"') || src.includes('req.method !== "PUT"')) methods.add("PUT");
  if (src.includes('req.method === "DELETE"') || src.includes('req.method !== "DELETE"')) methods.add("DELETE");
  // Many functions only enforce OPTIONS explicitly but define CORS allow methods.
  if (methods.size === 1 && methods.has("OPTIONS")) {
    const m = src.match(/Access-Control-Allow-Methods"\s*:\s*"([^"]+)"/);
    if (m && m[1]) {
      for (const part of m[1].split(",")) {
        const method = part.trim().toUpperCase();
        if (method) methods.add(method);
      }
    }
  }
  return Array.from(methods.values()).filter((m) => m !== "PUT" && m !== "DELETE").join(", ") || "unknown";
}

function detectAuth(src, name) {
  const bearerCheck = /startsWith\("Bearer "\)/.test(src) || /startsWith\('Bearer '\)/.test(src);
  const authGetUser = /\.auth\.getUser\(/.test(src);
  if (bearerCheck && authGetUser) return "user_jwt_required";
  if (bearerCheck) return "bearer_required";
  if (authGetUser) return "auth_getUser_present";
  // Known generator endpoints are sometimes optional; fall back to "unknown/optional"
  if (name === "world-generator") return "optional_or_public";
  return "unknown";
}

function detectServiceRoleUsage(src) {
  return /SUPABASE_SERVICE_ROLE_KEY/.test(src) || /serviceRoleKey/.test(src) ? "service_role" : "unknown";
}

function detectLlmUsage(src) {
  if (/mythicOpenAIChatCompletions|mythicOpenAIChatCompletionsStream/.test(src)) return "openai(mythic)";
  if (/aiChatCompletionsStream|aiChatCompletions/.test(src)) return "provider_resolved";
  if (/openaiChatCompletionsStream|openaiChatCompletions/.test(src)) return "openai";
  if (/groqChatCompletionsStream|groqChatCompletions/.test(src)) return "groq";
  return "";
}

function mdEscape(s) {
  return String(s).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatList(items, max = 6) {
  const sliced = items.slice(0, max);
  const suffix = items.length > max ? ` (+${items.length - max})` : "";
  return sliced.join(", ") + suffix;
}

const rows = [];
for (const name of FUNCTIONS) {
  const filePath = path.join(ROOT, "supabase", "functions", name, "index.ts");
  const src = readFileMaybe(filePath);
  if (!src) {
    rows.push({
      name,
      path: filePath,
      methods: "",
      auth: "",
      db: "",
      reqKeys: "",
      tables: "",
      rpcs: "",
      llm: "",
      notes: "MISSING",
    });
    continue;
  }

  const methods = detectMethods(src);
  const auth = detectAuth(src, name);
  const db = detectServiceRoleUsage(src);
  const reqKeys = extractRequestKeys(src);
  const { tables, rpcs } = extractTablesAndRpcs(src);
  const llm = detectLlmUsage(src);

  rows.push({
    name,
    path: filePath,
    methods,
    auth,
    db,
    reqKeys: reqKeys.join(", "),
    tables: formatList(tables, 10),
    rpcs: formatList(rpcs, 8),
    llm,
    notes: "",
  });
}

const header = [
  "# Mythic Edge Functions Inventory (Repo-Derived)",
  "",
  "Generated by `scripts/audit-edge-functions.mjs` from the local repo (best-effort static analysis).",
  "",
  "| Function | File | Methods | Auth | DB Key | Request Keys | Tables (strings) | RPCs (strings) | LLM | Notes |",
  "|---|---|---|---|---|---|---|---|---|---|",
].join("\n");

const body = rows
  .map((r) =>
    `| ${mdEscape(r.name)} | ${mdEscape(path.relative(ROOT, r.path))} | ${mdEscape(r.methods)} | ${mdEscape(r.auth)} | ${mdEscape(r.db)} | ${mdEscape(r.reqKeys)} | ${mdEscape(r.tables)} | ${mdEscape(r.rpcs)} | ${mdEscape(r.llm)} | ${mdEscape(r.notes)} |`
  )
  .join("\n");

const out = `${header}\n${body}\n`;
const outPath = path.join(ROOT, "docs", "edge-functions-inventory.md");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out, "utf8");
