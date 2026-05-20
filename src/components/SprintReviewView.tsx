"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import clsx from "clsx";
import type { Iteration, WorkItemWithChildren, WorkItem } from "@/types/devops";
import { WorkItemTypeIcon } from "./WorkItemTypeIcon";

// --- Types ---

interface SprintReviewViewProps {
  iterations: Iteration[];
}

interface GroupedItems {
  parentId: number | null;
  parentTitle: string | null;
  items: WorkItemWithChildren[];
}

// --- Constants ---

const DONE_STATES = new Set(["Done", "Closed", "Removed"]);

const DEVOPS_BASE = "https://dev.azure.com/edc-group/Relaunch%20-%20Charlie%20Tango/_workitems/edit";

// --- Helpers ---

function getCurrentSprint(iterations: Iteration[]): Iteration | undefined {
  const now = new Date();
  return iterations.find(
    (i) =>
      i.startDate &&
      i.finishDate &&
      new Date(i.startDate) <= now &&
      new Date(i.finishDate) >= now
  );
}

function getRelevantIterations(iterations: Iteration[]): Iteration[] {
  const now = new Date();
  return iterations
    .filter((i) => i.startDate && i.finishDate)
    .filter(
      (i) =>
        new Date(i.finishDate!) >=
        new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    )
    .sort(
      (a, b) =>
        new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime()
    );
}

function sprintLabel(
  iteration: Iteration,
  current: Iteration | undefined
): string {
  if (current && iteration.id === current.id)
    return `${iteration.name} (current)`;
  return iteration.name;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getItemTotalHours(item: WorkItemWithChildren): number {
  return item.children.reduce(
    (sum, c) => sum + (c.remainingWork ?? 0),
    0
  );
}

function getItemCompletedTaskCount(item: WorkItemWithChildren): number {
  return item.children.filter((c) => DONE_STATES.has(c.state)).length;
}

function groupItemsByParent(
  items: WorkItemWithChildren[]
): GroupedItems[] {
  const groupMap = new Map<string, GroupedItems>();

  for (const item of items) {
    const key =
      item.parentId != null ? String(item.parentId) : "__ungrouped__";

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        parentId: item.parentId ?? null,
        parentTitle: item.parentTitle ?? null,
        items: [],
      });
    }
    groupMap.get(key)!.items.push(item);
  }

  const groups = Array.from(groupMap.values());
  // Sort: groups with parent first (alphabetical), ungrouped last
  groups.sort((a, b) => {
    if (a.parentId === null && b.parentId !== null) return 1;
    if (a.parentId !== null && b.parentId === null) return -1;
    return (a.parentTitle ?? "").localeCompare(b.parentTitle ?? "");
  });

  return groups;
}

function priorityLabel(p: number): string {
  switch (p) {
    case 1:
      return "P1";
    case 2:
      return "P2";
    case 3:
      return "P3";
    case 4:
      return "P4";
    default:
      return "";
  }
}

function stateBadgeColor(state: string): string {
  if (DONE_STATES.has(state)) return "bg-stale-fresh/15 text-stale-fresh";
  if (state === "Active") return "bg-accent-blue/15 text-accent-blue";
  if (state === "New") return "bg-accent-gold/15 text-accent-gold";
  return "bg-text-muted/15 text-text-muted";
}

// --- Report Generation ---

function generateReportHtml(
  items: WorkItemWithChildren[],
  groups: GroupedItems[],
  sprintName: string,
  startDate: string | null,
  finishDate: string | null,
  sprintGoal: string
): string {
  const completedCount = items.length;
  const totalHours = items.reduce(
    (sum, item) => sum + getItemTotalHours(item),
    0
  );
  const taskCount = items.reduce(
    (sum, item) => sum + item.children.length,
    0
  );

  const goalSection = sprintGoal
    ? `<div class="sprint-goal"><strong>Sprint Goal:</strong> ${escapeHtml(sprintGoal)}</div>`
    : "";

  let tableRows = "";
  for (const group of groups) {
    const groupTitle =
      group.parentTitle ??
      (group.parentId
        ? `Parent #${group.parentId}`
        : "Ungrouped");
    tableRows += `<tr class="group-header"><td colspan="5">${escapeHtml(groupTitle)}</td></tr>\n`;

    for (const item of group.items) {
      const hours = getItemTotalHours(item);
      tableRows += `<tr><td>${escapeHtml(item.type)}</td><td>#${item.id}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.state)}</td><td>${hours}h</td></tr>\n`;

      for (const child of item.children) {
        tableRows += `<tr class="task-row"><td></td><td>#${child.id}</td><td>${escapeHtml(child.title)}</td><td>${escapeHtml(child.state)}</td><td>${child.remainingWork ?? 0}h</td></tr>\n`;
      }
    }
  }

  const now = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `<!DOCTYPE html>
<html>
<head>
  <title>Sprint Review Report — ${escapeHtml(sprintName)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 40px auto; color: #1a1a1a; line-height: 1.5; }
    h1 { border-bottom: 2px solid #2985cc; padding-bottom: 8px; }
    h2 { margin-top: 32px; color: #333; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 24px 0; }
    .summary-card { background: #f5f5f5; padding: 16px; border-radius: 8px; text-align: center; }
    .summary-card .value { font-size: 28px; font-weight: bold; color: #2985cc; }
    .summary-card .label { font-size: 12px; color: #666; text-transform: uppercase; margin-top: 4px; }
    .items-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .items-table th, .items-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; }
    .items-table th { background: #f5f5f5; font-size: 11px; text-transform: uppercase; color: #666; }
    .group-header { background: #fafafa; font-weight: 600; }
    .task-row { font-size: 13px; color: #555; }
    .task-row td:first-child { padding-left: 32px; }
    @media print { body { margin: 20px; } }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; font-size: 11px; color: #999; }
    .sprint-goal { background: #f0f8ff; padding: 12px 16px; border-left: 3px solid #2985cc; margin: 16px 0; border-radius: 4px; }
    .date-range { color: #666; margin-top: -8px; }
  </style>
</head>
<body>
  <h1>Sprint Review — ${escapeHtml(sprintName)}</h1>
  <p class="date-range">${formatDate(startDate)} – ${formatDate(finishDate)}</p>

  ${goalSection}

  <div class="summary">
    <div class="summary-card"><div class="value">${completedCount}</div><div class="label">Items Completed</div></div>
    <div class="summary-card"><div class="value">${totalHours}h</div><div class="label">Hours Completed</div></div>
    <div class="summary-card"><div class="value">${taskCount}</div><div class="label">Tasks Done</div></div>
  </div>

  <h2>Completed Items</h2>
  <table class="items-table">
    <thead>
      <tr><th>Type</th><th>ID</th><th>Title</th><th>State</th><th>Hours</th></tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <div class="footer">
    Generated ${now} &middot; EDC DevOps Service
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- Main Component ---

export function SprintReviewView({ iterations }: SprintReviewViewProps) {
  const [completedItems, setCompletedItems] = useState<
    WorkItemWithChildren[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIterationId, setSelectedIterationId] = useState<
    string | null
  >(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [meetingMode, setMeetingMode] = useState(false);
  const [meetingIndex, setMeetingIndex] = useState(0);
  const [sprintGoal, setSprintGoal] = useState("");

  const errorTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const currentSprint = useMemo(
    () => getCurrentSprint(iterations),
    [iterations]
  );
  const relevantIterations = useMemo(
    () => getRelevantIterations(iterations),
    [iterations]
  );

  // Set initial iteration to current sprint
  useEffect(() => {
    if (iterations.length > 0 && !selectedIterationId) {
      const cs = getCurrentSprint(iterations);
      if (cs) setSelectedIterationId(cs.id);
      else if (iterations.length > 0) setSelectedIterationId(iterations[0].id);
    }
  }, [iterations, selectedIterationId]);

  const selectedIteration = useMemo(
    () => iterations.find((i) => i.id === selectedIterationId),
    [iterations, selectedIterationId]
  );

  // Fetch completed items
  const fetchItems = useCallback(async () => {
    if (!selectedIteration?.path) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/work-items?action=completed-sprint&iterationPath=${encodeURIComponent(selectedIteration.path)}`
      );
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      setCompletedItems(data.items ?? []);
      setSelectedItemId(null);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Failed to load completed items";
      setError(msg);
      clearTimeout(errorTimeout.current);
      errorTimeout.current = setTimeout(() => setError(null), 8000);
    } finally {
      setLoading(false);
    }
  }, [selectedIteration?.path]);

  // Fetch sprint goal
  const fetchGoal = useCallback(async () => {
    if (!selectedIterationId) {
      setSprintGoal("");
      return;
    }
    try {
      const res = await fetch(
        `/api/work-items?action=sprint-goals&iterationId=${selectedIterationId}`
      );
      if (!res.ok) return;
      const data = await res.json();
      setSprintGoal(data?.text ?? "");
    } catch {
      // Silently fail for goal fetch
    }
  }, [selectedIterationId]);

  useEffect(() => {
    fetchItems();
    fetchGoal();
  }, [fetchItems, fetchGoal]);

  // Grouped items
  const groups = useMemo(
    () => groupItemsByParent(completedItems),
    [completedItems]
  );

  // Flat ordered list for meeting mode navigation
  const flatItems = useMemo(() => {
    const flat: WorkItemWithChildren[] = [];
    for (const g of groups) {
      for (const item of g.items) {
        flat.push(item);
      }
    }
    return flat;
  }, [groups]);

  // Summary stats
  const totalHours = useMemo(
    () =>
      completedItems.reduce((sum, item) => sum + getItemTotalHours(item), 0),
    [completedItems]
  );
  const totalTasks = useMemo(
    () =>
      completedItems.reduce((sum, item) => sum + item.children.length, 0),
    [completedItems]
  );

  // Selected item
  const selectedItem = useMemo(
    () => completedItems.find((i) => i.id === selectedItemId) ?? null,
    [completedItems, selectedItemId]
  );

  // Meeting mode item
  const meetingItem = useMemo(
    () => flatItems[meetingIndex] ?? null,
    [flatItems, meetingIndex]
  );

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      )
        return;

      switch (e.key) {
        case "m":
          setMeetingMode((prev) => !prev);
          break;
        case "j":
        case "ArrowDown":
          if (meetingMode) {
            e.preventDefault();
            setMeetingIndex((prev) =>
              Math.min(prev + 1, flatItems.length - 1)
            );
          }
          break;
        case "k":
        case "ArrowUp":
          if (meetingMode) {
            e.preventDefault();
            setMeetingIndex((prev) => Math.max(prev - 1, 0));
          }
          break;
        case "Escape":
          if (meetingMode) {
            setMeetingMode(false);
          }
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [meetingMode, flatItems.length]);

  // Enter meeting mode synced with selected item
  const enterMeetingMode = useCallback(() => {
    const idx = selectedItemId
      ? flatItems.findIndex((i) => i.id === selectedItemId)
      : 0;
    setMeetingIndex(idx >= 0 ? idx : 0);
    setMeetingMode(true);
  }, [selectedItemId, flatItems]);

  // Generate report
  const generateReport = useCallback(() => {
    const html = generateReportHtml(
      completedItems,
      groups,
      selectedIteration?.name ?? "Sprint",
      selectedIteration?.startDate ?? null,
      selectedIteration?.finishDate ?? null,
      sprintGoal
    );
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  }, [completedItems, groups, selectedIteration, sprintGoal]);

  // --- Meeting Mode Render ---
  if (meetingMode) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-bg-primary">
        {/* Meeting mode content */}
        <div className="flex flex-1 flex-col items-center justify-center px-8">
          {meetingItem ? (
            <div className="w-full max-w-3xl space-y-8 text-center">
              {/* State badge */}
              <div className="flex items-center justify-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-stale-fresh/15 px-4 py-1.5 text-sm font-semibold text-stale-fresh">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  {meetingItem.state}
                </span>
              </div>

              {/* Meta line */}
              <div className="flex items-center justify-center gap-3 text-sm text-text-muted">
                <WorkItemTypeIcon type={meetingItem.type} />
                <span>{meetingItem.type}</span>
                <span className="text-text-muted/40">|</span>
                <span>#{meetingItem.id}</span>
                {meetingItem.priority > 0 && (
                  <>
                    <span className="text-text-muted/40">|</span>
                    <span>{priorityLabel(meetingItem.priority)}</span>
                  </>
                )}
              </div>

              {/* Title */}
              <h1 className="text-4xl font-bold leading-tight text-text-primary">
                {meetingItem.title}
              </h1>

              {/* Assignee */}
              {meetingItem.assignedTo && (
                <p className="text-lg text-text-secondary">
                  Assigned to: {meetingItem.assignedTo}
                </p>
              )}

              {/* Tasks */}
              {meetingItem.children.length > 0 && (
                <div className="mx-auto max-w-lg space-y-3 text-left">
                  <h3 className="text-center text-sm font-medium uppercase tracking-wider text-text-muted">
                    Tasks completed
                  </h3>
                  <div className="space-y-2">
                    {meetingItem.children.map((child) => (
                      <div
                        key={child.id}
                        className="flex items-center gap-3 rounded-lg bg-bg-card px-4 py-2.5"
                      >
                        <svg
                          className={clsx(
                            "h-4 w-4 flex-shrink-0",
                            DONE_STATES.has(child.state)
                              ? "text-stale-fresh"
                              : "text-text-muted"
                          )}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        <WorkItemTypeIcon type={child.type} />
                        <span className="flex-1 truncate text-sm text-text-primary">
                          {child.title}
                        </span>
                        {child.remainingWork != null && (
                          <span className="text-sm text-text-muted">
                            {child.remainingWork}h
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary */}
              <p className="text-text-secondary">
                Total: {getItemTotalHours(meetingItem)}h{" "}
                <span className="text-text-muted/40 mx-1">&middot;</span>{" "}
                {meetingItem.children.length} task
                {meetingItem.children.length !== 1 ? "s" : ""}
              </p>
            </div>
          ) : (
            <p className="text-text-muted">No items to display.</p>
          )}
        </div>

        {/* Navigation bar */}
        <div className="flex items-center justify-center gap-6 border-t border-border-default bg-bg-secondary px-6 py-4">
          <button
            onClick={() =>
              setMeetingIndex((prev) => Math.max(prev - 1, 0))
            }
            disabled={meetingIndex <= 0}
            className="rounded-lg bg-bg-card px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-bg-card-hover disabled:opacity-30 disabled:cursor-not-allowed"
          >
            &larr; Prev
          </button>

          <div className="text-center">
            <span className="text-sm font-semibold text-text-primary">
              {flatItems.length > 0 ? meetingIndex + 1 : 0} /{" "}
              {flatItems.length}
            </span>
            <div className="text-xs text-text-muted">(j/k)</div>
          </div>

          <button
            onClick={() =>
              setMeetingIndex((prev) =>
                Math.min(prev + 1, flatItems.length - 1)
              )
            }
            disabled={meetingIndex >= flatItems.length - 1}
            className="rounded-lg bg-bg-card px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-bg-card-hover disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Next &rarr;
          </button>

          <div className="ml-6 border-l border-border-default pl-6">
            <button
              onClick={() => setMeetingMode(false)}
              className="rounded-lg bg-bg-card px-4 py-2 text-sm text-text-secondary transition hover:bg-bg-card-hover"
            >
              [Esc] Exit
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- List Mode Render ---
  return (
    <div className="flex h-full flex-col">
      {/* Error toast */}
      {error && (
        <div className="mx-4 mt-2 rounded-lg bg-stale-ancient/15 px-4 py-2 text-sm text-stale-ancient">
          {error}
        </div>
      )}

      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border-default bg-bg-secondary px-4 py-3">
        {/* Sprint selector */}
        <select
          value={selectedIterationId ?? ""}
          onChange={(e) => setSelectedIterationId(e.target.value || null)}
          className="rounded-lg border border-border-default bg-bg-card px-3 py-1.5 text-sm text-text-primary focus:border-border-focus focus:outline-none"
        >
          {relevantIterations.map((it) => (
            <option key={it.id} value={it.id}>
              {sprintLabel(it, currentSprint)}
            </option>
          ))}
        </select>

        {/* Divider */}
        <span className="h-5 w-px bg-border-default" />

        {/* Stats badges */}
        <span className="rounded-md bg-stale-fresh/10 px-2.5 py-1 text-xs font-medium text-stale-fresh">
          {completedItems.length} completed
        </span>
        <span className="rounded-md bg-accent-blue/10 px-2.5 py-1 text-xs font-medium text-accent-blue">
          {totalHours}h
        </span>

        <div className="flex-1" />

        {/* Action buttons */}
        <button
          onClick={enterMeetingMode}
          disabled={completedItems.length === 0}
          className={clsx(
            "rounded-lg px-3 py-1.5 text-sm font-medium transition",
            "bg-accent-teal/15 text-accent-teal hover:bg-accent-teal/25",
            "disabled:opacity-40 disabled:cursor-not-allowed"
          )}
        >
          <span className="flex items-center gap-1.5">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"
              />
            </svg>
            Meeting
          </span>
        </button>

        <button
          onClick={generateReport}
          disabled={completedItems.length === 0}
          className={clsx(
            "rounded-lg px-3 py-1.5 text-sm font-medium transition",
            "bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25",
            "disabled:opacity-40 disabled:cursor-not-allowed"
          )}
        >
          <span className="flex items-center gap-1.5">
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
            Generate Report
          </span>
        </button>

        <button
          onClick={fetchItems}
          disabled={loading}
          className="rounded-lg bg-bg-card px-3 py-1.5 text-sm text-text-secondary transition hover:bg-bg-card-hover disabled:opacity-40"
          title="Refresh"
        >
          <svg
            className={clsx("h-4 w-4", loading && "animate-spin")}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
            />
          </svg>
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <svg
              className="h-8 w-8 animate-spin text-accent-blue"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="text-sm text-text-muted">
              Loading completed items...
            </span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && completedItems.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-text-muted">
            <svg
              className="h-12 w-12 opacity-30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
              />
            </svg>
            <p className="text-sm">No completed items in this sprint</p>
          </div>
        </div>
      )}

      {/* Main content: sidebar + detail */}
      {!loading && completedItems.length > 0 && (
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-[280px] flex-shrink-0 overflow-y-auto border-r border-border-default bg-bg-secondary p-3">
            {/* Sprint goal */}
            {sprintGoal && (
              <div className="mb-3 rounded-lg border border-accent-blue/20 bg-accent-blue/5 px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-accent-blue">
                  Sprint Goal
                </div>
                <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                  {sprintGoal}
                </p>
              </div>
            )}

            {groups.map((group) => (
              <div key={group.parentId ?? "__ungrouped__"} className="mb-4">
                {/* Group header */}
                <div className="mb-1.5 flex items-center gap-2 px-1">
                  {group.parentId ? (
                    <a
                      href={`${DEVOPS_BASE}/${group.parentId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-xs font-semibold text-text-muted hover:text-accent-blue"
                      title={group.parentTitle ?? undefined}
                    >
                      {group.parentTitle ?? `#${group.parentId}`}
                    </a>
                  ) : (
                    <span className="text-xs font-semibold text-text-muted">
                      Ungrouped
                    </span>
                  )}
                  <span className="text-[10px] text-text-muted/60">
                    ({group.items.length})
                  </span>
                </div>

                {/* Items */}
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const hours = getItemTotalHours(item);
                    const isSelected = item.id === selectedItemId;

                    return (
                      <button
                        key={item.id}
                        onClick={() => setSelectedItemId(item.id)}
                        className={clsx(
                          "w-full rounded-lg px-3 py-2 text-left transition-all",
                          isSelected
                            ? "bg-accent-teal/12 ring-1 ring-accent-teal/30"
                            : "hover:bg-bg-card-hover"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          {/* Green checkmark */}
                          <svg
                            className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-stale-fresh"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          <WorkItemTypeIcon type={item.type} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-text-muted">
                                #{item.id}
                              </span>
                            </div>
                            <p className="line-clamp-2 text-xs leading-snug text-text-primary">
                              {item.title}
                            </p>
                          </div>
                        </div>
                        {hours > 0 && (
                          <div className="mt-1 pl-8 text-[10px] text-text-muted">
                            {hours}h
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Detail panel */}
          <div className="flex-1 overflow-y-auto p-6">
            {selectedItem ? (
              <div className="mx-auto max-w-2xl space-y-6">
                {/* Header */}
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <WorkItemTypeIcon type={selectedItem.type} />
                    <span className="text-sm text-text-muted">
                      #{selectedItem.id}
                    </span>
                    <span
                      className={clsx(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        stateBadgeColor(selectedItem.state)
                      )}
                    >
                      {selectedItem.state}
                    </span>
                    {selectedItem.priority > 0 && (
                      <span className="rounded-md bg-text-muted/10 px-2 py-0.5 text-xs text-text-muted">
                        {priorityLabel(selectedItem.priority)}
                      </span>
                    )}
                    <a
                      href={`${DEVOPS_BASE}/${selectedItem.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-xs text-accent-blue hover:underline"
                    >
                      Open in DevOps
                      <svg
                        className="ml-0.5 inline h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                        />
                      </svg>
                    </a>
                  </div>

                  <h2 className="mt-3 text-xl font-bold text-text-primary">
                    {selectedItem.title}
                  </h2>
                </div>

                {/* Metadata */}
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  {selectedItem.assignedTo && (
                    <div>
                      <span className="text-text-muted">Assignee: </span>
                      <span className="text-text-primary">
                        {selectedItem.assignedTo}
                      </span>
                    </div>
                  )}
                  <div>
                    <span className="text-text-muted">Sprint: </span>
                    <span className="text-text-primary">
                      {selectedItem.iterationPath.split("\\").pop()}
                    </span>
                  </div>
                  {selectedItem.tags && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-text-muted">Tags: </span>
                      {selectedItem.tags.split(";").map((tag) => (
                        <span
                          key={tag.trim()}
                          className="rounded bg-text-muted/10 px-1.5 py-0.5 text-xs text-text-secondary"
                        >
                          {tag.trim()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tasks section */}
                {selectedItem.children.length > 0 && (
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-text-secondary">
                      Tasks ({selectedItem.children.length})
                    </h3>
                    <div className="space-y-1.5">
                      {selectedItem.children.map((child) => (
                        <div
                          key={child.id}
                          className={clsx(
                            "flex items-center gap-3 rounded-lg bg-bg-card px-4 py-2.5",
                            DONE_STATES.has(child.state) && "opacity-70"
                          )}
                        >
                          <svg
                            className={clsx(
                              "h-4 w-4 flex-shrink-0",
                              DONE_STATES.has(child.state)
                                ? "text-stale-fresh"
                                : "text-text-muted"
                            )}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          <WorkItemTypeIcon type={child.type} />
                          <span className="flex-1 truncate text-sm text-text-primary">
                            {child.title}
                          </span>
                          <span
                            className={clsx(
                              "rounded-full px-2 py-0.5 text-xs font-medium",
                              stateBadgeColor(child.state)
                            )}
                          >
                            {child.state}
                          </span>
                          {child.remainingWork != null && (
                            <span className="text-sm tabular-nums text-text-muted">
                              {child.remainingWork}h
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Summary */}
                <div className="rounded-lg border border-border-default bg-bg-card px-4 py-3">
                  <div className="flex items-center gap-4 text-sm">
                    <div>
                      <span className="text-text-muted">Total hours: </span>
                      <span className="font-semibold text-text-primary">
                        {getItemTotalHours(selectedItem)}h
                      </span>
                    </div>
                    <span className="h-4 w-px bg-border-default" />
                    <div>
                      <span className="text-text-muted">Tasks: </span>
                      <span className="font-semibold text-text-primary">
                        {selectedItem.children.length}
                      </span>
                    </div>
                    <span className="h-4 w-px bg-border-default" />
                    <div>
                      <span className="text-text-muted">Done: </span>
                      <span className="font-semibold text-stale-fresh">
                        {getItemCompletedTaskCount(selectedItem)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              // No selection placeholder
              <div className="flex h-full items-center justify-center text-text-muted">
                <div className="text-center">
                  <svg
                    className="mx-auto mb-3 h-10 w-10 opacity-30"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59"
                    />
                  </svg>
                  <p className="text-sm">
                    Select an item from the sidebar to view details
                  </p>
                  <p className="mt-1 text-xs text-text-muted/60">
                    Press <kbd className="rounded border border-border-default bg-bg-card px-1 py-0.5 text-[10px]">m</kbd> for meeting mode
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
