"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { WorkItemTypeIcon } from "./WorkItemTypeIcon";

interface DevopsLinkedItem {
  id: number;
  type: string;
  title: string;
  state: string;
  assignedTo: string | null;
  iterationPath: string;
  tags: string;
  url: string;
}

interface InboxTicket {
  id: string;
  number: string;
  externalNumber: string | null;
  webUrl: string;
  title: string;
  status: string | null;
  closed: boolean;
  callDate: string | null;
  modificationDate: string | null;
  callerName: string | null;
  callerEmail: string | null;
  operatorName: string | null;
  operatorGroupName: string | null;
  category: string | null;
  subcategory: string | null;
  priority: string | null;
  priorityLevel: number | null;
  processingStatus: string | null;
  devopsWorkItems: DevopsLinkedItem[];
}

interface InboxResponse {
  tickets: InboxTicket[];
  operatorName: string | null;
  operatorGroupName: string | null;
  open: boolean | null;
  error?: string;
}

type OpenFilter = "open" | "closed" | "all";

const OPERATOR_NAME = "Matias Gramkow";

function formatDate(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return s;
  }
}

function priorityColor(level: number | null): string {
  if (level == null) return "text-text-muted";
  if (level <= 2) return "text-stale-ancient";
  if (level === 3) return "text-stale-stale";
  if (level === 4) return "text-accent-blue";
  return "text-text-muted";
}

function stateColor(state: string): string {
  const s = state.toLowerCase();
  if (s === "done" || s === "closed") return "bg-stale-fresh/15 text-stale-fresh";
  if (s === "removed") return "bg-text-muted/15 text-text-muted";
  if (s === "active" || s === "committed" || s === "in progress") return "bg-accent-blue/15 text-accent-blue";
  if (s === "new" || s === "approved") return "bg-accent-gold/15 text-accent-gold";
  return "bg-bg-secondary text-text-secondary";
}

const DONE_STATES = new Set(["done", "closed", "removed"]);

function isReadyToClose(ticket: InboxTicket): boolean {
  if (ticket.closed) return false;
  if (ticket.devopsWorkItems.length === 0) return false;
  return ticket.devopsWorkItems.every((wi) => DONE_STATES.has(wi.state.toLowerCase()));
}

export function TopdeskInboxView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Pending (form) state vs. applied (last-searched) state — search only fires on submit
  const [pendingOpen, setPendingOpen] = useState<OpenFilter>("open");
  const [pendingLink, setPendingLink] = useState<"all" | "missing" | "linked">("all");
  const [appliedOpen, setAppliedOpen] = useState<OpenFilter>("open");
  const [appliedLink, setAppliedLink] = useState<"all" | "missing" | "linked">("all");

  const [tickets, setTickets] = useState<InboxTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAppliedOpen(pendingOpen);
    setAppliedLink(pendingLink);
    try {
      const params = new URLSearchParams();
      params.set("action", "inbox");
      params.set("operatorName", OPERATOR_NAME);
      params.set("open", pendingOpen === "open" ? "true" : pendingOpen === "closed" ? "false" : "all");
      params.set("limit", "100");

      const res = await fetch(`/api/topdesk?${params.toString()}`);
      const data: InboxResponse = await res.json();
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        setTickets([]);
        return;
      }
      setTickets(data.tickets ?? []);
      setLastFetchedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection error");
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [pendingOpen, pendingLink]);

  const didInitialFetch = useRef(false);
  useEffect(() => {
    if (didInitialFetch.current) return;
    didInitialFetch.current = true;
    runSearch();
  }, [runSearch]);

  const filtered = useMemo(() => {
    if (appliedLink === "all") return tickets;
    if (appliedLink === "missing") return tickets.filter((t) => t.devopsWorkItems.length === 0);
    return tickets.filter((t) => t.devopsWorkItems.length > 0);
  }, [tickets, appliedLink]);

  const summary = useMemo(() => {
    const total = tickets.length;
    const linked = tickets.filter((t) => t.devopsWorkItems.length > 0).length;
    const readyToClose = tickets.filter(isReadyToClose).length;
    return { total, linked, missing: total - linked, readyToClose };
  }, [tickets]);

  const handleCreate = useCallback((ticketNumber: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("tab", "create");
    next.set("topdeskFetch", ticketNumber);
    router.push(`?${next.toString()}`, { scroll: false });
  }, [router, searchParams]);

  // Link modal state
  const [linkingTicket, setLinkingTicket] = useState<InboxTicket | null>(null);
  const [linkInput, setLinkInput] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);

  const startLink = useCallback((ticket: InboxTicket) => {
    setLinkingTicket(ticket);
    setLinkInput("");
    setLinkError(null);
    setLinkSuccess(null);
  }, []);

  const cancelLink = useCallback(() => {
    setLinkingTicket(null);
    setLinkInput("");
    setLinkError(null);
    setLinkSuccess(null);
    setLinkBusy(false);
  }, []);

  const submitLink = useCallback(async () => {
    if (!linkingTicket) return;
    if (!linkInput.trim()) {
      setLinkError("Paste a DevOps URL or work item ID");
      return;
    }
    setLinkBusy(true);
    setLinkError(null);
    setLinkSuccess(null);
    try {
      const res = await fetch("/api/topdesk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "link",
          topdeskNumber: linkingTicket.number,
          workItemInput: linkInput.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLinkError(data.error || `Link failed (${res.status})`);
        return;
      }
      setLinkSuccess(
        data.alreadyLinked
          ? `Work item #${data.id} was already linked to this ticket.`
          : `Linked work item #${data.id} (${data.type} — ${data.state}) to ticket ${linkingTicket.number}.`
      );
      // Refresh inbox in the background; keep the modal open with the success message
      runSearch();
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Connection error");
    } finally {
      setLinkBusy(false);
    }
  }, [linkingTicket, linkInput, runSearch]);

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
        className="rounded-xl bg-bg-card p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1 text-xs text-text-muted">
            <span>Operator</span>
            <div className="rounded-lg bg-bg-secondary px-3 py-2 text-sm text-text-secondary">
              {OPERATOR_NAME}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            <span>TOPdesk status</span>
            <select
              value={pendingOpen}
              onChange={(e) => setPendingOpen(e.target.value as OpenFilter)}
              className="rounded-lg bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:ring-1 focus:ring-accent-blue"
            >
              <option value="open">Open only</option>
              <option value="closed">Closed only</option>
              <option value="all">All</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            <span>DevOps link</span>
            <select
              value={pendingLink}
              onChange={(e) => setPendingLink(e.target.value as "all" | "missing" | "linked")}
              className="rounded-lg bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:ring-1 focus:ring-accent-blue"
            >
              <option value="all">All tickets</option>
              <option value="missing">No DevOps item</option>
              <option value="linked">Has DevOps item</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-4">
            <span className="text-text-muted">
              <span className="text-text-primary font-medium">{summary.total}</span> tickets ·{" "}
              <span className="text-stale-fresh font-medium">{summary.linked}</span> linked ·{" "}
              <span className="text-accent-gold font-medium">{summary.missing}</span> missing
              {summary.readyToClose > 0 && (
                <>
                  {" · "}
                  <span className="text-stale-fresh font-medium">{summary.readyToClose}</span> ready to close
                </>
              )}
            </span>
            {lastFetchedAt && (
              <span className="text-xs text-text-muted">
                Updated {lastFetchedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/90 disabled:opacity-50"
          >
            {loading ? "Søger…" : "Søg"}
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-xl bg-stale-ancient/10 p-4 text-sm text-stale-ancient">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl bg-bg-card">
        <table className="w-full text-sm">
          <thead className="bg-bg-secondary text-xs uppercase text-text-muted">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Ticket</th>
              <th className="px-4 py-3 text-left font-medium">Title</th>
              <th className="px-4 py-3 text-left font-medium">Caller</th>
              <th className="px-4 py-3 text-left font-medium">Category</th>
              <th className="px-4 py-3 text-left font-medium">Priority</th>
              <th className="px-4 py-3 text-left font-medium">TOPdesk status</th>
              <th className="px-4 py-3 text-left font-medium">Created</th>
              <th className="px-4 py-3 text-left font-medium">DevOps</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && tickets.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-text-muted">
                  Loading TOPdesk tickets…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-text-muted">
                  No tickets match the current filters.
                </td>
              </tr>
            )}
            {filtered.map((ticket) => {
              const hasLinked = ticket.devopsWorkItems.length > 0;
              const readyToClose = isReadyToClose(ticket);
              return (
                <tr
                  key={ticket.id}
                  className={clsx(
                    "border-t border-bg-secondary hover:bg-bg-secondary/40",
                    readyToClose && "bg-stale-fresh/5"
                  )}
                >
                  <td className={clsx("px-4 py-3 align-top", readyToClose && "border-l-4 border-stale-fresh")}>
                    <a
                      href={ticket.webUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-accent-blue hover:underline"
                    >
                      {ticket.number}
                    </a>
                  </td>
                  <td className="px-4 py-3 align-top text-text-primary">
                    {ticket.title}
                  </td>
                  <td className="px-4 py-3 align-top text-text-secondary">
                    <div>{ticket.callerName ?? "—"}</div>
                    {ticket.callerEmail && (
                      <div className="text-xs text-text-muted">{ticket.callerEmail}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-text-secondary">
                    {ticket.category ?? "—"}
                    {ticket.subcategory && (
                      <div className="text-xs text-text-muted">{ticket.subcategory}</div>
                    )}
                  </td>
                  <td className={clsx("px-4 py-3 align-top font-medium", priorityColor(ticket.priorityLevel))}>
                    {ticket.priority ?? "—"}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <span className="rounded-full bg-bg-secondary px-2 py-0.5 text-xs text-text-secondary">
                      {ticket.processingStatus ?? (ticket.closed ? "Closed" : ticket.status ?? "—")}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-text-muted">
                    {formatDate(ticket.callDate)}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {hasLinked ? (
                      <div className="flex flex-col gap-1">
                        {readyToClose && (
                          <span
                            className="inline-flex w-fit items-center gap-1 rounded-full bg-stale-fresh/15 px-2 py-0.5 text-[11px] font-semibold text-stale-fresh"
                            title="All linked DevOps work items are done — safe to close this TOPdesk ticket"
                          >
                            <span aria-hidden>✓</span> Klar til at lukke
                          </span>
                        )}
                        {ticket.devopsWorkItems.map((wi) => (
                          <a
                            key={wi.id}
                            href={wi.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs hover:underline"
                            title={`${wi.type} · ${wi.state}${wi.assignedTo ? ` · ${wi.assignedTo}` : ""}`}
                          >
                            <WorkItemTypeIcon type={wi.type} />
                            <span className="font-mono text-accent-blue">#{wi.id}</span>
                            <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-medium", stateColor(wi.state))}>
                              {wi.state}
                            </span>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-stale-stale">No DevOps item</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!hasLinked && (
                        <button
                          onClick={() => handleCreate(ticket.number)}
                          className="rounded-lg bg-accent-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-blue/90"
                        >
                          Create
                        </button>
                      )}
                      <button
                        onClick={() => startLink(ticket)}
                        className="rounded-lg border border-bg-secondary px-3 py-1.5 text-xs text-text-muted hover:text-text-primary"
                        title="Link an existing DevOps work item to this ticket"
                      >
                        Link
                      </button>
                      {hasLinked && (
                        <button
                          onClick={() => handleCreate(ticket.number)}
                          className="rounded-lg border border-bg-secondary px-3 py-1.5 text-xs text-text-muted hover:text-text-primary"
                          title="Create another DevOps item linked to this ticket"
                        >
                          Create +
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <LinkModal
        ticket={linkingTicket}
        input={linkInput}
        onInputChange={setLinkInput}
        onSubmit={submitLink}
        onCancel={cancelLink}
        busy={linkBusy}
        error={linkError}
        success={linkSuccess}
      />
    </div>
  );
}

interface LinkModalProps {
  ticket: InboxTicket | null;
  input: string;
  onInputChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
  success: string | null;
}

function LinkModal({ ticket, input, onInputChange, onSubmit, onCancel, busy, error, success }: LinkModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (ticket && !dialog.open) {
      dialog.showModal();
      setTimeout(() => inputRef.current?.focus(), 50);
    } else if (!ticket && dialog.open) {
      dialog.close();
    }
  }, [ticket]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!ticket) return;
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [ticket, onCancel]);

  if (!ticket) return null;

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-auto w-full max-w-lg rounded-xl bg-bg-card p-0 shadow-2xl backdrop:bg-black/60"
      onClose={onCancel}
    >
      <form
        className="p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (success) {
            onCancel();
          } else {
            onSubmit();
          }
        }}
      >
        <h3 className="mb-1 text-lg font-bold text-text-primary">Link DevOps work item</h3>
        <p className="mb-4 text-sm text-text-secondary">
          Linking an existing work item to TOPdesk ticket{" "}
          <span className="font-mono text-accent-blue">{ticket.number}</span> — {ticket.title}
        </p>

        <label className="block text-xs font-medium text-text-muted">
          Azure DevOps URL or work item ID
        </label>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="https://dev.azure.com/.../_workitems/edit/12345  or  12345"
          disabled={busy || !!success}
          className="mt-1 w-full rounded-lg bg-bg-secondary px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent-blue disabled:opacity-50"
        />
        <p className="mt-1 text-[11px] text-text-muted">
          The system will add the <code className="font-mono">TOPdesk:{ticket.number}</code> tag to the work item.
        </p>

        {error && (
          <div className="mt-4 rounded-lg bg-stale-ancient/10 px-3 py-2 text-sm text-stale-ancient">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-4 rounded-lg bg-stale-fresh/10 px-3 py-2 text-sm text-stale-fresh">
            ✓ {success}
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-lg bg-bg-secondary px-4 py-2.5 text-sm font-medium text-text-secondary hover:text-text-primary disabled:opacity-50"
          >
            {success ? "Close" : "Cancel"}
          </button>
          {!success && (
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="flex-1 rounded-lg bg-accent-blue px-4 py-2.5 text-sm font-bold text-white hover:bg-accent-blue/90 disabled:opacity-50"
            >
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Linking…
                </span>
              ) : (
                "Link"
              )}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
