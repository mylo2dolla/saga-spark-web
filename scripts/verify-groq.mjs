import fs from "node:fs";
import path from "node:path";

const envFileCandidates = [".env.local", ".env"];

for (const envFile of envFileCandidates) {
  const envPath = path.resolve(process.cwd(), envFile);
  if (!fs.existsSync(envPath)) {
    continue;
  }

  const contents = fs.readFileSync(envPath, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
  console.error("Missing GROQ_API_KEY. Export it before running this script.");
  process.exit(1);
}

const response = await fetch("https://api.groq.com/openai/v1/models", {
  headers: {
    Authorization: `Bearer ${apiKey}`,
  },
});

if (!response.ok) {
  const errorText = await response.text();
  console.error("Groq API verification failed.");
  console.error(`Status: ${response.status} ${response.statusText}`);
  if (errorText) {
    console.error(`Body: ${errorText}`);
  }
  process.exit(1);
}

const payload = await response.json();
const modelCount = Array.isArray(payload?.data) ? payload.data.length : 0;

console.log("Groq API verified successfully.");
console.log(`Available models: ${modelCount}`);
