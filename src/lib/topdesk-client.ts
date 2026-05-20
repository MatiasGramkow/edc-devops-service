import { getCached, setCache } from "@/lib/cache";

const URL = process.env.TOPDESK_URL ?? "";
const USER = process.env.TOPDESK_API_USER ?? "";
const TOKEN = process.env.TOPDESK_APP_TOKEN ?? "";

export function isTopdeskConfigured(): boolean {
  return URL.length > 0 && USER.length > 0 && TOKEN.length > 0;
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${USER}:${TOKEN}`).toString("base64")}`;
}

function apiUrl(path: string): string {
  return `${URL.replace(/\/$/, "")}/tas/api/${path.replace(/^\//, "")}`;
}

export function ticketWebUrl(id: string): string {
  return `${URL.replace(/\/$/, "")}/tas/secure/incident?unid=${id}`;
}

interface TopdeskFieldRef {
  id: string;
  name: string;
}

interface TopdeskCallerRaw {
  id?: string;
  dynamicName?: string;
  email?: string;
  phoneNumber?: string;
  mobileNumber?: string;
  branch?: TopdeskFieldRef;
}

interface TopdeskIncidentRaw {
  id: string;
  number: string;
  externalNumber?: string | null;
  briefDescription?: string | null;
  request?: string | null;
  status?: string | null;
  closed?: boolean;
  closedDate?: string | null;
  callDate?: string | null;
  creationDate?: string | null;
  modificationDate?: string | null;
  targetDate?: string | null;
  caller?: TopdeskCallerRaw | null;
  operator?: TopdeskFieldRef | null;
  operatorGroup?: TopdeskFieldRef | null;
  category?: TopdeskFieldRef | null;
  subcategory?: TopdeskFieldRef | null;
  callType?: TopdeskFieldRef | null;
  entryType?: TopdeskFieldRef | null;
  priority?: TopdeskFieldRef | null;
  impact?: TopdeskFieldRef | null;
  urgency?: TopdeskFieldRef | null;
  processingStatus?: TopdeskFieldRef | null;
  duration?: TopdeskFieldRef | null;
}

export interface TopdeskTicket {
  id: string;
  number: string;
  externalNumber: string | null;
  webUrl: string;
  title: string;
  request: string;
  status: string | null;
  closed: boolean;
  closedDate: string | null;
  callDate: string | null;
  creationDate: string | null;
  modificationDate: string | null;
  targetDate: string | null;
  callerName: string | null;
  callerEmail: string | null;
  callerPhone: string | null;
  operatorName: string | null;
  operatorGroupName: string | null;
  category: string | null;
  subcategory: string | null;
  callType: string | null;
  entryType: string | null;
  priority: string | null;
  priorityLevel: number | null;
  impact: string | null;
  urgency: string | null;
  processingStatus: string | null;
}

function priorityLevel(name: string | null | undefined): number | null {
  if (!name) return null;
  const m = name.match(/^(\d)/);
  return m ? Number(m[1]) : null;
}

function mapIncident(raw: TopdeskIncidentRaw): TopdeskTicket {
  return {
    id: raw.id,
    number: raw.number,
    externalNumber: raw.externalNumber ?? null,
    webUrl: ticketWebUrl(raw.id),
    title: raw.briefDescription ?? "(no title)",
    request: raw.request ?? "",
    status: raw.status ?? null,
    closed: !!raw.closed,
    closedDate: raw.closedDate ?? null,
    callDate: raw.callDate ?? null,
    creationDate: raw.creationDate ?? null,
    modificationDate: raw.modificationDate ?? null,
    targetDate: raw.targetDate ?? null,
    callerName: raw.caller?.dynamicName ?? null,
    callerEmail: raw.caller?.email ?? null,
    callerPhone: raw.caller?.mobileNumber ?? raw.caller?.phoneNumber ?? null,
    operatorName: raw.operator?.name ?? null,
    operatorGroupName: raw.operatorGroup?.name ?? null,
    category: raw.category?.name ?? null,
    subcategory: raw.subcategory?.name ?? null,
    callType: raw.callType?.name ?? null,
    entryType: raw.entryType?.name ?? null,
    priority: raw.priority?.name ?? null,
    priorityLevel: priorityLevel(raw.priority?.name),
    impact: raw.impact?.name ?? null,
    urgency: raw.urgency?.name ?? null,
    processingStatus: raw.processingStatus?.name ?? null,
  };
}

export class TopdeskApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "TopdeskApiError";
  }
}

async function topdeskFetch(path: string): Promise<unknown> {
  if (!isTopdeskConfigured()) {
    throw new TopdeskApiError("TOPdesk is not configured (TOPDESK_URL, TOPDESK_API_USER, TOPDESK_APP_TOKEN)", 500);
  }

  const response = await fetch(apiUrl(path), {
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new TopdeskApiError("TOPdesk authentication failed — check API user / token / permissions", response.status);
  }
  if (response.status === 404) {
    throw new TopdeskApiError("TOPdesk ticket not found", 404);
  }
  if (!response.ok && response.status !== 206) {
    const body = await response.text().catch(() => "");
    throw new TopdeskApiError(`TOPdesk API error ${response.status}: ${body.slice(0, 200)}`, response.status);
  }

  return response.json();
}

const TICKET_NUMBER_RE = /^\d{4}-\d{4}$/;

export function normalizeTicketNumber(input: string): string | null {
  const cleaned = input.trim().replace(/[\s_]/g, "-");
  if (TICKET_NUMBER_RE.test(cleaned)) return cleaned;

  const digits = input.replace(/\D/g, "");
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return null;
}

export async function fetchTicketByNumber(number: string): Promise<TopdeskTicket> {
  const normalized = normalizeTicketNumber(number);
  if (!normalized) {
    throw new TopdeskApiError(`Invalid ticket number format. Expected YYMM-XXXX (e.g. 2604-2477), got "${number}"`, 400);
  }

  const cacheKey = `topdesk:ticket:${normalized}`;
  const cached = getCached<TopdeskTicket>(cacheKey);
  if (cached) return cached;

  const raw = (await topdeskFetch(`incidents/number/${encodeURIComponent(normalized)}`)) as TopdeskIncidentRaw;
  const ticket = mapIncident(raw);
  setCache(cacheKey, ticket, 60_000);
  return ticket;
}

export async function fetchTicketById(id: string): Promise<TopdeskTicket> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) {
    throw new TopdeskApiError("Invalid ticket ID format", 400);
  }
  const raw = (await topdeskFetch(`incidents/id/${encodeURIComponent(id)}`)) as TopdeskIncidentRaw;
  return mapIncident(raw);
}

export interface TopdeskListOptions {
  pageSize?: number;
  callerEmail?: string;
  operatorName?: string;
  operatorGroupName?: string;
  open?: boolean;
  query?: string;
}

async function fetchTicketsPage(
  opts: Pick<TopdeskListOptions, "callerEmail" | "open" | "query">,
  start: number,
  pageSize: number
): Promise<TopdeskTicket[]> {
  const params = new URLSearchParams();
  params.set("page_size", String(pageSize));
  if (start > 0) params.set("start", String(start));
  if (opts.callerEmail) params.set("caller_email", opts.callerEmail);
  if (opts.open === true) params.set("completed", "false");
  if (opts.open === false) params.set("completed", "true");
  if (opts.query) params.set("query", opts.query);
  params.set("order_by", "creationDate+DESC");

  const raw = (await topdeskFetch(`incidents?${params.toString()}`)) as TopdeskIncidentRaw[];
  if (!Array.isArray(raw)) return [];
  return raw.map(mapIncident);
}

export async function listTickets(opts: TopdeskListOptions = {}): Promise<TopdeskTicket[]> {
  const hasOperatorFilter = !!opts.operatorName || !!opts.operatorGroupName;
  const limit = Math.min(opts.pageSize ?? 25, 500);

  if (!hasOperatorFilter) {
    return fetchTicketsPage(opts, 0, Math.min(limit, 100));
  }

  // TOPdesk's incident API doesn't accept operator_name as a filter parameter,
  // so we paginate through results and apply the filter client-side. The cap
  // (MAX_SCANNED) keeps response time bounded even on busy tenants.
  const PAGE_SIZE = 100;
  const MAX_SCANNED = 2000;
  const opName = opts.operatorName?.toLowerCase();
  const opGroup = opts.operatorGroupName?.toLowerCase();
  const collected: TopdeskTicket[] = [];

  for (let start = 0; start < MAX_SCANNED; start += PAGE_SIZE) {
    const batch = await fetchTicketsPage(opts, start, PAGE_SIZE);
    if (batch.length === 0) break;

    for (const t of batch) {
      if (opName && (t.operatorName ?? "").toLowerCase() !== opName) continue;
      if (opGroup && (t.operatorGroupName ?? "").toLowerCase() !== opGroup) continue;
      collected.push(t);
      if (collected.length >= limit) return collected;
    }

    if (batch.length < PAGE_SIZE) break;
  }

  return collected;
}

// --- HTML banner for PBI/Bug descriptions ---
// Renders an attribution banner that gets prepended to the Azure DevOps description
// to make it obvious that the work item originated from a TOPdesk ticket.
export function renderTopdeskBanner(ticket: TopdeskTicket): string {
  const callDate = ticket.callDate ? new Date(ticket.callDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : null;
  const parts: string[] = [];

  parts.push('<div style="border-left:4px solid #5b8def;background:#eef4ff;padding:12px 16px;margin:0 0 16px 0;">');
  parts.push(`<p style="margin:0 0 8px 0;"><strong>📥 Source: TOPdesk Ticket <a href="${escapeHtml(ticket.webUrl)}">${escapeHtml(ticket.number)}</a></strong></p>`);
  parts.push("<table style=\"border-collapse:collapse;font-size:13px;\"><tbody>");

  const rows: Array<[string, string | null]> = [
    ["Ticket number", ticket.number],
    ["External ref", ticket.externalNumber || null],
    ["Reported by", ticket.callerName ? `${ticket.callerName}${ticket.callerEmail ? ` &lt;${ticket.callerEmail}&gt;` : ""}` : null],
    ["Category", ticket.category ? `${ticket.category}${ticket.subcategory ? ` / ${ticket.subcategory}` : ""}` : null],
    ["TOPdesk priority", ticket.priority],
    ["Operator", ticket.operatorName],
    ["Operator group", ticket.operatorGroupName],
    ["Created in TOPdesk", callDate],
    ["TOPdesk status", ticket.processingStatus ?? (ticket.closed ? "Closed" : ticket.status)],
  ];

  for (const [label, value] of rows) {
    if (!value) continue;
    parts.push(`<tr><td style="padding:2px 12px 2px 0;color:#5b6479;"><strong>${escapeHtml(label)}</strong></td><td style="padding:2px 0;">${value}</td></tr>`);
  }

  parts.push("</tbody></table>");
  parts.push("</div>");
  return parts.join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Strip a leading banner (idempotent) so re-creation doesn't duplicate it.
export function stripTopdeskBanner(html: string): string {
  return html.replace(/<div[^>]*border-left:4px solid #5b8def[\s\S]*?<\/div>\s*/i, "");
}

// Convert the raw TOPdesk "request" text-stream into rough HTML for AI input fallback.
export function requestToText(ticket: TopdeskTicket, maxChars: number = 4000): string {
  const header = [
    `Ticket: ${ticket.number}`,
    ticket.title ? `Title: ${ticket.title}` : null,
    ticket.callerName ? `Caller: ${ticket.callerName}${ticket.callerEmail ? ` <${ticket.callerEmail}>` : ""}` : null,
    ticket.category ? `Category: ${ticket.category}${ticket.subcategory ? ` / ${ticket.subcategory}` : ""}` : null,
    ticket.priority ? `Priority: ${ticket.priority}` : null,
  ].filter(Boolean).join("\n");

  const body = ticket.request ?? "";
  return `${header}\n\n---\n\n${body}`.slice(0, maxChars);
}
