"use client";

import { useState, useRef } from "react";
import clsx from "clsx";
import type { WorkItem, WorkItemWithChildren, Iteration } from "@/types/devops";
import { formatDate } from "@/lib/utils";
import { StaleIndicator } from "./StaleIndicator";
import { WorkItemTypeIcon } from "./WorkItemTypeIcon";
import { ConfirmDialog } from "./ConfirmDialog";
import { StateSelector } from "./StateSelector";
import { PbiDetailPanel } from "./PbiDetailPanel";

interface PbiTreeViewProps {
  items: WorkItemWithChildren[];
  loading: boolean;
  availableStates: string[];
  availableAssignees: string[];
  iterations: Iteration[];
  onDelete: (id: number) => Promise<void>;
  onBulkDelete: (ids: number[]) => Promise<{ succeeded: number[]; failed: { id: number; error: string }[] }>;
  onStateChange: (id: number, newState: string) => Promise<void>;
  onChildCreated: (parentId: number, child: WorkItem) => void;
  onFieldsUpdated: (id: number, fields: { iterationPath?: string; assignedTo?: string | null; description?: string }) => void;
  onChildrenSprintChanged: (parentId: number, childIds: number[], iterationPath: string) => void;
}

function InlineHoursInput({ itemId, initialValue }: { itemId: number; initialValue: number | null }) {
  const [value, setValue] = useState(initialValue != null ? String(initialValue) : "");
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(initialValue);

  async function commit() {
    const num = value ? Number(value) : null;
    if (num === savedRef.current) return;
    setSaving(true);
    try {
      const res = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId, fields: { remainingWork: num } }),
      });
      if (res.ok) savedRef.current = num;
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      type="number"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
      min="0"
      step="0.5"
      placeholder="—"
      disabled={saving}
      className="w-12 shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-center text-xs font-mono text-text-muted outline-none transition-colors hover:border-border-default focus:border-border-focus focus:bg-bg-input disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      title="Remaining hours"
    />
  );
}

function ChildRow({ item, availableStates, onDelete, onStateChange }: { item: WorkItem; availableStates: string[]; onDelete: (id: number) => Promise<void>; onStateChange: (id: number, newState: string) => Promise<void> }) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    setDeleting(true);
    try { await onDelete(item.id); } finally { setDeleting(false); setDeleteOpen(false); }
  }

  return (
    <>
      <div className="group flex items-center gap-3 border-t border-border-default/50 bg-bg-primary py-2.5 pl-14 pr-5 transition-colors hover:bg-bg-card-hover">
        <span className="text-border-default">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" d="M9 4v8h12" />
          </svg>
        </span>

        <WorkItemTypeIcon type={item.type} />
        <span className="w-14 shrink-0 text-xs font-mono text-text-muted">#{item.id}</span>

        <a href={item.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1">
          <p className="truncate text-sm text-text-secondary hover:text-accent-blue">{item.title}</p>
        </a>

        <StateSelector currentState={item.state} availableStates={availableStates} onStateChange={(s) => onStateChange(item.id, s)} />

        <InlineHoursInput itemId={item.id} initialValue={item.remainingWork} />

        <div className="hidden w-32 shrink-0 md:block">
          {item.assignedTo ? (
            <span className="text-xs text-text-muted">{item.assignedTo}</span>
          ) : (
            <span className="text-xs italic text-text-muted/50">Unassigned</span>
          )}
        </div>

        <div className="hidden w-20 shrink-0 text-right lg:block">
          <p className="text-xs text-text-muted">{formatDate(item.changedDate)}</p>
        </div>

        <button
          onClick={() => setDeleteOpen(true)}
          className="shrink-0 rounded-lg p-1.5 text-text-muted opacity-0 transition-all hover:bg-stale-ancient/15 hover:text-stale-ancient group-hover:opacity-100"
          title="Delete"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete work item?"
        description="This will permanently delete the work item from Azure DevOps."
        detail={`#${item.id} \u2014 ${item.title}`}
        confirmLabel="Yes, delete permanently"
        onConfirm={handleConfirm}
        onCancel={() => setDeleteOpen(false)}
        loading={deleting}
      />
    </>
  );
}

function PbiRow({ pbi, availableStates, availableAssignees, iterations, onDelete, onStateChange, onChildCreated, onFieldsUpdated, onChildrenSprintChanged }: {
  pbi: WorkItemWithChildren;
  availableStates: string[];
  availableAssignees: string[];
  iterations: Iteration[];
  onDelete: (id: number) => Promise<void>;
  onStateChange: (id: number, newState: string) => Promise<void>;
  onChildCreated: (parentId: number, child: WorkItem) => void;
  onFieldsUpdated: (id: number, fields: { iterationPath?: string; assignedTo?: string | null; description?: string }) => void;
  onChildrenSprintChanged: (parentId: number, childIds: number[], iterationPath: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const doneCount = pbi.children.filter((c) => c.state === "Done" || c.state === "Closed").length;
  const totalChildren = pbi.children.length;
  const progress = totalChildren > 0 ? Math.round((doneCount / totalChildren) * 100) : 0;

  async function handleConfirm() {
    setDeleting(true);
    try { await onDelete(pbi.id); } finally { setDeleting(false); setDeleteOpen(false); }
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border-default bg-bg-card">
        <div
          className="group flex cursor-pointer items-center gap-4 px-5 py-4 transition-colors hover:bg-bg-card-hover"
          onClick={() => setExpanded((e) => !e)}
        >
          <button className="shrink-0 text-text-muted">
            <svg className={clsx("h-4 w-4 transition-transform", expanded && "rotate-90")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <WorkItemTypeIcon type={pbi.type} />
          <span className="w-16 shrink-0 text-xs font-mono text-text-muted">#{pbi.id}</span>

          <div className="min-w-0 flex-1">
            <a href={pbi.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="block truncate text-sm font-medium text-text-primary hover:text-accent-blue">
              {pbi.title}
            </a>
            <div className="mt-0.5 flex items-center gap-3 text-xs text-text-muted">
              <span>{pbi.state}</span>
              {pbi.iterationPath && pbi.iterationPath !== "Relaunch - Charlie Tango" && (
                <>
                  <span className="text-border-default">|</span>
                  <span className="truncate">{pbi.iterationPath.replace("Relaunch - Charlie Tango\\", "")}</span>
                </>
              )}
            </div>
          </div>

          {totalChildren > 0 && (
            <div className="hidden shrink-0 items-center gap-2 lg:flex">
              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-bg-secondary">
                <div className={clsx("h-full rounded-full transition-all", progress === 100 ? "bg-stale-fresh" : progress >= 50 ? "bg-accent-blue" : "bg-stale-aging")} style={{ width: `${progress}%` }} />
              </div>
              <span className="text-xs text-text-muted">{doneCount}/{totalChildren}</span>
            </div>
          )}

          <span className="shrink-0 rounded-md bg-bg-secondary px-2 py-0.5 text-xs font-medium text-text-muted">
            {totalChildren} {totalChildren === 1 ? "child" : "children"}
          </span>

          <div onClick={(e) => e.stopPropagation()}>
            <StateSelector currentState={pbi.state} availableStates={availableStates} onStateChange={(s) => onStateChange(pbi.id, s)} />
          </div>

          <span className={clsx("shrink-0 text-xs font-bold", pbi.priority === 1 && "text-stale-ancient", pbi.priority === 2 && "text-stale-stale", pbi.priority === 3 && "text-stale-aging", pbi.priority === 4 && "text-text-muted")}>
            P{pbi.priority}
          </span>

          <div className="hidden w-32 shrink-0 md:block">
            {pbi.assignedTo ? (
              <span className="text-xs text-text-secondary">{pbi.assignedTo}</span>
            ) : (
              <span className="text-xs italic text-text-muted">Unassigned</span>
            )}
          </div>

          <div className="hidden w-36 shrink-0 xl:block">
            <StaleIndicator changedDate={pbi.changedDate} />
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); setDeleteOpen(true); }}
            className="shrink-0 rounded-lg p-2 text-text-muted opacity-0 transition-all hover:bg-stale-ancient/15 hover:text-stale-ancient group-hover:opacity-100"
            title="Delete PBI"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>

        {expanded && (
          <>
            <PbiDetailPanel
              workItemId={pbi.id}
              childItems={pbi.children}
              availableStates={availableStates}
              availableAssignees={availableAssignees}
              iterations={iterations}
              onClose={() => setExpanded(false)}
              onChildCreated={(child) => onChildCreated(pbi.id, child)}
              onFieldsUpdated={onFieldsUpdated}
              onStateChange={onStateChange}
              onChildrenSprintChanged={(childIds, iterationPath) => onChildrenSprintChanged(pbi.id, childIds, iterationPath)}
            />

            {totalChildren > 0 && (
              <div>
                {pbi.children.map((child) => (
                  <ChildRow key={child.id} item={child} availableStates={availableStates} onDelete={onDelete} onStateChange={onStateChange} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete PBI?"
        description="This will permanently delete the PBI from Azure DevOps. Child items will not be deleted."
        detail={`#${pbi.id} \u2014 ${pbi.title}`}
        confirmLabel="Yes, delete permanently"
        onConfirm={handleConfirm}
        onCancel={() => setDeleteOpen(false)}
        loading={deleting}
      />
    </>
  );
}

export function PbiTreeView({ items, loading, availableStates, availableAssignees, iterations, onDelete, onBulkDelete, onStateChange, onChildCreated, onFieldsUpdated, onChildrenSprintChanged }: PbiTreeViewProps) {
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
        <p className="text-text-muted">No PBIs found with the selected filters.</p>
      </div>
    );
  }

  const totalChildren = items.reduce((sum, pbi) => sum + pbi.childCount, 0);
  const totalDone = items.reduce((sum, pbi) => sum + pbi.children.filter((c) => c.state === "Done" || c.state === "Closed").length, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 rounded-xl border border-border-default bg-bg-secondary px-5 py-3">
        <span className="text-sm text-text-secondary">
          <strong className="text-text-primary">{items.length}</strong> PBIs
        </span>
        <span className="text-border-default">|</span>
        <span className="text-sm text-text-secondary">
          <strong className="text-text-primary">{totalChildren}</strong> child items total
        </span>
        {totalChildren > 0 && (
          <>
            <span className="text-border-default">|</span>
            <span className="text-sm text-text-secondary">
              <strong className="text-stale-fresh">{totalDone}</strong> done
              {" / "}
              <strong className="text-stale-aging">{totalChildren - totalDone}</strong> active
            </span>
          </>
        )}
      </div>

      {items.map((pbi) => (
        <PbiRow
          key={pbi.id}
          pbi={pbi}
          availableStates={availableStates}
          availableAssignees={availableAssignees}
          iterations={iterations}
          onDelete={onDelete}
          onStateChange={onStateChange}
          onChildCreated={onChildCreated}
          onFieldsUpdated={onFieldsUpdated}
          onChildrenSprintChanged={onChildrenSprintChanged}
        />
      ))}
    </div>
  );
}
