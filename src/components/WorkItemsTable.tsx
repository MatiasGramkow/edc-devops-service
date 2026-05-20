"use client";

import { useState, useMemo, useCallback } from "react";
import clsx from "clsx";
import type { WorkItem, SortField, SortDirection } from "@/types/devops";
import { formatDate, daysSince } from "@/lib/utils";
import { StaleIndicator } from "./StaleIndicator";
import { WorkItemTypeIcon } from "./WorkItemTypeIcon";
import { ConfirmDialog } from "./ConfirmDialog";
import { StateSelector } from "./StateSelector";

interface WorkItemsTableProps {
  items: WorkItem[];
  loading: boolean;
  availableStates: string[];
  onDelete: (id: number) => Promise<void>;
  onBulkDelete: (ids: number[], onProgress?: (done: number, total: number) => void) => Promise<{ succeeded: number[]; failed: { id: number; error: string }[] }>;
  onStateChange: (id: number, newState: string) => Promise<void>;
}

const sortableColumns: { key: SortField; label: string }[] = [
  { key: "changedDate", label: "Last changed" },
  { key: "createdDate", label: "Created" },
  { key: "priority", label: "Priority" },
  { key: "state", label: "State" },
  { key: "assignedTo", label: "Assigned" },
];

export function WorkItemsTable({ items, loading, availableStates, onDelete, onBulkDelete, onStateChange }: WorkItemsTableProps) {
  const [sortField, setSortField] = useState<SortField>("changedDate");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [deleteTarget, setDeleteTarget] = useState<WorkItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Selection state
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "changedDate":
          cmp = new Date(a.changedDate).getTime() - new Date(b.changedDate).getTime();
          break;
        case "createdDate":
          cmp = new Date(a.createdDate).getTime() - new Date(b.createdDate).getTime();
          break;
        case "priority":
          cmp = a.priority - b.priority;
          break;
        case "state":
          cmp = a.state.localeCompare(b.state);
          break;
        case "assignedTo":
          cmp = (a.assignedTo ?? "").localeCompare(b.assignedTo ?? "");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, sortField, sortDir]);

  const allVisibleIds = useMemo(() => new Set(sorted.map((i) => i.id)), [sorted]);
  const allSelected = selected.size > 0 && selected.size === allVisibleIds.size;
  const someSelected = selected.size > 0 && !allSelected;

  const validSelected = useMemo(() => {
    const valid = new Set<number>();
    for (const id of selected) {
      if (allVisibleIds.has(id)) valid.add(id);
    }
    return valid;
  }, [selected, allVisibleIds]);

  const selectedCount = validSelected.size;

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allVisibleIds));
  }, [allSelected, allVisibleIds]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await onDelete(deleteTarget.id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  async function handleConfirmBulkDelete() {
    const ids = [...validSelected];
    setBulkDeleting(true);
    setBulkProgress(`Deleting 0 / ${ids.length}...`);

    try {
      const result = await onBulkDelete(ids, (done, total) => {
        setBulkProgress(`Deleting ${done} / ${total}...`);
      });

      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of result.succeeded) next.delete(id);
        return next;
      });

      if (result.failed.length > 0) {
        setBulkProgress(`${result.succeeded.length} deleted, ${result.failed.length} failed`);
        setTimeout(() => setBulkProgress(null), 5000);
      } else {
        setBulkProgress(null);
      }
    } finally {
      setBulkDeleting(false);
      setBulkConfirmOpen(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border-default bg-bg-card p-12 text-center">
        <p className="text-text-muted">No work items found with the selected filters.</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border-default bg-bg-card">
        {/* Summary bar */}
        <div className="flex items-center justify-between border-b border-border-default bg-bg-secondary px-5 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSelectAll}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border-default bg-bg-input transition-colors hover:border-accent-blue"
              title={allSelected ? "Deselect all" : "Select all"}
            >
              {allSelected && (
                <svg className="h-3.5 w-3.5 text-accent-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {someSelected && <span className="h-0.5 w-2.5 rounded bg-accent-blue" />}
            </button>
            <span className="text-sm text-text-secondary">
              <strong className="text-text-primary">{items.length}</strong> work items found
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-text-muted">
            {sortableColumns.map((col) => (
              <button
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={clsx(
                  "transition-colors hover:text-text-primary",
                  sortField === col.key && "text-accent-blue"
                )}
              >
                {col.label}
                {sortField === col.key && (sortDir === "asc" ? " \u2191" : " \u2193")}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="divide-y divide-border-default">
          {sorted.map((item) => {
            const isSelected = selected.has(item.id);
            return (
              <div
                key={item.id}
                className={clsx(
                  "group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-bg-card-hover",
                  isSelected && "bg-accent-blue/5"
                )}
              >
                <button
                  onClick={() => toggleSelect(item.id)}
                  className={clsx(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
                    isSelected
                      ? "border-accent-blue bg-accent-blue"
                      : "border-border-default bg-bg-input hover:border-accent-blue"
                  )}
                >
                  {isSelected && (
                    <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>

                <WorkItemTypeIcon type={item.type} />

                <span className="w-16 shrink-0 text-xs font-mono text-text-muted">#{item.id}</span>

                <a href={item.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary hover:text-accent-blue">{item.title}</p>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-text-muted">
                    <span>{item.type}</span>
                    <span className="text-border-default">|</span>
                    <span>{item.state}</span>
                    {item.iterationPath && (
                      <>
                        <span className="text-border-default">|</span>
                        <span className="truncate">{item.iterationPath}</span>
                      </>
                    )}
                  </div>
                </a>

                {/* State selector */}
                <StateSelector
                  currentState={item.state}
                  availableStates={availableStates}
                  onStateChange={(newState) => onStateChange(item.id, newState)}
                />

                <div className="hidden w-36 shrink-0 md:block">
                  {item.assignedTo ? (
                    <span className="text-xs text-text-secondary">{item.assignedTo}</span>
                  ) : (
                    <span className="text-xs italic text-text-muted">Unassigned</span>
                  )}
                </div>

                <div className="hidden w-8 shrink-0 text-center lg:block">
                  <span className={clsx(
                    "text-xs font-bold",
                    item.priority === 1 && "text-stale-ancient",
                    item.priority === 2 && "text-stale-stale",
                    item.priority === 3 && "text-stale-aging",
                    item.priority === 4 && "text-text-muted"
                  )}>
                    P{item.priority}
                  </span>
                </div>

                <div className="hidden w-40 shrink-0 lg:block">
                  <StaleIndicator changedDate={item.changedDate} />
                </div>

                <div className="hidden w-28 shrink-0 text-right xl:block">
                  <p className="text-xs text-text-muted">{formatDate(item.changedDate)}</p>
                  <p className="text-xs text-text-muted/60">{daysSince(item.changedDate)}d ago</p>
                </div>

                <button
                  onClick={() => setDeleteTarget(item)}
                  className="shrink-0 rounded-lg p-2 text-text-muted opacity-0 transition-all hover:bg-stale-ancient/15 hover:text-stale-ancient group-hover:opacity-100"
                  title="Delete work item"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating bulk action bar */}
      {selectedCount > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-xl border border-border-default bg-bg-secondary px-5 py-3 shadow-2xl">
          <span className="text-sm text-text-secondary">
            <strong className="text-text-primary">{selectedCount}</strong> selected
          </span>

          {bulkProgress && <span className="text-xs text-accent-gold">{bulkProgress}</span>}

          <button
            onClick={clearSelection}
            className="rounded-lg px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-bg-card-hover hover:text-text-primary"
          >
            Deselect
          </button>
          <button
            onClick={() => setBulkConfirmOpen(true)}
            disabled={bulkDeleting}
            className="rounded-lg bg-stale-ancient px-4 py-1.5 text-sm font-bold text-white transition-colors hover:bg-stale-ancient/80 disabled:opacity-50"
          >
            Delete {selectedCount} items
          </button>
        </div>
      )}

      {/* Single delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete work item?"
        description="This will permanently delete the work item from Azure DevOps. This cannot be undone."
        detail={deleteTarget ? `#${deleteTarget.id} \u2014 ${deleteTarget.title}` : undefined}
        confirmLabel="Yes, delete permanently"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />

      {/* Bulk delete confirmation */}
      <ConfirmDialog
        open={bulkConfirmOpen}
        title={`Delete ${selectedCount} work items?`}
        description={`You are about to permanently delete ${selectedCount} work items from Azure DevOps. This cannot be undone.`}
        detail={[...validSelected].slice(0, 5).map((id) => `#${id}`).join(", ") + (selectedCount > 5 ? ` and ${selectedCount - 5} more...` : "")}
        confirmLabel={`Yes, delete all ${selectedCount}`}
        onConfirm={handleConfirmBulkDelete}
        onCancel={() => setBulkConfirmOpen(false)}
        loading={bulkDeleting}
      />
    </>
  );
}
