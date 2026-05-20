"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import clsx from "clsx";
import type { WorkItem, WorkItemWithChildren, WorkItemDetails } from "@/types/devops";
import { WorkItemTypeIcon } from "./WorkItemTypeIcon";
import { StateSelector } from "./StateSelector";
import { RichHtmlContent } from "./RichHtmlContent";

// --- Constants ---

const DONE_STATES = new Set(["Done", "Closed", "Removed"]);

const GROOMING_STATE = "Team Grooming";

// Refinement only shows items in Team Grooming state. The 3 valid Refinement states
// (New, Qualification, Team Grooming) are all allowed in the dropdown so an item can
// be demoted back to "idea" — it will disappear from this view on next fetch.
const REFINEMENT_ITEM_STATES = ["New", "Qualification", GROOMING_STATE];

const TASK_PRESETS = [
  { key: "dev", label: "Development", activity: "Development", tag: "Development", color: "bg-accent-blue text-white" },
  { key: "qa", label: "QA", activity: "QA", tag: "QA", color: "bg-accent-gold text-white" },
  { key: "release", label: "Release", activity: "Release", tag: "Release", color: "bg-stale-fresh text-white" },
  { key: "other", label: "Other", activity: "Development", tag: "", color: "bg-text-muted/20 text-text-primary border border-border-default" },
] as const;

interface RefinementViewProps {
  availableStates: string[];
  availableAssignees: string[];
}

// --- Helpers ---

function sanitizeHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

interface ChecklistResult {
  descriptionOk: boolean;
  acceptanceCriteriaOk: boolean;
  tasksCreated: boolean;
  tasksEstimated: boolean;
  passCount: number;
  total: number;
}

function evaluateChecklist(details: WorkItemDetails | null, item: WorkItemWithChildren): ChecklistResult {
  const descriptionOk = !!details?.description && stripHtml(details.description).length > 10;
  const acceptanceCriteriaOk = !!details?.acceptanceCriteria && stripHtml(details.acceptanceCriteria).length > 10;
  const tasksCreated = item.children.length > 0;
  const tasksEstimated = tasksCreated && item.children.every((c) => DONE_STATES.has(c.state) || (c.remainingWork != null && c.remainingWork > 0));

  const checks = [descriptionOk, acceptanceCriteriaOk, tasksCreated, tasksEstimated];
  const passCount = checks.filter(Boolean).length;

  return { descriptionOk, acceptanceCriteriaOk, tasksCreated, tasksEstimated, passCount, total: 4 };
}

type RefinementStatus = "not-refined" | "in-progress" | "ready";

function refinementStatus(checklist: ChecklistResult): RefinementStatus {
  // Ready = description + acceptance criteria + tasks created & estimated
  if (checklist.descriptionOk && checklist.acceptanceCriteriaOk && checklist.tasksCreated && checklist.tasksEstimated) return "ready";
  if (checklist.passCount > 0) return "in-progress";
  return "not-refined";
}

function statusLabel(status: RefinementStatus): string {
  if (status === "ready") return "Ready";
  if (status === "in-progress") return "In Progress";
  return "Not Refined";
}

function statusColor(status: RefinementStatus): string {
  if (status === "ready") return "bg-stale-fresh/15 text-stale-fresh";
  if (status === "in-progress") return "bg-accent-gold/15 text-accent-gold";
  return "bg-stale-ancient/15 text-stale-ancient";
}

// --- Main component ---

export function RefinementView({ availableStates, availableAssignees }: RefinementViewProps) {
  const [items, setItems] = useState<WorkItemWithChildren[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [details, setDetails] = useState<WorkItemDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [meetingMode, setMeetingMode] = useState(false);
  const [meetingPickerOpen, setMeetingPickerOpen] = useState(false);
  const [selectedParents, setSelectedParents] = useState<Set<string>>(new Set()); // empty = all
  const [detailsCache, setDetailsCache] = useState<Map<number, WorkItemDetails>>(new Map());
  const errorTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  function showError(msg: string) {
    setError(msg);
    clearTimeout(errorTimeout.current);
    errorTimeout.current = setTimeout(() => setError(null), 8000);
  }

  // Fetch items
  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/work-items?action=refinement");
      const data = await res.json();
      if (!res.ok) { showError(data.error || "Failed to load"); return; }
      setItems(data.items);
      if (data.items.length > 0 && !selectedId) {
        setSelectedId(data.items[0].id);
      }
    } catch {
      showError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Fetch details when selection changes
  const fetchDetails = useCallback(async (id: number) => {
    const cached = detailsCache.get(id);
    if (cached) { setDetails(cached); return; }
    setDetailsLoading(true);
    try {
      const res = await fetch(`/api/work-items?action=details&id=${id}`);
      const data = await res.json();
      if (res.ok) {
        setDetails(data);
        setDetailsCache((prev) => new Map(prev).set(id, data));
      }
    } catch { /* ignore */ } finally {
      setDetailsLoading(false);
    }
  }, [detailsCache]);

  useEffect(() => {
    if (selectedId) fetchDetails(selectedId);
    else setDetails(null);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // All items are grooming-state (server-side filter). Group by parent.
  const NO_PARENT_KEY = "__no_parent__";
  function groupByParent(list: WorkItemWithChildren[]) {
    const groups = new Map<string, WorkItemWithChildren[]>();
    const noParent: WorkItemWithChildren[] = [];
    for (const item of list) {
      if (item.parentId && item.parentTitle) {
        const key = `${item.parentId}::${item.parentTitle}`;
        const arr = groups.get(key) ?? [];
        arr.push(item);
        groups.set(key, arr);
      } else {
        noParent.push(item);
      }
    }
    return { groups, noParent };
  }

  const groomingGrouped = groupByParent(items);
  const groomingParentKeys = [...groomingGrouped.groups.keys(), ...(groomingGrouped.noParent.length > 0 ? [NO_PARENT_KEY] : [])];

  const filteredItems = selectedParents.size === 0
    ? items
    : items.filter((item) => {
        if (item.parentId && item.parentTitle) {
          return selectedParents.has(`${item.parentId}::${item.parentTitle}`);
        }
        return selectedParents.has(NO_PARENT_KEY);
      });

  const selectedItem = items.find((i) => i.id === selectedId) ?? null;
  const filteredIdx = filteredItems.findIndex((i) => i.id === selectedId);

  const goNext = useCallback(() => {
    const list = meetingMode ? filteredItems : items;
    const idx = list.findIndex((i) => i.id === selectedId);
    if (idx < list.length - 1) setSelectedId(list[idx + 1].id);
  }, [selectedId, items, filteredItems, meetingMode]);

  const goPrev = useCallback(() => {
    const list = meetingMode ? filteredItems : items;
    const idx = list.findIndex((i) => i.id === selectedId);
    if (idx > 0) setSelectedId(list[idx - 1].id);
  }, [selectedId, items, filteredItems, meetingMode]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); goNext(); }
      if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); goPrev(); }
      if (e.key === "Escape" && meetingMode) { e.preventDefault(); setMeetingMode(false); setSelectedParents(new Set()); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev, meetingMode]);

  // Actions
  const handleStateChange = useCallback(async (id: number, newState: string) => {
    const res = await fetch("/api/work-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, state: newState }),
    });
    if (!res.ok) { showError("Could not update state"); return; }
    const data = await res.json();
    // If the item leaves Team Grooming (demoted to New/Qualification), remove it from view.
    if (data.state !== GROOMING_STATE) {
      setItems((prev) => prev.filter((i) => i.id !== id));
      setDetailsCache((prev) => { const next = new Map(prev); next.delete(id); return next; });
      setSelectedId((prev) => (prev === id ? null : prev));
      return;
    }
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, state: data.state } : item));
  }, []);

  const handleMarkReady = useCallback(async () => {
    if (!selectedItem) return;

    // Team Grooming → Estimated: state=Approved, refinement=false, sprintPlanning=true. Item leaves list.
    const res = await fetch("/api/work-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selectedItem.id, fields: { refinement: false, sprintPlanning: true, state: "Approved" } }),
    });
    if (!res.ok) { showError("Could not mark as estimated"); return; }
    const removedId = selectedItem.id;
    const prevIdx = items.findIndex((i) => i.id === removedId);
    const remaining = items.filter((i) => i.id !== removedId);
    setItems(remaining);
    if (remaining.length > 0) {
      const nextIdx = Math.min(prevIdx, remaining.length - 1);
      setSelectedId(remaining[nextIdx].id);
    } else {
      if (meetingMode) {
        setMeetingMode(false);
        setSelectedParents(new Set());
      }
      setSelectedId(null);
    }
    setDetailsCache((prev) => { const next = new Map(prev); next.delete(removedId); return next; });
  }, [selectedItem, items, meetingMode]);

  const handleDeleteTask = useCallback(async (taskId: number) => {
    const res = await fetch("/api/work-items", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId }),
    });
    if (!res.ok) { showError("Could not delete task"); return; }
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        children: item.children.filter((c) => c.id !== taskId),
        childCount: item.children.filter((c) => c.id !== taskId).length,
      }))
    );
  }, []);

  const handleFieldSaved = useCallback((id: number, field: "description" | "acceptanceCriteria", value: string) => {
    setDetailsCache((prev) => {
      const existing = prev.get(id);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(id, { ...existing, [field]: value });
      return next;
    });
    setDetails((prev) => prev && prev.id === id ? { ...prev, [field]: value } : prev);
  }, []);

  const handleChildCreated = useCallback((parentId: number, child: WorkItem) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === parentId
          ? { ...item, children: [...item.children, child], childCount: item.childCount + 1 }
          : item
      )
    );
  }, []);

  const handleHoursChanged = useCallback((taskId: number, hours: number | null) => {
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        children: item.children.map((c) => c.id === taskId ? { ...c, remainingWork: hours } : c),
      }))
    );
  }, []);

  const handleAssigneeSaved = useCallback((id: number, assignee: string | null) => {
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, assignedTo: assignee } : item));
  }, []);

  // --- Meeting Mode ---
  if (meetingMode && selectedItem) {
    return (
      <MeetingModeView
        item={selectedItem}
        details={details}
        detailsLoading={detailsLoading}
        currentIndex={filteredIdx}
        totalItems={filteredItems.length}
        availableStates={availableStates}
        availableAssignees={availableAssignees}
        onNext={goNext}
        onPrev={goPrev}
        onExit={() => { setMeetingMode(false); setSelectedParents(new Set()); }}
        onStateChange={handleStateChange}
        onMarkReady={handleMarkReady}
        onDeleteTask={handleDeleteTask}
        onFieldSaved={handleFieldSaved}
        onChildCreated={handleChildCreated}
        onHoursChanged={handleHoursChanged}
        onAssigneeSaved={handleAssigneeSaved}
      />
    );
  }

  // --- List Mode ---
  return (
    <div className="flex h-[calc(100vh-140px)] gap-0">
      {/* Sidebar */}
      <div className="w-72 shrink-0 overflow-y-auto border-r border-border-default bg-bg-secondary pr-0">
        {/* Summary bar */}
        <div className="sticky top-0 z-10 border-b border-border-default bg-bg-secondary px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-text-primary">{items.length} ready to estimate</span>
          </div>
          {items.length > 0 && !meetingPickerOpen && (
            <button
              onClick={() => {
                if (groomingParentKeys.length <= 1) {
                  setSelectedParents(new Set());
                  setSelectedId(items[0].id);
                  setMeetingMode(true);
                } else {
                  setMeetingPickerOpen(true);
                }
              }}
              className="mt-2 w-full rounded-lg bg-accent-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-blue/90"
            >
              Start Meeting ({items.length})
            </button>
          )}
          {meetingPickerOpen && (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] font-medium text-text-secondary">Select areas to estimate:</p>
              <div className="space-y-1">
                {[...groomingGrouped.groups.entries()].map(([key, groupItems]) => {
                  const [, parentTitle] = key.split("::");
                  const checked = selectedParents.has(key);
                  return (
                    <label key={key} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-bg-card cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedParents((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key); else next.add(key);
                            return next;
                          });
                        }}
                        className="accent-accent-blue"
                      />
                      <span className="min-w-0 flex-1 truncate text-text-primary">{parentTitle}</span>
                      <span className="text-text-muted">{groupItems.length}</span>
                    </label>
                  );
                })}
                {groomingGrouped.noParent.length > 0 && (
                  <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-bg-card cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedParents.has(NO_PARENT_KEY)}
                      onChange={() => {
                        setSelectedParents((prev) => {
                          const next = new Set(prev);
                          if (next.has(NO_PARENT_KEY)) next.delete(NO_PARENT_KEY); else next.add(NO_PARENT_KEY);
                          return next;
                        });
                      }}
                      className="accent-accent-blue"
                    />
                    <span className="min-w-0 flex-1 truncate text-text-primary">Other</span>
                    <span className="text-text-muted">{groomingGrouped.noParent.length}</span>
                  </label>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const startItems = selectedParents.size === 0 ? items : filteredItems;
                    if (startItems.length > 0) {
                      setSelectedId(startItems[0].id);
                      setMeetingMode(true);
                      setMeetingPickerOpen(false);
                    }
                  }}
                  className="flex-1 rounded-lg bg-accent-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-blue/90"
                >
                  Start ({selectedParents.size === 0 ? items.length : filteredItems.length} items)
                </button>
                <button
                  onClick={() => { setMeetingPickerOpen(false); setSelectedParents(new Set()); }}
                  className="rounded-lg px-3 py-1.5 text-xs text-text-muted hover:text-text-primary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-text-muted">
            No items ready to estimate
          </div>
        )}

        <div className="p-2">
          <RefinementStageSection
            label="Ready for Estimation"
            sublabel="state = Team Grooming"
            count={items.length}
            grouped={groomingGrouped}
            detailsCache={detailsCache}
            selectedId={selectedId}
            onSelect={setSelectedId}
            accentColor="text-accent-blue"
          />
        </div>
      </div>

      {/* Detail panel */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 rounded-xl border border-stale-ancient/30 bg-stale-ancient/10 px-5 py-3 text-sm text-stale-ancient">
            {error}
          </div>
        )}

        {selectedItem && details ? (
          <RefinementDetailPanel
            item={selectedItem}
            details={details}
            availableStates={availableStates}
            availableAssignees={availableAssignees}
            onStateChange={handleStateChange}
            onMarkReady={handleMarkReady}
            onDeleteTask={handleDeleteTask}
            onFieldSaved={handleFieldSaved}
            onChildCreated={handleChildCreated}
            onHoursChanged={handleHoursChanged}
            onAssigneeSaved={handleAssigneeSaved}
          />
        ) : selectedItem && detailsLoading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-text-muted">Select an item to view refinement details</p>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Sidebar item ---

function RefinementSidebarItem({
  item,
  details,
  selected,
  onClick,
}: {
  item: WorkItemWithChildren;
  details: WorkItemDetails | null;
  selected: boolean;
  onClick: () => void;
}) {
  const cl = evaluateChecklist(details, item);
  const status = refinementStatus(cl);

  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full rounded-lg border-l-[3px] px-3 py-2.5 text-left transition-all",
        item.priority === 1 ? "border-l-stale-ancient" : item.priority === 2 ? "border-l-stale-stale" : "border-l-border-default",
        selected
          ? "bg-accent-blue/12 ring-1 ring-accent-blue/30"
          : "hover:bg-bg-card-hover"
      )}
    >
      <div className="flex items-center gap-2">
        <WorkItemTypeIcon type={item.type} />
        <span className="text-[11px] font-mono text-text-muted">#{item.id}</span>
        {details && (
          <span className={clsx("ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-medium", statusColor(status))}>
            {statusLabel(status)}
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-sm font-medium text-text-primary leading-snug">{item.title}</p>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-text-muted">
        <div className="flex items-center gap-1.5">
          <span className={clsx(
            "inline-block h-1.5 w-1.5 rounded-full",
            item.state === "New" ? "bg-accent-blue" : item.state === "Active" ? "bg-stale-fresh" : item.state === "Approved" ? "bg-accent-gold" : "bg-text-muted/40"
          )} />
          <span>{item.state}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {item.children.length > 0 && (
            <span className="tabular-nums">
              {item.children.length}t
              {(() => { const h = item.children.reduce((s, c) => s + (c.remainingWork ?? 0), 0); return h > 0 ? <> · <span className="text-accent-gold">{h}h</span></> : null; })()}
            </span>
          )}
          <span className="tabular-nums text-text-muted">
            {cl.passCount}/{cl.total}
          </span>
        </div>
      </div>
    </button>
  );
}

// --- Stage section (Ideas / Ready for Estimation) ---

function RefinementStageSection({
  label,
  sublabel,
  count,
  grouped,
  detailsCache,
  selectedId,
  onSelect,
  accentColor,
}: {
  label: string;
  sublabel: string;
  count: number;
  grouped: { groups: Map<string, WorkItemWithChildren[]>; noParent: WorkItemWithChildren[] };
  detailsCache: Map<number, WorkItemDetails>;
  selectedId: number | null;
  onSelect: (id: number) => void;
  accentColor: string;
}) {
  if (count === 0) return null;
  return (
    <div className="mb-4">
      <div className="sticky top-0 z-[5] flex items-baseline justify-between border-b border-border-default bg-bg-secondary px-2 py-2">
        <div>
          <span className={clsx("text-xs font-bold uppercase tracking-wider", accentColor)}>{label}</span>
          <span className="ml-1.5 text-[10px] text-text-muted">· {sublabel}</span>
        </div>
        <span className="text-[11px] font-semibold tabular-nums text-text-secondary">{count}</span>
      </div>
      <div className="space-y-1 pt-1">
        {[...grouped.groups.entries()].map(([key, groupItems]) => {
          const [parentIdStr, parentTitle] = key.split("::");
          return (
            <div key={key}>
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <WorkItemTypeIcon type="Feature" />
                <span className="text-[10px] font-mono text-text-muted">#{parentIdStr}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">{parentTitle}</span>
              </div>
              {groupItems.map((item) => (
                <RefinementSidebarItem
                  key={item.id}
                  item={item}
                  details={detailsCache.get(item.id) ?? null}
                  selected={selectedId === item.id}
                  onClick={() => onSelect(item.id)}
                />
              ))}
            </div>
          );
        })}
        {grouped.noParent.length > 0 && grouped.groups.size > 0 && (
          <div className="px-2 py-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">Other</span>
          </div>
        )}
        {grouped.noParent.map((item) => (
          <RefinementSidebarItem
            key={item.id}
            item={item}
            details={detailsCache.get(item.id) ?? null}
            selected={selectedId === item.id}
            onClick={() => onSelect(item.id)}
          />
        ))}
      </div>
    </div>
  );
}

// --- PBI/Bug assignee editor ---

function RefinementAssigneeEditor({
  itemId,
  initialValue,
  suggestions,
  onSaved,
}: {
  itemId: number;
  initialValue: string | null;
  suggestions: string[];
  onSaved: (assignee: string | null) => void;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [saving, setSaving] = useState(false);
  const lastSaved = useRef(initialValue ?? "");

  useEffect(() => {
    setValue(initialValue ?? "");
    lastSaved.current = initialValue ?? "";
  }, [itemId, initialValue]);

  async function save(name: string) {
    if (name === lastSaved.current) return;
    setSaving(true);
    try {
      const res = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId, fields: { assignedTo: name || null } }),
      });
      if (res.ok) {
        lastSaved.current = name;
        onSaved(name || null);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-1 w-56">
      <select
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          save(e.target.value);
        }}
        disabled={saving}
        className="w-full rounded-lg border border-border-default bg-bg-input px-2 py-1 text-sm text-text-primary outline-none focus:border-border-focus disabled:opacity-50"
      >
        <option value="">Unassigned</option>
        {suggestions.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    </div>
  );
}

// --- Detail panel ---

function RefinementDetailPanel({
  item,
  details,
  availableStates,
  availableAssignees,
  onStateChange,
  onMarkReady,
  onDeleteTask,
  onFieldSaved,
  onChildCreated,
  onHoursChanged,
  onAssigneeSaved,
}: {
  item: WorkItemWithChildren;
  details: WorkItemDetails;
  availableStates: string[];
  availableAssignees: string[];
  onStateChange: (id: number, state: string) => Promise<void>;
  onMarkReady: () => Promise<void>;
  onDeleteTask: (id: number) => Promise<void>;
  onFieldSaved: (id: number, field: "description" | "acceptanceCriteria", value: string) => void;
  onChildCreated: (parentId: number, child: WorkItem) => void;
  onHoursChanged: (taskId: number, hours: number | null) => void;
  onAssigneeSaved: (id: number, assignee: string | null) => void;
}) {
  const cl = evaluateChecklist(details, item);
  const status = refinementStatus(cl);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex items-start gap-4">
        <WorkItemTypeIcon type={item.type} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-mono text-text-muted hover:text-accent-blue"
            >
              #{item.id}
            </a>
            <StateSelector
              currentState={item.state}
              availableStates={REFINEMENT_ITEM_STATES}
              onStateChange={(s) => onStateChange(item.id, s)}
            />
            <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-medium", statusColor(status))}>
              {statusLabel(status)}
            </span>
            {item.priority <= 2 && (
              <span className={clsx("rounded px-1 py-0.5 text-[10px] font-bold", item.priority === 1 ? "bg-stale-ancient/15 text-stale-ancient" : "bg-stale-stale/15 text-stale-stale")}>
                P{item.priority}
              </span>
            )}
          </div>
          <h2 className="mt-1 text-xl font-bold text-text-primary">{item.title}</h2>
          <RefinementAssigneeEditor
            itemId={item.id}
            initialValue={item.assignedTo}
            suggestions={availableAssignees}
            onSaved={(assignee) => onAssigneeSaved(item.id, assignee)}
          />
        </div>
        <button
          onClick={onMarkReady}
          className={clsx(
            "shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            status === "ready"
              ? "bg-stale-fresh text-white hover:bg-stale-fresh/90"
              : "bg-accent-gold/15 text-accent-gold hover:bg-accent-gold/25 border border-accent-gold/30"
          )}
        >
          Mark Estimated
        </button>
      </div>

      {/* Two-column: content + checklist/estimation */}
      <div className="flex gap-5">
        {/* Left: Description + Acceptance Criteria */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Description */}
          <div className="rounded-xl border border-border-default bg-bg-card p-5">
            <EditableTextField
              workItemId={item.id}
              workItemType={item.type}
              field="description"
              label={item.type === "Bug" ? "Repro Steps / Description" : "Description"}
              initialValue={details.description ?? ""}
              onSaved={(val) => onFieldSaved(item.id, "description", val)}
            />
          </div>

          {/* Acceptance Criteria */}
          <div className="rounded-xl border border-border-default bg-bg-card p-5">
            <EditableTextField
              workItemId={item.id}
              workItemType={item.type}
              field="acceptanceCriteria"
              label="Acceptance Criteria"
              initialValue={details.acceptanceCriteria ?? ""}
              onSaved={(val) => onFieldSaved(item.id, "acceptanceCriteria", val)}
            />
          </div>

          {/* Child tasks */}
          {item.children.length > 0 && (
            <div className="rounded-xl border border-border-default bg-bg-card overflow-hidden">
              <div className="border-b border-border-default px-5 py-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Tasks ({item.children.length})
                </h3>
              </div>
              <div className="divide-y divide-border-default/30">
                {item.children.map((task) => (
                  <div key={task.id} className="group flex items-center gap-2 px-4 py-2">
                    <WorkItemTypeIcon type={task.type} />
                    <a href={task.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm text-text-secondary hover:text-accent-blue">
                      {task.title}
                    </a>
                    <StateSelector
                      currentState={task.state}
                      availableStates={availableStates}
                      onStateChange={(s) => onStateChange(task.id, s)}
                    />
                    <InlineHoursInput
                      itemId={task.id}
                      initialValue={task.remainingWork}
                      onChanged={(h) => onHoursChanged(task.id, h)}
                    />
                    {task.assignedTo && (
                      <span className="hidden w-20 shrink-0 truncate text-xs text-text-muted lg:block">{task.assignedTo}</span>
                    )}
                    <button
                      onClick={() => onDeleteTask(task.id)}
                      className="shrink-0 rounded p-1 text-text-muted opacity-0 hover:text-stale-ancient group-hover:opacity-100"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Create Task */}
          <div className="rounded-xl border border-dashed border-border-default bg-bg-card/50 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Task
            </h3>
            <RefinementCreateTaskForm
              parentId={item.id}
              pbiTitle={item.title}
              pbiIterationPath={item.iterationPath}
              pbiAssignedTo={item.assignedTo}
              availableAssignees={availableAssignees}
              onCreated={(child) => onChildCreated(item.id, child)}
            />
          </div>
        </div>

        {/* Right: Checklist + Task Summary */}
        <div className="w-72 shrink-0 space-y-4">
          {/* Refinement Checklist */}
          <div className="rounded-xl border border-border-default bg-bg-card p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Refinement Checklist</h3>
            <div className="mt-3 space-y-2.5">
              <ChecklistRow label="Description" ok={cl.descriptionOk} />
              <ChecklistRow label="Acceptance criteria" ok={cl.acceptanceCriteriaOk} />
              <ChecklistRow label="Tasks created" ok={cl.tasksCreated} />
              <ChecklistRow label="Tasks estimated (hours)" ok={cl.tasksEstimated} />
            </div>
            <div className="mt-3 border-t border-border-default pt-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-muted">{cl.passCount}/{cl.total} complete</span>
                <span className={clsx("rounded-full px-2 py-0.5 font-medium", statusColor(status))}>
                  {statusLabel(status)}
                </span>
              </div>
            </div>
          </div>

          {/* Task Estimation Summary */}
          {item.children.length > 0 && (
            <div className="rounded-xl border border-border-default bg-bg-card p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Task Hours</h3>
              <div className="mt-3 space-y-2">
                {item.children.map((task) => (
                  <div key={task.id} className="flex items-center gap-2 text-xs">
                    <WorkItemTypeIcon type={task.type} />
                    <span className={clsx("min-w-0 flex-1 truncate", DONE_STATES.has(task.state) ? "text-text-muted line-through" : "text-text-secondary")}>
                      {task.title}
                    </span>
                    <InlineHoursInput
                      itemId={task.id}
                      initialValue={task.remainingWork}
                      onChanged={(h) => onHoursChanged(task.id, h)}
                    />
                  </div>
                ))}
                <div className="mt-2 border-t border-border-default pt-2 flex items-center justify-between text-xs">
                  <span className="text-text-muted">Total</span>
                  <span className="font-semibold tabular-nums text-accent-gold">
                    {item.children.reduce((s, c) => s + (c.remainingWork ?? 0), 0)}h
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Tags */}
          {item.tags && (
            <div className="rounded-xl border border-border-default bg-bg-card p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Tags</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.tags.split(";").map((tag) => tag.trim()).filter(Boolean).map((tag) => (
                  <span key={tag} className="rounded-full bg-bg-secondary px-2 py-0.5 text-xs text-text-secondary">{tag}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Checklist row ---

function ChecklistRow({ label, ok, optional }: { label: string; ok: boolean; optional?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={clsx(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
        ok ? "bg-stale-fresh/20" : "bg-bg-secondary"
      )}>
        {ok ? (
          <svg className="h-3 w-3 text-stale-fresh" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="h-3 w-3 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </div>
      <span className={clsx("text-sm", ok ? "text-text-primary" : "text-text-muted")}>
        {label}
        {optional && !ok && <span className="ml-1 text-[10px] text-text-muted">(optional)</span>}
      </span>
    </div>
  );
}

// --- Editable text field (description / acceptance criteria) ---

function EditableTextField({
  workItemId,
  workItemType,
  field,
  label,
  initialValue,
  onSaved,
}: {
  workItemId: number;
  workItemType: string;
  field: "description" | "acceptanceCriteria";
  label: string;
  initialValue: string;
  onSaved: (newValue: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when switching items
  useEffect(() => {
    setValue(initialValue);
    setEditing(false);
    setError(null);
  }, [workItemId, initialValue]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: workItemId, fields: { [field]: value }, workItemType }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save");
        return;
      }
      onSaved(value);
      setEditing(false);
    } catch {
      setError("Connection error");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="group/field">
        <div className="mb-1.5 flex items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</h3>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-text-muted opacity-0 transition-opacity hover:text-accent-blue group-hover/field:opacity-100"
          >
            Edit
          </button>
        </div>
        {initialValue ? (
          <RichHtmlContent
            html={initialValue}
            className="prose-devops text-sm text-text-primary leading-relaxed"
          />
        ) : (
          <p className="text-sm text-text-muted italic">No {label.toLowerCase()}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</h3>
      <textarea
        value={sanitizeHtml(value)}
        onChange={(e) => setValue(e.target.value)}
        rows={8}
        disabled={saving}
        className="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-border-focus disabled:opacity-50 resize-y"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-accent-blue px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-80 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={() => { setValue(initialValue); setEditing(false); setError(null); }}
          disabled={saving}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:text-text-primary disabled:opacity-50"
        >
          Cancel
        </button>
        {error && <span className="text-xs text-stale-ancient">{error}</span>}
      </div>
    </div>
  );
}

// --- Inline hours input ---

function InlineHoursInput({
  itemId,
  initialValue,
  onChanged,
}: {
  itemId: number;
  initialValue: number | null;
  onChanged?: (hours: number | null) => void;
}) {
  const [value, setValue] = useState(initialValue != null ? String(initialValue) : "");
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(initialValue);

  // Reset when switching items
  useEffect(() => {
    setValue(initialValue != null ? String(initialValue) : "");
    savedRef.current = initialValue;
  }, [itemId, initialValue]);

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
      if (res.ok) {
        savedRef.current = num;
        onChanged?.(num);
      }
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
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      min="0"
      step="0.5"
      placeholder="—"
      disabled={saving}
      className="w-14 shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-center text-xs font-mono text-text-muted outline-none transition-colors hover:border-border-default focus:border-border-focus focus:bg-bg-input disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      title="Remaining hours"
    />
  );
}

// --- Assignee autocomplete ---

function AssigneeInput({
  value,
  onChange,
  suggestions,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = value.trim()
    ? suggestions.filter((s) => s.toLowerCase().includes(value.toLowerCase()))
    : suggestions;

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Assignee"
        disabled={disabled}
        className="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 outline-none focus:border-border-focus disabled:opacity-50"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border-default bg-bg-card shadow-lg">
          {filtered.map((name) => (
            <button
              key={name}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(name); setOpen(false); }}
              className={clsx(
                "w-full px-3 py-2 text-left text-sm transition-colors hover:bg-bg-card-hover",
                name === value ? "text-accent-blue font-medium" : "text-text-primary"
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Create task form ---

function RefinementCreateTaskForm({
  parentId,
  pbiTitle,
  pbiIterationPath,
  pbiAssignedTo,
  availableAssignees,
  onCreated,
}: {
  parentId: number;
  pbiTitle: string;
  pbiIterationPath: string;
  pbiAssignedTo: string | null;
  availableAssignees: string[];
  onCreated: (task: WorkItem) => void;
}) {
  const [hours, setHours] = useState("");
  const [assignee, setAssignee] = useState(pbiAssignedTo ?? "");
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const prevParentRef = useRef(parentId);
  useEffect(() => {
    if (parentId !== prevParentRef.current) {
      prevParentRef.current = parentId;
      if (pbiAssignedTo && pbiAssignedTo !== assignee) {
        setAssignee(pbiAssignedTo);
      }
    }
  }, [parentId, pbiAssignedTo, assignee]);

  async function handleCreate(preset: typeof TASK_PRESETS[number]) {
    const title = preset.key === "other" ? pbiTitle : `${preset.label}: ${pbiTitle}`;

    if (!hours || Number(hours) <= 0) {
      setError("Hours required");
      return;
    }

    setCreating(preset.key);
    setError(null);
    setCreated(null);

    try {
      const res = await fetch("/api/work-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentId,
          title,
          iterationPath: pbiIterationPath || "Relaunch - Charlie Tango",
          remainingWork: Number(hours),
          activity: preset.activity,
          tags: preset.tag || undefined,
          assignedTo: assignee.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create task");
        return;
      }

      onCreated(data);
      setCreated(`${preset.label} task created`);
      setTimeout(() => setCreated(null), 2500);
    } catch {
      setError("Connection error");
    } finally {
      setCreating(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative w-20 shrink-0">
          <input
            type="number"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="0"
            min="0.5"
            step="0.5"
            required
            disabled={creating !== null}
            className="w-full rounded-lg border border-border-default bg-bg-input py-2 pl-3 pr-6 text-sm text-text-primary placeholder:text-text-muted/30 outline-none focus:border-border-focus disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-text-muted/50">h</span>
        </div>
        <div className="min-w-0 flex-1">
          <AssigneeInput
            value={assignee}
            onChange={setAssignee}
            suggestions={availableAssignees}
            disabled={creating !== null}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TASK_PRESETS.map((preset) => (
          <button
            key={preset.key}
            onClick={() => handleCreate(preset)}
            disabled={creating !== null}
            className={clsx(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 hover:opacity-80",
              preset.color
            )}
          >
            {creating === preset.key ? (
              <span className="inline-flex items-center gap-1">
                <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              </span>
            ) : `+ ${preset.label}`}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-stale-ancient">{error}</p>}
      {created && (
        <p className="flex items-center gap-1.5 text-xs text-stale-fresh">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {created}
        </p>
      )}
    </div>
  );
}

// --- Meeting Mode ---

function MeetingModeView({
  item,
  details,
  detailsLoading,
  currentIndex,
  totalItems,
  availableStates,
  availableAssignees,
  onNext,
  onPrev,
  onExit,
  onStateChange,
  onMarkReady,
  onDeleteTask,
  onFieldSaved,
  onChildCreated,
  onHoursChanged,
  onAssigneeSaved,
}: {
  item: WorkItemWithChildren;
  details: WorkItemDetails | null;
  detailsLoading: boolean;
  currentIndex: number;
  totalItems: number;
  availableStates: string[];
  availableAssignees: string[];
  onNext: () => void;
  onPrev: () => void;
  onExit: () => void;
  onStateChange: (id: number, state: string) => Promise<void>;
  onMarkReady: () => Promise<void>;
  onDeleteTask: (id: number) => Promise<void>;
  onFieldSaved: (id: number, field: "description" | "acceptanceCriteria", value: string) => void;
  onChildCreated: (parentId: number, child: WorkItem) => void;
  onHoursChanged: (taskId: number, hours: number | null) => void;
  onAssigneeSaved: (id: number, assignee: string | null) => void;
}) {
  const cl = details ? evaluateChecklist(details, item) : null;
  const status = cl ? refinementStatus(cl) : "not-refined";

  return (
    <div className="min-h-[calc(100vh-140px)] space-y-6">
      {/* Top bar */}
      <div className="flex items-center gap-4 rounded-xl bg-bg-secondary px-5 py-3">
        <button
          onClick={onPrev}
          disabled={currentIndex === 0}
          className="rounded-lg p-2 text-text-muted hover:text-text-primary disabled:opacity-30"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-medium text-text-primary tabular-nums">
          {currentIndex + 1} of {totalItems}
        </span>
        <button
          onClick={onNext}
          disabled={currentIndex >= totalItems - 1}
          className="rounded-lg p-2 text-text-muted hover:text-text-primary disabled:opacity-30"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <div className="flex-1" />

        <span className="text-xs text-text-muted">
          <kbd className="rounded bg-bg-card px-1.5 py-0.5 font-mono text-[10px]">j</kbd>/<kbd className="rounded bg-bg-card px-1.5 py-0.5 font-mono text-[10px]">k</kbd> navigate
          <span className="mx-2">·</span>
          <kbd className="rounded bg-bg-card px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd> exit
        </span>

        <button
          onClick={onExit}
          className="rounded-lg bg-bg-card px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg-card-hover"
        >
          Exit Meeting
        </button>
      </div>

      {detailsLoading && (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
        </div>
      )}

      {!detailsLoading && details && cl && (
        <>
          {/* Title area */}
          <div className="flex items-start gap-4">
            <WorkItemTypeIcon type={item.type} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm">
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="font-mono text-text-muted hover:text-accent-blue">
                  #{item.id}
                </a>
                <StateSelector currentState={item.state} availableStates={REFINEMENT_ITEM_STATES} onStateChange={(s) => onStateChange(item.id, s)} />
                <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-medium", statusColor(status))}>
                  {statusLabel(status)}
                </span>
                {item.priority <= 2 && (
                  <span className={clsx("rounded px-1 py-0.5 text-[10px] font-bold", item.priority === 1 ? "bg-stale-ancient/15 text-stale-ancient" : "bg-stale-stale/15 text-stale-stale")}>
                    P{item.priority}
                  </span>
                )}
              </div>
              <h1 className="mt-2 text-2xl font-bold text-text-primary leading-tight">{item.title}</h1>
              <RefinementAssigneeEditor
                itemId={item.id}
                initialValue={item.assignedTo}
                suggestions={availableAssignees}
                onSaved={(assignee) => onAssigneeSaved(item.id, assignee)}
              />
            </div>
          </div>

          {/* Content: two columns */}
          <div className="flex gap-6">
            {/* Left: Description + AC + Tasks + Create */}
            <div className="min-w-0 flex-1 space-y-5">
              <div className="rounded-xl border border-border-default bg-bg-card p-6">
                <EditableTextField
                  workItemId={item.id}
                  workItemType={item.type}
                  field="description"
                  label={item.type === "Bug" ? "Repro Steps / Description" : "Description"}
                  initialValue={details.description ?? ""}
                  onSaved={(val) => onFieldSaved(item.id, "description", val)}
                />
              </div>

              <div className="rounded-xl border border-border-default bg-bg-card p-6">
                <EditableTextField
                  workItemId={item.id}
                  workItemType={item.type}
                  field="acceptanceCriteria"
                  label="Acceptance Criteria"
                  initialValue={details.acceptanceCriteria ?? ""}
                  onSaved={(val) => onFieldSaved(item.id, "acceptanceCriteria", val)}
                />
              </div>

              {/* Child tasks */}
              {item.children.length > 0 && (
                <div className="rounded-xl border border-border-default bg-bg-card overflow-hidden">
                  <div className="border-b border-border-default px-5 py-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Tasks ({item.children.length})</h3>
                  </div>
                  <div className="divide-y divide-border-default/30">
                    {item.children.map((task) => (
                      <div key={task.id} className="group flex items-center gap-2 px-4 py-2">
                        <WorkItemTypeIcon type={task.type} />
                        <span className={clsx("min-w-0 flex-1 truncate text-sm", DONE_STATES.has(task.state) ? "text-text-muted line-through" : "text-text-secondary")}>
                          {task.title}
                        </span>
                        <StateSelector
                          currentState={task.state}
                          availableStates={availableStates}
                          onStateChange={(s) => onStateChange(task.id, s)}
                        />
                        <InlineHoursInput
                          itemId={task.id}
                          initialValue={task.remainingWork}
                          onChanged={(h) => onHoursChanged(task.id, h)}
                        />
                        {task.assignedTo && (
                          <span className="hidden w-20 shrink-0 truncate text-xs text-text-muted lg:block">{task.assignedTo}</span>
                        )}
                        <button
                          onClick={() => onDeleteTask(task.id)}
                          className="shrink-0 rounded p-1 text-text-muted opacity-0 hover:text-stale-ancient group-hover:opacity-100"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Create Task */}
              <div className="rounded-xl border border-dashed border-border-default bg-bg-card/50 p-4">
                <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add Task
                </h3>
                <RefinementCreateTaskForm
                  parentId={item.id}
                  pbiTitle={item.title}
                  pbiIterationPath={item.iterationPath}
                  pbiAssignedTo={item.assignedTo}
                  availableAssignees={availableAssignees}
                  onCreated={(child) => onChildCreated(item.id, child)}
                />
              </div>
            </div>

            {/* Right: Checklist + Estimation */}
            <div className="w-80 shrink-0 space-y-5">
              {/* Checklist */}
              <div className="rounded-xl border border-border-default bg-bg-card p-6">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Refinement Checklist</h3>
                <div className="mt-4 space-y-3">
                  <ChecklistRow label="Description" ok={cl.descriptionOk} />
                  <ChecklistRow label="Acceptance criteria" ok={cl.acceptanceCriteriaOk} />
                  <ChecklistRow label="Tasks created" ok={cl.tasksCreated} />
                  <ChecklistRow label="Tasks estimated (hours)" ok={cl.tasksEstimated} />
                </div>
                <div className="mt-4 border-t border-border-default pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-muted">{cl.passCount}/{cl.total} complete</span>
                    <span className={clsx("rounded-full px-2 py-0.5 font-medium", statusColor(status))}>
                      {statusLabel(status)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Task Hours */}
              {item.children.length > 0 && (
                <div className="rounded-xl border border-border-default bg-bg-card p-6">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Task Hours</h3>
                  <div className="mt-4 space-y-2.5">
                    {item.children.map((task) => (
                      <div key={task.id} className="flex items-center gap-2 text-sm">
                        <WorkItemTypeIcon type={task.type} />
                        <span className={clsx("min-w-0 flex-1 truncate", DONE_STATES.has(task.state) ? "text-text-muted line-through" : "text-text-secondary")}>
                          {task.title}
                        </span>
                        <InlineHoursInput
                          itemId={task.id}
                          initialValue={task.remainingWork}
                          onChanged={(h) => onHoursChanged(task.id, h)}
                        />
                      </div>
                    ))}
                    <div className="mt-2 border-t border-border-default pt-2 flex items-center justify-between text-sm">
                      <span className="text-text-muted">Total</span>
                      <span className="font-bold tabular-nums text-accent-gold">
                        {item.children.reduce((s, c) => s + (c.remainingWork ?? 0), 0)}h
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Mark Estimated (meeting mode only walks grooming items) */}
              <button
                onClick={onMarkReady}
                className={clsx(
                  "w-full rounded-xl py-3 text-sm font-semibold transition-colors",
                  status === "ready"
                    ? "bg-stale-fresh text-white hover:bg-stale-fresh/90"
                    : "bg-accent-gold/15 text-accent-gold hover:bg-accent-gold/25 border border-accent-gold/30"
                )}
              >
                Mark Estimated &amp; Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
