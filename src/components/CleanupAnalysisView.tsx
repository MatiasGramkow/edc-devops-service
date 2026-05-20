"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import clsx from "clsx";
import type { WorkItemWithChildren } from "@/types/devops";
import { daysSince, formatDate, stalenessLevel } from "@/lib/utils";
import { WorkItemTypeIcon } from "./WorkItemTypeIcon";
import { ConfirmDialog } from "./ConfirmDialog";

type CleanupFlag = "no-assignee" | "no-children" | "stuck-new" | "stuck-active";
type StalenessFilter = "all" | "aging" | "stale" | "ancient";
type SortField = "age" | "state" | "type" | "assignedTo" | "childCount" | "priority";

interface AnalyzedItem {
  item: WorkItemWithChildren;
  age: number;
  level: ReturnType<typeof stalenessLevel>;
  flags: CleanupFlag[];
}

interface CleanupAnalysisViewProps {
  availableAssignees: string[];
}

function getFlags(item: WorkItemWithChildren): CleanupFlag[] {
  const flags: CleanupFlag[] = [];
  const age = daysSince(item.changedDate);
  if (!item.assignedTo) flags.push("no-assignee");
  if (item.childCount === 0) flags.push("no-children");
  if (item.state === "New" && age >= 60) flags.push("stuck-new");
  if (item.state === "Active" && age >= 90) flags.push("stuck-active");
  return flags;
}

const FLAG_LABELS: Record<CleanupFlag, string> = {
  "no-assignee": "No assignee",
  "no-children": "No tasks",
  "stuck-new": "Stuck in New",
  "stuck-active": "Stuck in Active",
};

const FLAG_COLORS: Record<CleanupFlag, string> = {
  "no-assignee": "bg-accent-gold/15 text-accent-gold",
  "no-children": "bg-accent-blue/15 text-accent-blue",
  "stuck-new": "bg-stale-stale/15 text-stale-stale",
  "stuck-active": "bg-stale-ancient/15 text-stale-ancient",
};

const AGE_OPTIONS = [30, 60, 90, 180, 365] as const;

export function CleanupAnalysisView({ availableAssignees }: CleanupAnalysisViewProps) {
  const [items, setItems] = useState<WorkItemWithChildren[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Filters
  const [minAge, setMinAge] = useState<number>(90);
  const [stalenessFilter, setStalenessFilter] = useState<StalenessFilter>("all");
  const [flagFilter, setFlagFilter] = useState<CleanupFlag | "all">("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");

  // Sort
  const [sortField, setSortField] = useState<SortField>("age");
  const [sortAsc, setSortAsc] = useState(false);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Bulk actions
  const [tagging, setTagging] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const actionTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  function showError(msg: string) {
    setError(msg);
    clearTimeout(errorTimeout.current);
    errorTimeout.current = setTimeout(() => setError(null), 8000);
  }

  function showAction(msg: string) {
    setActionMsg(msg);
    clearTimeout(actionTimeout.current);
    actionTimeout.current = setTimeout(() => setActionMsg(null), 6000);
  }

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-items?action=cleanup-analysis&minAgeDays=${minAge}`);
      const data = await res.json();
      if (!res.ok) { showError(data.error || "Failed to fetch"); return; }
      setItems(data.items);
      setSelectedIds(new Set());
    } catch {
      showError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  }, [minAge]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Analyze items
  const analysis = useMemo(() => {
    const analyzed: AnalyzedItem[] = items.map((item) => ({
      item,
      age: daysSince(item.changedDate),
      level: stalenessLevel(daysSince(item.changedDate)),
      flags: getFlags(item),
    }));

    return {
      items: analyzed,
      total: items.length,
      aging: analyzed.filter((i) => i.level === "aging").length,
      stale: analyzed.filter((i) => i.level === "stale").length,
      ancient: analyzed.filter((i) => i.level === "ancient").length,
      noAssignee: analyzed.filter((i) => i.flags.includes("no-assignee")).length,
      noChildren: analyzed.filter((i) => i.flags.includes("no-children")).length,
      stuckNew: analyzed.filter((i) => i.flags.includes("stuck-new")).length,
      stuckActive: analyzed.filter((i) => i.flags.includes("stuck-active")).length,
    };
  }, [items]);

  // Filter + sort
  const filteredItems = useMemo(() => {
    let result = analysis.items;

    if (stalenessFilter !== "all") {
      result = result.filter((i) => i.level === stalenessFilter);
    }
    if (flagFilter !== "all") {
      result = result.filter((i) => i.flags.includes(flagFilter));
    }
    if (stateFilter !== "all") {
      result = result.filter((i) => i.item.state === stateFilter);
    }
    if (typeFilter !== "all") {
      result = result.filter((i) => i.item.type === typeFilter);
    }
    if (assigneeFilter !== "all") {
      if (assigneeFilter === "__none__") {
        result = result.filter((i) => !i.item.assignedTo);
      } else {
        result = result.filter((i) => i.item.assignedTo === assigneeFilter);
      }
    }

    return [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "age": cmp = a.age - b.age; break;
        case "state": cmp = a.item.state.localeCompare(b.item.state); break;
        case "type": cmp = a.item.type.localeCompare(b.item.type); break;
        case "assignedTo": cmp = (a.item.assignedTo ?? "zzz").localeCompare(b.item.assignedTo ?? "zzz"); break;
        case "childCount": cmp = a.item.childCount - b.item.childCount; break;
        case "priority": cmp = a.item.priority - b.item.priority; break;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [analysis.items, stalenessFilter, flagFilter, stateFilter, typeFilter, assigneeFilter, sortField, sortAsc]);

  // Derived filter options from data
  const dataStates = useMemo(() => [...new Set(items.map((i) => i.state))].sort(), [items]);
  const dataTypes = useMemo(() => [...new Set(items.map((i) => i.type))].sort(), [items]);

  // Selection helpers
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredItems.length && filteredItems.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map((i) => i.item.id)));
    }
  };

  // Bulk tag as "Needs Review"
  const handleBulkTag = async () => {
    const toTag = items.filter(
      (i) => selectedIds.has(i.id) && !i.tags.split(";").map((t) => t.trim()).includes("Needs Review")
    );
    if (toTag.length === 0) {
      showAction("All selected items already have the \"Needs Review\" tag");
      return;
    }

    setTagging(true);
    let done = 0;
    let failed = 0;

    for (const item of toTag) {
      const currentTags = item.tags ? item.tags.split(";").map((t) => t.trim()).filter(Boolean) : [];
      currentTags.push("Needs Review");
      const newTags = currentTags.join("; ");

      try {
        const res = await fetch("/api/work-items", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id, fields: { tags: newTags } }),
        });
        if (res.ok) {
          done++;
          setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, tags: newTags } : i));
        } else { failed++; }
      } catch { failed++; }
    }

    setTagging(false);
    showAction(`Tagged ${done} item${done !== 1 ? "s" : ""} as "Needs Review"${failed > 0 ? ` (${failed} failed)` : ""}`);
    setSelectedIds(new Set());
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    setDeleting(true);

    const BATCH_SIZE = 50;
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      try {
        const res = await fetch("/api/work-items", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: batch }),
        });
        const data = await res.json();
        if (res.ok) {
          const succeededIds = new Set(data.succeeded as number[]);
          succeeded += succeededIds.size;
          failed += (data.failed?.length ?? 0);
          setItems((prev) => prev.filter((item) => !succeededIds.has(item.id)));
        } else {
          failed += batch.length;
        }
      } catch {
        failed += batch.length;
      }
    }

    setDeleting(false);
    setDeleteConfirm(false);
    setSelectedIds(new Set());
    showAction(`Deleted ${succeeded} item${succeeded !== 1 ? "s" : ""}${failed > 0 ? ` (${failed} failed)` : ""}`);
  };

  // CSV export
  const exportCsv = () => {
    const headers = ["ID", "Type", "Title", "State", "Assigned To", "Created", "Last Updated", "Age (days)", "Staleness", "Children", "Flags", "Sprint", "Tags", "URL"];
    const rows = filteredItems.map((i) => [
      i.item.id,
      i.item.type,
      `"${i.item.title.replace(/"/g, '""')}"`,
      i.item.state,
      i.item.assignedTo ?? "",
      formatDate(i.item.createdDate),
      formatDate(i.item.changedDate),
      i.age,
      i.level,
      i.item.childCount,
      `"${i.flags.map((f) => FLAG_LABELS[f]).join("; ")}"`,
      i.item.iterationPath,
      `"${i.item.tags.replace(/"/g, '""')}"`,
      i.item.url,
    ].join(","));

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cleanup-analysis-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Sort toggle
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(field === "priority");
    }
  };

  const SortHeader = ({ field, label, className }: { field: SortField; label: string; className?: string }) => (
    <button
      onClick={() => handleSort(field)}
      className={clsx("flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-text-muted hover:text-text-secondary transition-colors", className)}
    >
      {label}
      {sortField === field && <span className="text-accent-blue">{sortAsc ? "\u2191" : "\u2193"}</span>}
    </button>
  );

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard
          label="Total stale"
          value={analysis.total}
          color="text-text-primary"
          loading={loading}
        />
        <SummaryCard
          label="Aging (30-89d)"
          value={analysis.aging}
          color="text-stale-aging"
          loading={loading}
          onClick={() => setStalenessFilter(stalenessFilter === "aging" ? "all" : "aging")}
          active={stalenessFilter === "aging"}
        />
        <SummaryCard
          label="Stale (90-179d)"
          value={analysis.stale}
          color="text-stale-stale"
          loading={loading}
          onClick={() => setStalenessFilter(stalenessFilter === "stale" ? "all" : "stale")}
          active={stalenessFilter === "stale"}
        />
        <SummaryCard
          label="Ancient (180d+)"
          value={analysis.ancient}
          color="text-stale-ancient"
          loading={loading}
          onClick={() => setStalenessFilter(stalenessFilter === "ancient" ? "all" : "ancient")}
          active={stalenessFilter === "ancient"}
        />
      </div>

      {/* Flag summary */}
      <div className="flex flex-wrap gap-2">
        {([
          ["no-assignee", analysis.noAssignee],
          ["no-children", analysis.noChildren],
          ["stuck-new", analysis.stuckNew],
          ["stuck-active", analysis.stuckActive],
        ] as [CleanupFlag, number][]).map(([flag, count]) => (
          <button
            key={flag}
            onClick={() => setFlagFilter(flagFilter === flag ? "all" : flag)}
            className={clsx(
              "rounded-lg border px-3 py-1.5 text-sm font-medium transition-all",
              flagFilter === flag
                ? "border-accent-blue bg-accent-blue/15 text-accent-blue"
                : "border-border-default bg-bg-card text-text-secondary hover:bg-bg-card-hover"
            )}
          >
            {FLAG_LABELS[flag]}: {count}
          </button>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Min age */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Not updated in</span>
          <div className="flex gap-1">
            {AGE_OPTIONS.map((days) => (
              <button
                key={days}
                onClick={() => setMinAge(days)}
                className={clsx(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  minAge === days
                    ? "bg-accent-blue/20 text-accent-blue"
                    : "bg-bg-card text-text-muted hover:text-text-secondary"
                )}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>

        <div className="h-5 w-px bg-border-default" />

        {/* State filter */}
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded-lg border border-border-default bg-bg-input px-3 py-1.5 text-sm text-text-secondary"
        >
          <option value="all">All states</option>
          {dataStates.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-border-default bg-bg-input px-3 py-1.5 text-sm text-text-secondary"
        >
          <option value="all">All types</option>
          {dataTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {/* Assignee filter */}
        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="rounded-lg border border-border-default bg-bg-input px-3 py-1.5 text-sm text-text-secondary"
        >
          <option value="all">All assignees</option>
          <option value="__none__">Unassigned</option>
          {availableAssignees.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <div className="flex-1" />

        {/* CSV export */}
        <button
          onClick={exportCsv}
          disabled={filteredItems.length === 0}
          className="rounded-lg border border-border-default bg-bg-card px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-card-hover hover:text-text-primary disabled:opacity-40"
        >
          Export CSV
        </button>

        {/* Refresh */}
        <button
          onClick={fetchItems}
          disabled={loading}
          className="rounded-lg border border-border-default bg-bg-card px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-card-hover hover:text-text-primary disabled:opacity-40"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-stale-ancient/30 bg-stale-ancient/10 px-5 py-3 text-sm text-stale-ancient">
          {error}
        </div>
      )}

      {/* Action message */}
      {actionMsg && (
        <div className="rounded-xl border border-accent-teal/30 bg-accent-teal/10 px-5 py-3 text-sm text-accent-teal">
          {actionMsg}
        </div>
      )}

      {/* Selection action bar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center gap-3 rounded-xl border border-accent-blue/30 bg-bg-secondary px-5 py-3 shadow-lg">
          <span className="text-sm font-medium text-text-primary">
            {selectedIds.size} selected
          </span>
          <div className="flex-1" />
          <button
            onClick={handleBulkTag}
            disabled={tagging}
            className="rounded-lg bg-accent-gold/15 px-4 py-1.5 text-sm font-medium text-accent-gold transition-colors hover:bg-accent-gold/25 disabled:opacity-50"
          >
            {tagging ? "Tagging..." : "Tag \"Needs Review\""}
          </button>
          <button
            onClick={() => setDeleteConfirm(true)}
            className="rounded-lg bg-stale-ancient/15 px-4 py-1.5 text-sm font-medium text-stale-ancient transition-colors hover:bg-stale-ancient/25"
          >
            Delete selected
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="rounded-lg px-3 py-1.5 text-sm text-text-muted hover:text-text-secondary"
          >
            Clear
          </button>
        </div>
      )}

      {/* Items list */}
      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-xl border border-border-default bg-bg-card px-8 py-12 text-center">
          <p className="text-text-muted">
            {items.length === 0 ? "No stale items found" : "No items match the current filters"}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Table header */}
          <div className="flex items-center gap-3 rounded-lg bg-bg-secondary px-4 py-2">
            <input
              type="checkbox"
              checked={selectedIds.size === filteredItems.length && filteredItems.length > 0}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-border-default accent-accent-blue"
            />
            <div className="w-8" /> {/* type icon */}
            <SortHeader field="type" label="Type" className="w-10" />
            <div className="flex-1">
              <span className="text-xs font-medium uppercase tracking-wider text-text-muted">Title</span>
            </div>
            <SortHeader field="state" label="State" className="w-20" />
            <SortHeader field="assignedTo" label="Assignee" className="w-28" />
            <SortHeader field="age" label="Age" className="w-24" />
            <SortHeader field="childCount" label="Tasks" className="w-14" />
            <SortHeader field="priority" label="Pri" className="w-10" />
            <div className="w-24">
              <span className="text-xs font-medium uppercase tracking-wider text-text-muted">Flags</span>
            </div>
            <div className="w-8" /> {/* link icon */}
          </div>

          {/* Rows */}
          {filteredItems.map((analyzed) => (
            <CleanupRow
              key={analyzed.item.id}
              analyzed={analyzed}
              selected={selectedIds.has(analyzed.item.id)}
              onToggle={() => toggleSelect(analyzed.item.id)}
            />
          ))}

          {/* Footer */}
          <div className="rounded-lg bg-bg-secondary px-4 py-2 text-xs text-text-muted">
            Showing {filteredItems.length} of {analysis.total} items
          </div>
        </div>
      )}

      {/* Confirm delete */}
      <ConfirmDialog
        open={deleteConfirm}
        title="Delete work items"
        description={`Are you sure you want to delete ${selectedIds.size} work item${selectedIds.size !== 1 ? "s" : ""}? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleBulkDelete}
        onCancel={() => setDeleteConfirm(false)}
        loading={deleting}
      />
    </div>
  );
}

// --- Sub-components ---

function SummaryCard({
  label,
  value,
  color,
  loading,
  onClick,
  active,
}: {
  label: string;
  value: number;
  color: string;
  loading: boolean;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={clsx(
        "rounded-xl border bg-bg-card p-4 text-left transition-all",
        active
          ? "border-accent-blue/50 bg-accent-blue/5"
          : "border-border-default hover:border-border-default/80",
        onClick ? "cursor-pointer" : "cursor-default"
      )}
    >
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className={clsx("mt-1 text-2xl font-bold", color)}>
        {loading ? "-" : value}
      </p>
    </button>
  );
}

function CleanupRow({
  analyzed,
  selected,
  onToggle,
}: {
  analyzed: AnalyzedItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const { item, age, level, flags } = analyzed;

  const levelColors = {
    fresh: "text-stale-fresh",
    aging: "text-stale-aging",
    stale: "text-stale-stale",
    ancient: "text-stale-ancient",
  };

  const levelDot = {
    fresh: "bg-stale-fresh",
    aging: "bg-stale-aging",
    stale: "bg-stale-stale",
    ancient: "bg-stale-ancient",
  };

  const stateColors: Record<string, string> = {
    New: "bg-accent-blue/15 text-accent-blue",
    Active: "bg-accent-teal/15 text-accent-teal",
    Resolved: "bg-accent-gold/15 text-accent-gold",
  };

  return (
    <div
      className={clsx(
        "group flex items-center gap-3 rounded-lg border px-4 py-2.5 transition-colors",
        selected
          ? "border-accent-blue/30 bg-accent-blue/5"
          : "border-transparent bg-bg-card hover:bg-bg-card-hover"
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="h-4 w-4 rounded border-border-default accent-accent-blue"
      />

      <div className="w-8 flex-shrink-0">
        <WorkItemTypeIcon type={item.type} />
      </div>

      <span className="w-10 flex-shrink-0 text-xs text-text-muted font-mono">
        {item.id}
      </span>

      <div className="flex-1 min-w-0">
        <span className="truncate text-sm text-text-primary">{item.title}</span>
      </div>

      <div className="w-20 flex-shrink-0">
        <span className={clsx("inline-block rounded-md px-2 py-0.5 text-xs font-medium", stateColors[item.state] ?? "bg-bg-secondary text-text-muted")}>
          {item.state}
        </span>
      </div>

      <div className="w-28 flex-shrink-0 truncate text-xs text-text-secondary" title={item.assignedTo ?? "Unassigned"}>
        {item.assignedTo ?? <span className="text-text-muted">Unassigned</span>}
      </div>

      <div className="w-24 flex-shrink-0 flex items-center gap-1.5">
        <span className={clsx("inline-block h-2 w-2 rounded-full", levelDot[level])} />
        <span className={clsx("text-xs font-medium", levelColors[level])}>
          {age}d
        </span>
      </div>

      <div className="w-14 flex-shrink-0 text-xs text-text-secondary text-center">
        {item.childCount > 0 ? item.childCount : <span className="text-text-muted">0</span>}
      </div>

      <div className="w-10 flex-shrink-0 text-xs text-text-secondary text-center">
        P{item.priority}
      </div>

      <div className="w-24 flex-shrink-0 flex flex-wrap gap-1">
        {flags.map((flag) => (
          <span
            key={flag}
            className={clsx("rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight", FLAG_COLORS[flag])}
            title={FLAG_LABELS[flag]}
          >
            {flag === "no-assignee" ? "NA" : flag === "no-children" ? "NT" : flag === "stuck-new" ? "SN" : "SA"}
          </span>
        ))}
      </div>

      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="w-8 flex-shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent-blue"
        title="Open in Azure DevOps"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
        </svg>
      </a>
    </div>
  );
}
