#!/usr/bin/env node
// Find dit Topdesk operator-UUID, så daily-sync.mjs kan filtrere på
// "tildelt mig". Køres én gang fra din Mac:
//
//   node scripts/find-my-operator-id.mjs                  # bruger SMTP_USER / .env.local
//   node scripts/find-my-operator-id.mjs magr@edc.dk      # eksplicit email
//
// Når du har dit UUID, læg det i .env.local som:
//   TOPDESK_MY_OPERATOR_ID=<uuid>

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env.local");

async function loadEnv() {
  const text = await fs.readFile(ENV_FILE, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Mangler env-variabel ${name} — sæt den i .env.local`);
    process.exit(2);
  }
  return v;
}

function authHeader() {
  return "Basic " + Buffer.from(`${need("TOPDESK_API_USER")}:${need("TOPDESK_APP_TOKEN")}`).toString("base64");
}

async function fetchOperators(pageStart = 0, pageSize = 100) {
  const base = need("TOPDESK_URL").replace(/\/$/, "");
  const url = new URL(`${base}/tas/api/operators`);
  url.searchParams.set("page_size", String(pageSize));
  url.searchParams.set("start", String(pageStart));
  const res = await fetch(url, { headers: { Authorization: authHeader(), Accept: "application/json" } });
  if (!res.ok && res.status !== 206) {
    const body = await res.text().catch(() => "");
    throw new Error(`Topdesk operators ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function main() {
  await loadEnv();
  const targetEmail = (process.argv[2] || "").toLowerCase().trim() || "magr@edc.dk";
  console.log(`Søger efter operator med email = ${targetEmail}…`);

  // Topdesk's /operators-endpoint understøtter pagination via start+page_size.
  // Vi henter sider af 100 indtil vi finder et match eller en tom side.
  let start = 0;
  let totalSeen = 0;
  for (let page = 0; page < 50; page++) {
    const ops = await fetchOperators(start, 100);
    if (ops.length === 0) break;
    totalSeen += ops.length;
    const hit = ops.find((o) => (o.email || "").toLowerCase() === targetEmail);
    if (hit) {
      console.log("\n✓ Fundet:");
      console.log(`  id:          ${hit.id}`);
      console.log(`  dynamicName: ${hit.dynamicName}`);
      console.log(`  email:       ${hit.email}`);
      console.log("\nTilføj denne linje i .env.local:");
      console.log(`  TOPDESK_MY_OPERATOR_ID=${hit.id}\n`);
      return;
    }
    start += ops.length;
    if (ops.length < 100) break; // sidste side
  }

  console.error(`\nIngen operator fundet med email ${targetEmail} (gennemsøgte ${totalSeen} operatører).`);
  console.error("Prøv evt. med en variation af din email, eller spørg din Topdesk-admin om dit operator-UUID.");
  process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
