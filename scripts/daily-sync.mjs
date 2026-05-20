#!/usr/bin/env node
// Dagligt sync-job: hent nye åbne Topdesk-tickets siden sidste kørsel og
// opret tilsvarende Product Backlog Items i Azure DevOps (med TOPdesk:<nr>-tag
// så vi kan opdage dubletter).
//
// Konfiguration læses fra ../.env.local (samme fil som Next.js-appen bruger).
// State (sidste kørsel + sidste resultat) gemmes i ../data/daily-sync-state.json.
//
// Køres af den scheduled task 'daily-topdesk-sync', men kan også køres manuelt:
//   node scripts/daily-sync.mjs           # opret nye PBI'er
//   node scripts/daily-sync.mjs --dry-run # vis kun hvad der ville ske

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env.local");
const STATE_FILE = path.join(ROOT, "data", "daily-sync-state.json");

const DRY_RUN = process.argv.includes("--dry-run");

// --- .env.local loader (minimal, ingen dotenv-dependency) -------------------
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

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Mangler env-variabel: ${name}`);
  return v;
}

// --- State ------------------------------------------------------------------
async function loadState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return { lastRunAt: null, lastResult: null };
  }
}

async function saveState(state) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

// --- Topdesk ----------------------------------------------------------------
function topdeskAuth() {
  const user = requireEnv("TOPDESK_API_USER");
  const token = requireEnv("TOPDESK_APP_TOKEN");
  return "Basic " + Buffer.from(`${user}:${token}`).toString("base64");
}

function ticketWebUrl(id) {
  const base = requireEnv("TOPDESK_URL").replace(/\/$/, "");
  return `${base}/tas/secure/incident?unid=${id}`;
}

async function listOpenTickets({ pageSize = 50, operatorId } = {}) {
  const base = requireEnv("TOPDESK_URL").replace(/\/$/, "");
  const url = new URL(`${base}/tas/api/incidents`);
  url.searchParams.set("page_size", String(pageSize));
  url.searchParams.set("completed", "false");
  url.searchParams.set("order_by", "creationDate+DESC");
  if (operatorId) url.searchParams.set("operator", operatorId);

  const res = await fetch(url, {
    headers: { Authorization: topdeskAuth(), Accept: "application/json" },
  });
  if (!res.ok && res.status !== 206) {
    const body = await res.text().catch(() => "");
    throw new Error(`Topdesk listTickets ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// --- Azure DevOps -----------------------------------------------------------
const API_VERSION = "7.1";

function devopsAuth() {
  return "Basic " + Buffer.from(":" + requireEnv("AZURE_DEVOPS_PAT")).toString("base64");
}

function projectApiUrl(p) {
  const org = requireEnv("AZURE_DEVOPS_ORG");
  const project = requireEnv("AZURE_DEVOPS_PROJECT");
  return `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/${p}`;
}

async function existingWorkItemForTicket(number) {
  // WIQL: find work items i projektet med System.Tags der indeholder TOPdesk:<nr>
  const project = requireEnv("AZURE_DEVOPS_PROJECT");
  const wiql = {
    query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project.replace(/'/g, "''")}' AND [System.Tags] CONTAINS 'TOPdesk:${number}'`,
  };
  const url = projectApiUrl(`wit/wiql?api-version=${API_VERSION}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: devopsAuth(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(wiql),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DevOps WIQL ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data.workItems) && data.workItems.length > 0
    ? data.workItems[0].id
    : null;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderBanner(ticket) {
  const url = ticketWebUrl(ticket.id);
  const created = ticket.creationDate
    ? new Date(ticket.creationDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : null;
  const rows = [
    ["Ticket number", ticket.number],
    ["External ref", ticket.externalNumber || null],
    ["Reported by", ticket.caller?.dynamicName
      ? `${ticket.caller.dynamicName}${ticket.caller.email ? ` &lt;${ticket.caller.email}&gt;` : ""}`
      : null],
    ["Category", ticket.category?.name
      ? `${ticket.category.name}${ticket.subcategory?.name ? ` / ${ticket.subcategory.name}` : ""}`
      : null],
    ["TOPdesk priority", ticket.priority?.name ?? null],
    ["Operator", ticket.operator?.name ?? null],
    ["Operator group", ticket.operatorGroup?.name ?? null],
    ["Created in TOPdesk", created],
    ["TOPdesk status", ticket.processingStatus?.name ?? null],
  ];
  let html = `<div style="border-left:4px solid #5b8def;background:#eef4ff;padding:12px 16px;margin:0 0 16px 0;">`;
  html += `<p style="margin:0 0 8px 0;"><strong>📥 Source: TOPdesk Ticket <a href="${escapeHtml(url)}">${escapeHtml(ticket.number)}</a></strong></p>`;
  html += `<table style="border-collapse:collapse;font-size:13px;"><tbody>`;
  for (const [label, value] of rows) {
    if (!value) continue;
    html += `<tr><td style="padding:2px 12px 2px 0;color:#5b6479;"><strong>${escapeHtml(label)}</strong></td><td style="padding:2px 0;">${value}</td></tr>`;
  }
  html += `</tbody></table></div>`;
  return html;
}

function renderRequestHtml(text) {
  if (!text) return "";
  return escapeHtml(text).replace(/\r?\n/g, "<br/>");
}

async function createPbi(ticket) {
  const title = (ticket.briefDescription || "").trim() || `TOPdesk ${ticket.number}`;
  const description = renderBanner(ticket) + "\n" + renderRequestHtml(ticket.request);
  const tag = `TOPdesk:${ticket.number}`;

  const ops = [
    { op: "add", path: "/fields/System.Title", value: title },
    { op: "add", path: "/fields/System.AreaPath", value: "Relaunch - Charlie Tango" },
    { op: "add", path: "/fields/System.Description", value: description },
    { op: "add", path: "/fields/System.Tags", value: tag },
  ];

  const url = projectApiUrl(`wit/workitems/$${encodeURIComponent("Product Backlog Item")}?api-version=${API_VERSION}`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: devopsAuth(),
      "Content-Type": "application/json-patch+json",
      Accept: "application/json",
    },
    body: JSON.stringify(ops),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`DevOps createWorkItem ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// --- Main -------------------------------------------------------------------
async function main() {
  await loadEnv();
  const state = await loadState();

  // Vi henter alt åbent og filtrerer på creationDate > lastRunAt for at undgå
  // dubletter. Første gang scriptet kører bruges "sidste 24 timer".
  const sinceIso = state.lastRunAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const sinceDate = new Date(sinceIso);

  // Hvis TOPDESK_MY_OPERATOR_ID er sat, henter vi kun tickets der er tildelt mig.
  // Sæt den ved at køre: node scripts/find-my-operator-id.mjs
  const operatorId = process.env.TOPDESK_MY_OPERATOR_ID || undefined;
  const scope = operatorId ? `tildelt mig (operator=${operatorId})` : "alle (intet operator-filter)";

  console.log(`[daily-sync] henter åbne Topdesk-tickets, scope: ${scope}, oprettet efter ${sinceDate.toISOString()}${DRY_RUN ? " (DRY RUN)" : ""}`);
  const tickets = await listOpenTickets({ pageSize: 100, operatorId });
  const newTickets = tickets.filter((t) => t.creationDate && new Date(t.creationDate) > sinceDate);
  console.log(`[daily-sync] ${tickets.length} åbne tickets i alt (efter filter), ${newTickets.length} nye siden sidst`);

  const created = [];
  const skipped = [];
  const errors = [];

  for (const ticket of newTickets) {
    try {
      const existingId = await existingWorkItemForTicket(ticket.number);
      if (existingId) {
        console.log(`  - ${ticket.number}: findes allerede som DevOps #${existingId}, springer over`);
        skipped.push({ number: ticket.number, devopsId: existingId, reason: "already-exists" });
        continue;
      }

      if (DRY_RUN) {
        console.log(`  · ${ticket.number}: ville oprette PBI "${ticket.briefDescription}"`);
        created.push({ number: ticket.number, devopsId: null, title: ticket.briefDescription, dryRun: true });
        continue;
      }

      const wi = await createPbi(ticket);
      console.log(`  ✓ ${ticket.number} → DevOps #${wi.id}: ${ticket.briefDescription}`);
      created.push({ number: ticket.number, devopsId: wi.id, title: ticket.briefDescription });
    } catch (err) {
      console.error(`  ✗ ${ticket.number}: ${err.message}`);
      errors.push({ number: ticket.number, error: err.message });
    }
  }

  if (!DRY_RUN) {
    state.lastRunAt = new Date().toISOString();
    state.lastResult = {
      ranAt: state.lastRunAt,
      seenOpenTickets: tickets.length,
      newSinceLastRun: newTickets.length,
      created,
      skipped,
      errors,
    };
    await saveState(state);
  }

  console.log(`[daily-sync] færdig — ${created.length} oprettet, ${skipped.length} sprunget over, ${errors.length} fejl`);

  if (errors.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[daily-sync] fatal:", err);
  process.exit(1);
});
