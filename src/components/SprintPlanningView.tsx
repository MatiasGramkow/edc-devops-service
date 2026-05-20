"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import clsx from "clsx";
import type { WorkItem, WorkItemWithChildren, WorkItemDetails, Iteration, SprintCapacityData } from "@/types/devops";
import { WorkItemTypeIcon } from "./WorkItemTypeIcon";
import { StateSelector } from "./StateSelector";
import { RichHtmlContent } from "./RichHtmlContent";
import { computeAssigneeSuggestions } from "@/lib/capacity-utils";

interface SprintPlanningViewProps {
  availableStates: string[];
  availableAssignees: string[];
  iterations: Iteration[];
}

const TASK_PRESETS = [
  { key: "dev", label: "Development", activity: "Development", tag: "Development", color: "bg-accent-blue text-white" },
  { key: "qa", label: "QA", activity: "QA", tag: "QA", color: "bg-accent-gold text-white" },
  { key: "release", label: "Release", activity: "Release", tag: "Release", color: "bg-stale-fresh text-white" },
  { key: "other", label: "Other", activity: "Development", tag: "", color: "bg-text-muted/20 text-text-primary border border-border-default" },
] as const;

const DONE_STATES = new Set(["Done", "Closed", "Removed"]);

function getCurrentSprintPath(iterations: Iteration[]): string {
  const now = new Date();
  const current = iterations.find((i) => {
    if (!i.startDate || !i.finishDate) return false;
    return new Date(i.startDate) <= now && new Date(i.finishDate) >= now;
  });
  return current?.path ?? "";
}

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

function getRelevantSprints(iterations: Iteration[]) {
  const now = new Date();
  return iterations
    .filter((i) => !i.finishDate || new Date(i.finishDate) >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
    .sort((a, b) => {
      if (!a.startDate) return -1;
      if (!b.startDate) return 1;
      return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    });
}

function getNextSprintPath(iterations: Iteration[]): string {
  const now = new Date();
  const sorted = iterations
    .filter((i) => i.startDate && i.finishDate)
    .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());

  const currentIdx = sorted.findIndex((i) =>
    new Date(i.startDate!) <= now && new Date(i.finishDate!) >= now
  );

  // Return sprint after current; fall back to first future sprint, then current
  if (currentIdx >= 0 && currentIdx < sorted.length - 1) {
    return sorted[currentIdx + 1].path;
  }
  const firstFuture = sorted.find((i) => new Date(i.startDate!) > now);
  if (firstFuture) return firstFuture.path;
  if (currentIdx >= 0) return sorted[currentIdx].path;
  return sorted[sorted.length - 1]?.path ?? "";
}

// --- Sidebar item with drag support ---

function SidebarItem({
  item,
  selected,
  onClick,
  dragEnabled,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
}: {
  item: WorkItemWithChildren;
  selected: boolean;
  onClick: () => void;
  dragEnabled?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  isDragOver?: boolean;
}) {
  const totalHours = item.children.reduce((sum, c) => sum + (c.remainingWork ?? 0), 0);
  const taskCount = item.children.length;

  return (
    <button
      onClick={onClick}
      draggable={dragEnabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={clsx(
        "w-full rounded-lg border-l-[3px] px-3 py-2.5 text-left transition-all",
        item.priority === 1 ? "border-l-stale-ancient" : item.priority === 2 ? "border-l-stale-stale" : "border-l-border-default",
        selected
          ? "bg-accent-blue/12 ring-1 ring-accent-blue/30"
          : "hover:bg-bg-card-hover",
        isDragOver && "ring-2 ring-accent-gold/50 bg-accent-gold/5",
        dragEnabled && "cursor-grab active:cursor-grabbing"
      )}
    >
      <div className="flex items-center gap-2">
        {dragEnabled && (
          <svg className="h-3.5 w-3.5 shrink-0 text-text-muted/40" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
          </svg>
        )}
        <WorkItemTypeIcon type={item.type} />
        <span className="text-[11px] font-mono text-text-muted">#{item.id}</span>
        {item.priority <= 2 && (
          <span className={clsx("ml-auto rounded px-1 py-0.5 text-[10px] font-bold", item.priority === 1 ? "bg-stale-ancient/15 text-stale-ancient" : "bg-stale-stale/15 text-stale-stale")}>
            P{item.priority}
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
        <span className="tabular-nums">
          {taskCount}t{totalHours > 0 && <> · <span className="text-accent-gold">{totalHours}h</span></>}
        </span>
      </div>
    </button>
  );
}

// --- Inline hours input ---

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

// --- Existing task row ---

function TaskRow({
  task,
  availableStates,
  availableAssignees,
  onStateChange,
  onDelete,
  onAssigneeChange,
}: {
  task: WorkItem;
  availableStates: string[];
  availableAssignees: string[];
  onStateChange: (id: number, newState: string) => Promise<void>;
  onDelete: (id: number) => void;
  onAssigneeChange: (id: number, assignee: string | null) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function handleAssigneeChange(value: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, fields: { assignedTo: value || null } }),
      });
      if (res.ok) onAssigneeChange(task.id, value || null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="group flex items-center gap-2 border-t border-border-default/30 px-3 py-2 first:border-t-0">
      <WorkItemTypeIcon type={task.type} />
      <a href={task.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm text-text-secondary hover:text-accent-blue">
        {task.title}
      </a>
      <StateSelector currentState={task.state} availableStates={availableStates} onStateChange={(s) => onStateChange(task.id, s)} />
      <InlineHoursInput itemId={task.id} initialValue={task.remainingWork} />
      <select
        value={task.assignedTo ?? ""}
        onChange={(e) => handleAssigneeChange(e.target.value)}
        disabled={saving}
        className="hidden w-28 shrink-0 truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-text-muted outline-none transition-colors hover:border-border-default focus:border-border-focus focus:bg-bg-input disabled:opacity-50 lg:block"
        title="Task assignee"
      >
        <option value="">Unassigned</option>
        {availableAssignees.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
      <button
        onClick={() => onDelete(task.id)}
        className="shrink-0 rounded p-1 text-text-muted opacity-0 transition-all hover:bg-stale-ancient/15 hover:text-stale-ancient group-hover:opacity-100"
        title="Delete task"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
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

// --- PBI assignee editor ---

function PbiAssigneeEditor({
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
    <div className="w-64">
      <select
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          save(e.target.value);
        }}
        disabled={saving}
        className="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-border-focus disabled:opacity-50"
      >
        <option value="">Unassigned</option>
        {suggestions.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    </div>
  );
}

// --- Quick create task form ---

function QuickCreateForm({
  parentId,
  pbiTitle,
  pbiAssignedTo,
  availableAssignees,
  iterations,
  onCreated,
  capacityData,
}: {
  parentId: number;
  pbiTitle: string;
  pbiAssignedTo: string | null;
  availableAssignees: string[];
  iterations: Iteration[];
  onCreated: (task: WorkItem) => void;
  capacityData?: SprintCapacityData | null;
}) {
  const [hours, setHours] = useState("");
  const [assignee, setAssignee] = useState(pbiAssignedTo ?? "");
  const [iterationPath, setIterationPath] = useState(() => getCurrentSprintPath(iterations));
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  // Set default sprint once iterations load
  useEffect(() => {
    if (iterations.length > 0 && !iterationPath) {
      setIterationPath(getCurrentSprintPath(iterations));
    }
  }, [iterations, iterationPath]);

  // Remember assignee and sprint across parent changes, but reset when pbi changes
  const prevParentRef = useRef(parentId);
  useEffect(() => {
    if (parentId !== prevParentRef.current) {
      prevParentRef.current = parentId;
      // Keep hours, sprint, and assignee from previous item for speed
      // Only reset assignee if PBI has a different one
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
          iterationPath: iterationPath || "Relaunch - Charlie Tango",
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

  const relevantSprints = getRelevantSprints(iterations);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select
          value={iterationPath}
          onChange={(e) => setIterationPath(e.target.value)}
          disabled={creating !== null}
          className="flex-1 rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-border-focus disabled:opacity-50"
        >
          {relevantSprints.map((s) => {
            const isCurrent = s.path === getCurrentSprintPath(iterations);
            const isNext = s.path === getNextSprintPath(iterations);
            const prefix = isCurrent ? ">> " : isNext ? "* " : "";
            return (
              <option key={s.id} value={s.path}>
                {prefix}{s.name}{isCurrent ? " (current)" : isNext ? " (next)" : ""}
              </option>
            );
          })}
        </select>
        <input
          type="number"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="Timer *"
          min="0.5"
          step="0.5"
          required
          disabled={creating !== null}
          className="w-20 rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 outline-none focus:border-border-focus disabled:opacity-50"
        />
      </div>
      <div>
        <AssigneeInput
          value={assignee}
          onChange={setAssignee}
          suggestions={availableAssignees}
          disabled={creating !== null}
        />
        {capacityData && !assignee.trim() && (() => {
          const suggestions = computeAssigneeSuggestions(capacityData, "Development", availableAssignees);
          const top = suggestions.find((s) => s.isSuggested);
          if (!top) return null;
          return (
            <button
              type="button"
              onClick={() => setAssignee(top.displayName)}
              className="mt-1 text-[10px] text-accent-blue hover:underline"
            >
              ★ Suggest: {top.displayName} ({top.availableHours}h available)
            </button>
          );
        })()}
      </div>
      <div className="flex flex-wrap gap-2">
        {TASK_PRESETS.map((preset) => (
          <button
            key={preset.key}
            onClick={() => handleCreate(preset)}
            disabled={creating !== null}
            className={clsx(
              "rounded-full px-4 py-1.5 text-xs font-semibold transition-all disabled:opacity-50 hover:opacity-80 hover:scale-[1.02] active:scale-[0.98]",
              preset.color
            )}
          >
            {creating === preset.key ? "..." : `+ ${preset.label}`}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-stale-ancient">{error}</p>}
      {created && <p className="text-xs text-stale-fresh">{created}</p>}
    </div>
  );
}

// --- Capacity panel ---

function CapacityBar({ assigned, capacity }: { assigned: number; capacity: number }) {
  if (capacity <= 0) return null;
  const pct = Math.min((assigned / capacity) * 100, 100);
  const over = assigned > capacity;

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 rounded-full bg-bg-secondary">
        <div
          className={clsx("h-full rounded-full transition-all", over ? "bg-stale-ancient" : pct > 80 ? "bg-accent-gold" : "bg-accent-blue")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={clsx("w-16 text-right text-xs font-mono tabular-nums", over ? "text-stale-ancient font-bold" : "text-text-muted")}>
        {assigned}/{capacity}h
      </span>
    </div>
  );
}

const ACTIVITY_COLORS: Record<string, string> = {
  Development: "bg-accent-blue/15 text-accent-blue",
  QA: "bg-accent-gold/15 text-accent-gold",
  Release: "bg-stale-fresh/15 text-stale-fresh",
};

// --- Sprint Goal Editor ---

function SprintGoalEditor({ iterationId }: { iterationId: string | null }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const savedRef = useRef("");

  useEffect(() => {
    if (!iterationId) { setText(""); setLoaded(false); return; }
    setLoaded(false);
    fetch(`/api/work-items?action=sprint-goals&iterationId=${iterationId}`)
      .then((r) => r.json())
      .then((data) => {
        const goal = data?.text ?? "";
        setText(goal);
        savedRef.current = goal;
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [iterationId]);

  async function save() {
    if (!iterationId || text === savedRef.current) return;
    setSaving(true);
    try {
      await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sprintGoal: { iterationId, text } }),
      });
      savedRef.current = text;
    } finally {
      setSaving(false);
    }
  }

  if (!iterationId || !loaded) return null;

  return (
    <div className="rounded-xl border border-border-default bg-bg-card">
      <div className="px-4 py-2.5">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Sprint Goal</h4>
      </div>
      <div className="border-t border-border-default/50 px-4 py-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={save}
          placeholder="What should this sprint achieve?"
          rows={3}
          disabled={saving}
          className="w-full resize-none rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 outline-none focus:border-border-focus disabled:opacity-50"
        />
        {text !== savedRef.current && (
          <p className="mt-1 text-[10px] text-accent-gold">Unsaved changes (saves on blur)</p>
        )}
      </div>
    </div>
  );
}

// --- What-if capacity preview ---

function WhatIfPreview({ item, capacityData }: { item: WorkItemWithChildren | null; capacityData: SprintCapacityData | null }) {
  if (!item || !capacityData || item.children.length === 0) return null;

  // Calculate additional hours this item would add per member
  const additionalHours = new Map<string, number>();
  for (const child of item.children) {
    if (child.assignedTo && child.remainingWork) {
      additionalHours.set(child.assignedTo, (additionalHours.get(child.assignedTo) ?? 0) + child.remainingWork);
    }
  }

  if (additionalHours.size === 0) return null;

  const affectedMembers = capacityData.members.filter((m) => additionalHours.has(m.displayName));
  if (affectedMembers.length === 0) return null;

  return (
    <div className="rounded-xl border border-accent-gold/30 bg-accent-gold/5">
      <div className="px-4 py-2.5">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-accent-gold">What-if Preview</h4>
        <p className="text-[10px] text-text-muted mt-0.5">Impact if this item is planned</p>
      </div>
      <div className="border-t border-accent-gold/20 px-4 py-2">
        {affectedMembers.map((member) => {
          const extra = additionalHours.get(member.displayName) ?? 0;
          const newAssigned = member.totalAssigned + extra;
          const over = newAssigned > member.totalCapacity;
          return (
            <div key={member.displayName} className="flex items-center justify-between py-1.5">
              <span className="text-xs text-text-secondary">{member.displayName}</span>
              <span className={clsx("text-xs font-mono tabular-nums", over ? "text-stale-ancient font-bold" : "text-accent-gold")}>
                {Math.round(member.totalAssigned)}h → {Math.round(newAssigned * 10) / 10}h
                {member.totalCapacity > 0 && <span className="text-text-muted/50"> / {Math.round(member.totalCapacity)}h</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CapacityPanel({
  iterationId,
  sprintName,
  refreshKey,
  onDataLoaded,
}: {
  iterationId: string | null;
  sprintName: string;
  refreshKey: number;
  onDataLoaded?: (data: SprintCapacityData | null) => void;
}) {
  const [data, setData] = useState<SprintCapacityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!iterationId) {
      setData(null);
      onDataLoaded?.(null);
      return;
    }
    setLoading(true);
    fetch(`/api/work-items?action=sprint-capacity&iterationId=${iterationId}`)
      .then((r) => r.json())
      .then((d) => { if (d.members) { setData(d); onDataLoaded?.(d); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [iterationId, refreshKey]);

  if (!iterationId) return null;

  const totalCapacity = data?.members.reduce((s, m) => s + m.totalCapacity, 0) ?? 0;
  const totalAssigned = data?.members.reduce((s, m) => s + m.totalAssigned, 0) ?? 0;

  return (
    <div className="rounded-xl border border-border-default bg-bg-card">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-bg-card-hover"
      >
        <svg className={clsx("h-3.5 w-3.5 text-text-muted transition-transform", !collapsed && "rotate-90")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-sm font-medium text-text-primary">Capacity — {sprintName}</span>
        {data && (
          <span className={clsx("text-xs font-mono", totalAssigned > totalCapacity ? "text-stale-ancient" : "text-text-muted")}>
            {Math.round(totalAssigned)}h / {Math.round(totalCapacity)}h
            {data.sprintWorkDays > 0 && <span className="ml-2 text-text-muted/60">({data.sprintWorkDays} work days)</span>}
          </span>
        )}
        {loading && <div className="ml-auto h-4 w-4 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />}
      </button>

      {!collapsed && data && (
        <div className="border-t border-border-default/50 px-4 py-3">
          <div className="space-y-1">
            {data.members.map((member) => {
              const left = Math.round(Math.max(0, member.totalCapacity - member.totalAssigned) * 10) / 10;
              const over = member.totalAssigned > member.totalCapacity;
              return (
                <div key={member.displayName} className="rounded-lg bg-bg-primary px-3 py-2.5">
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-sm font-semibold text-text-primary">{member.displayName}</span>
                    <span className={clsx("text-xs font-mono tabular-nums", over ? "text-stale-ancient font-bold" : "text-text-muted")}>
                      {Math.round(member.totalAssigned * 10) / 10}/{Math.round(member.totalCapacity * 10) / 10}h
                      {member.totalCapacity > 0 && (
                        <span className={clsx("ml-1", over ? "text-stale-ancient/70" : "text-text-muted/50")}>
                          ({left}h left)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {member.activities.map((act) => (
                      <div key={act.name} className="flex items-center gap-2">
                        <span className={clsx("w-20 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold", ACTIVITY_COLORS[act.name] ?? "bg-text-muted/10 text-text-muted")}>
                          {act.name}
                        </span>
                        <div className="flex-1">
                          <CapacityBar assigned={act.assignedHours} capacity={act.capacityHours} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Team total bar */}
          {data.members.length > 1 && (
            <div className="mt-2 rounded-lg border border-border-default/40 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-center text-[10px] font-bold uppercase tracking-wider text-text-muted">Total</span>
                <div className="flex-1">
                  <CapacityBar assigned={totalAssigned} capacity={totalCapacity} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Main component ---

export function SprintPlanningView({ availableStates, availableAssignees, iterations }: SprintPlanningViewProps) {
  const [items, setItems] = useState<WorkItemWithChildren[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [details, setDetails] = useState<WorkItemDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionMsgType, setActionMsgType] = useState<"success" | "error">("success");
  const actionTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [donePlanningLoading, setDonePlanningLoading] = useState(false);
  const [doneSprint, setDoneSprint] = useState(() => getNextSprintPath(iterations));
  const [capacityRefreshKey, setCapacityRefreshKey] = useState(0);

  // New features
  const [dragEnabled, setDragEnabled] = useState(false);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const dragSrcId = useRef<number | null>(null);
  const [capacityData, setCapacityData] = useState<SprintCapacityData | null>(null);
  const [copyFromId, setCopyFromId] = useState("");
  const [copyLoading, setCopyLoading] = useState(false);

  // Meeting mode
  const [meetingMode, setMeetingMode] = useState(false);
  const [meetingPickerOpen, setMeetingPickerOpen] = useState(false);
  const [meetingSelectedAreas, setMeetingSelectedAreas] = useState<Set<string>>(new Set());

  // Carry-over state
  const [carryOverItems, setCarryOverItems] = useState<WorkItemWithChildren[]>([]);
  const [carryOverLoading, setCarryOverLoading] = useState(false);
  const [carryOverOpen, setCarryOverOpen] = useState(true);
  const [carryOverSelected, setCarryOverSelected] = useState<Set<number>>(new Set());
  const [carryOverMoving, setCarryOverMoving] = useState(false);

  // Set default to next sprint once iterations load
  useEffect(() => {
    if (iterations.length > 0 && !doneSprint) {
      setDoneSprint(getNextSprintPath(iterations));
    }
  }, [iterations, doneSprint]);

  const targetIteration = iterations.find((i) => i.path === doneSprint);
  const targetSprintName = doneSprint.replace("Relaunch - Charlie Tango\\", "") || "—";

  // Re-fetch capacity data when refreshKey changes (e.g. after "Done planning")
  useEffect(() => {
    const itId = targetIteration?.id;
    if (!itId) return;
    fetch(`/api/work-items?action=sprint-capacity&iterationId=${itId}`)
      .then((r) => r.json())
      .then((d) => { if (d.members) setCapacityData(d); })
      .catch(() => {});
  }, [capacityRefreshKey, targetIteration?.id]);

  function showMsg(msg: string, type: "success" | "error" = "success") {
    setActionMsg(msg);
    setActionMsgType(type);
    clearTimeout(actionTimeout.current);
    actionTimeout.current = setTimeout(() => setActionMsg(null), type === "error" ? 5000 : 3000);
  }

  // Fetch sprint planning items
  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/work-items?action=sprint-planning");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load sprint planning items");
        return;
      }
      setItems(data.items);
      if (data.items.length > 0) {
        setSelectedId((prev) => {
          // Keep current selection if still in list
          if (prev && data.items.some((i: WorkItemWithChildren) => i.id === prev)) return prev;
          return data.items[0].id;
        });
      }
    } catch {
      setError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Fetch unfinished items from current sprint (carry-over candidates)
  const currentSprintPath = useMemo(() => getCurrentSprintPath(iterations), [iterations]);
  const currentSprintName = currentSprintPath.replace("Relaunch - Charlie Tango\\", "") || "Current Sprint";

  const fetchCarryOver = useCallback(async () => {
    if (!currentSprintPath) return;
    setCarryOverLoading(true);
    try {
      const res = await fetch(`/api/work-items?action=unfinished-sprint&iterationPath=${encodeURIComponent(currentSprintPath)}`);
      const data = await res.json();
      if (res.ok && data.items) {
        setCarryOverItems(data.items);
      }
    } catch {
      // Silent fail — carry-over is supplemental
    } finally {
      setCarryOverLoading(false);
    }
  }, [currentSprintPath]);

  useEffect(() => { fetchCarryOver(); }, [fetchCarryOver]);

  // Carry-over: move selected items to target sprint
  const handleCarryOver = useCallback(async () => {
    if (carryOverSelected.size === 0 || !doneSprint) return;
    setCarryOverMoving(true);
    let movedCount = 0;
    let movedChildCount = 0;

    try {
      for (const itemId of carryOverSelected) {
        const item = carryOverItems.find((i) => i.id === itemId);
        if (!item) continue;

        // Move PBI/Bug to target sprint
        const res = await fetch("/api/work-items", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: itemId, fields: { iterationPath: doneSprint } }),
        });
        if (!res.ok) continue;
        movedCount++;

        // Move active children too
        const activeChildIds = item.children
          .filter((c) => !DONE_STATES.has(c.state))
          .map((c) => c.id);

        if (activeChildIds.length > 0) {
          const bulkRes = await fetch("/api/work-items", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: activeChildIds, iterationPath: doneSprint }),
          });
          if (bulkRes.ok) {
            const bulkData = await bulkRes.json();
            movedChildCount += bulkData.succeeded?.length ?? 0;
          }
        }
      }

      // Remove moved items from carry-over list
      setCarryOverItems((prev) => prev.filter((i) => !carryOverSelected.has(i.id)));
      setCarryOverSelected(new Set());
      setCapacityRefreshKey((k) => k + 1);

      const sprintLabel = doneSprint.replace("Relaunch - Charlie Tango\\", "");
      showMsg(`Carried over ${movedCount} item${movedCount !== 1 ? "s" : ""} → ${sprintLabel}${movedChildCount > 0 ? ` (+ ${movedChildCount} tasks)` : ""}`);
    } catch {
      showMsg("Failed to carry over items", "error");
    } finally {
      setCarryOverMoving(false);
    }
  }, [carryOverSelected, carryOverItems, doneSprint]);

  function toggleCarryOverSelect(id: number) {
    setCarryOverSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCarryOverSelectAll() {
    if (carryOverSelected.size === carryOverItems.length) {
      setCarryOverSelected(new Set());
    } else {
      setCarryOverSelected(new Set(carryOverItems.map((i) => i.id)));
    }
  }

  // Fetch details when selected item changes
  useEffect(() => {
    if (!selectedId) {
      setDetails(null);
      return;
    }
    setDetailsLoading(true);
    fetch(`/api/work-items?action=details&id=${selectedId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setDetails(data);
      })
      .catch(() => {})
      .finally(() => setDetailsLoading(false));
  }, [selectedId]);

  const allPlanningItems = useMemo(() => [...items, ...carryOverItems], [items, carryOverItems]);
  const selectedItem = allPlanningItems.find((i) => i.id === selectedId);
  const selectedIndex = items.findIndex((i) => i.id === selectedId);

  // Group items by parent
  const groupedItems = useMemo(() => {
    const groupMap = new Map<number | null, WorkItemWithChildren[]>();
    for (const item of items) {
      const key = item.parentId ?? null;
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(item);
    }
    const groups: { parentId: number | null; parentTitle: string; items: WorkItemWithChildren[] }[] = [];
    for (const [parentId, groupItems] of groupMap) {
      groups.push({
        parentId,
        parentTitle: groupItems[0]?.parentTitle ?? "Ungrouped",
        items: groupItems,
      });
    }
    // Named parents first (alphabetically), ungrouped last
    groups.sort((a, b) => {
      if (a.parentId === null) return 1;
      if (b.parentId === null) return -1;
      return a.parentTitle.localeCompare(b.parentTitle);
    });
    return groups;
  }, [items]);

  // Meeting mode: filtered items by selected areas
  const CARRY_OVER_KEY = "__carry_over__";
  const NO_PARENT_KEY = "__no_parent__";

  const meetingAreaKeys = useMemo(() => {
    const keys: { key: string; label: string; count: number }[] = [];
    for (const g of groupedItems) {
      if (g.parentId !== null) {
        keys.push({ key: `${g.parentId}::${g.parentTitle}`, label: g.parentTitle, count: g.items.length });
      } else {
        keys.push({ key: NO_PARENT_KEY, label: "Ungrouped", count: g.items.length });
      }
    }
    if (carryOverItems.length > 0) {
      keys.push({ key: CARRY_OVER_KEY, label: "Carry-over", count: carryOverItems.length });
    }
    return keys;
  }, [groupedItems, carryOverItems]);

  const meetingFilteredItems = useMemo(() => {
    if (meetingSelectedAreas.size === 0) return allPlanningItems;
    return allPlanningItems.filter((item) => {
      // Check if it's a carry-over item
      if (meetingSelectedAreas.has(CARRY_OVER_KEY) && carryOverItems.some((c) => c.id === item.id)) return true;
      // Check parent group
      if (item.parentId && item.parentTitle) {
        return meetingSelectedAreas.has(`${item.parentId}::${item.parentTitle}`);
      }
      return meetingSelectedAreas.has(NO_PARENT_KEY);
    });
  }, [allPlanningItems, carryOverItems, meetingSelectedAreas]);

  const meetingIndex = meetingFilteredItems.findIndex((i) => i.id === selectedId);

  // Meeting mode: current area info
  const currentMeetingArea = useMemo(() => {
    if (!meetingMode || !selectedItem) return null;
    const isCarryOver = carryOverItems.some((c) => c.id === selectedItem.id);
    const areaLabel = isCarryOver ? "Carry-over" : (selectedItem.parentTitle ?? "Ungrouped");
    const areaItems = meetingFilteredItems.filter((i) => {
      const isCO = carryOverItems.some((c) => c.id === i.id);
      if (isCarryOver) return isCO;
      return !isCO && (i.parentTitle ?? "Ungrouped") === (selectedItem.parentTitle ?? "Ungrouped");
    });
    const indexInArea = areaItems.findIndex((i) => i.id === selectedItem.id);
    return { label: areaLabel, items: areaItems, indexInArea, total: areaItems.length };
  }, [meetingMode, selectedItem, meetingFilteredItems, carryOverItems]);

  // Meeting mode: area breadcrumbs
  const meetingAreaBreadcrumbs = useMemo(() => {
    if (!meetingMode || meetingSelectedAreas.size === 0) return [];
    const currentLabel = currentMeetingArea?.label ?? "";
    return meetingAreaKeys
      .filter((a) => meetingSelectedAreas.has(a.key))
      .map((a) => {
        // Check if area has any remaining items in filtered list
        const remaining = meetingFilteredItems.filter((i) => {
          const isCO = carryOverItems.some((c) => c.id === i.id);
          if (a.key === CARRY_OVER_KEY) return isCO;
          if (a.key === NO_PARENT_KEY) return !isCO && !i.parentId;
          return !isCO && i.parentId && `${i.parentId}::${i.parentTitle}` === a.key;
        });
        const isCurrent = a.label === currentLabel;
        const isComplete = remaining.length === 0;
        return { ...a, isCurrent, isComplete, remaining: remaining.length };
      });
  }, [meetingMode, meetingSelectedAreas, meetingAreaKeys, meetingFilteredItems, carryOverItems, currentMeetingArea]);

  function selectNext() {
    if (meetingMode) {
      if (meetingIndex < meetingFilteredItems.length - 1) setSelectedId(meetingFilteredItems[meetingIndex + 1].id);
      return;
    }
    if (selectedIndex < items.length - 1) setSelectedId(items[selectedIndex + 1].id);
  }
  function selectPrev() {
    if (meetingMode) {
      if (meetingIndex > 0) setSelectedId(meetingFilteredItems[meetingIndex - 1].id);
      return;
    }
    if (selectedIndex > 0) setSelectedId(items[selectedIndex - 1].id);
  }

  // Handle child task created
  const handleChildCreated = useCallback((child: WorkItem) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== selectedId) return item;
        return { ...item, children: [...item.children, child], childCount: item.childCount + 1 };
      })
    );
    showMsg(`Task created: ${child.title}`);
  }, [selectedId]);

  // Handle state change
  const handleStateChange = useCallback(async (id: number, newState: string) => {
    const res = await fetch("/api/work-items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, state: newState }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    setItems((prev) =>
      prev.map((item) => {
        if (item.id === id) return { ...item, state: data.state };
        return {
          ...item,
          children: item.children.map((c) => c.id === id ? { ...c, state: data.state } : c),
        };
      })
    );
    if (id === selectedId) {
      setDetails((d) => d ? { ...d, state: data.state } : d);
    }
  }, [selectedId]);

  // Handle task deletion
  const handleDeleteTask = useCallback(async (taskId: number) => {
    const res = await fetch("/api/work-items", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: taskId }),
    });
    if (!res.ok) {
      const data = await res.json();
      showMsg(data.error || "Could not delete task", "error");
      return;
    }
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        children: item.children.filter((c) => c.id !== taskId),
        childCount: Math.max(0, item.childCount - (item.children.some((c) => c.id === taskId) ? 1 : 0)),
      }))
    );
    showMsg("Task deleted");
  }, []);

  // Handle task assignee change
  const handleTaskAssigneeChange = useCallback((taskId: number, assignee: string | null) => {
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        children: item.children.map((c) => c.id === taskId ? { ...c, assignedTo: assignee } : c),
      }))
    );
    setCarryOverItems((prev) =>
      prev.map((item) => ({
        ...item,
        children: item.children.map((c) => c.id === taskId ? { ...c, assignedTo: assignee } : c),
      }))
    );
  }, []);

  // Handle PBI assignee change
  const handlePbiAssigneeSaved = useCallback((assignee: string | null) => {
    if (!selectedId) return;
    setItems((prev) =>
      prev.map((item) => item.id === selectedId ? { ...item, assignedTo: assignee } : item)
    );
  }, [selectedId]);

  // Handle PBI priority change
  const handlePriorityChange = useCallback(async (itemId: number, priority: number) => {
    try {
      const res = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: itemId, fields: { priority } }),
      });
      if (res.ok) {
        setItems((prev) =>
          prev.map((item) => item.id === itemId ? { ...item, priority } : item)
        );
        setCarryOverItems((prev) =>
          prev.map((item) => item.id === itemId ? { ...item, priority } : item)
        );
      }
    } catch { /* ignore */ }
  }, []);

  // "Done planning" — move to sprint + set sprintPlanning = false
  const isCarryOverItem = selectedItem ? carryOverItems.some((i) => i.id === selectedItem.id) : false;

  const handleDonePlanning = useCallback(async () => {
    if (!selectedItem || !doneSprint) return;
    setDonePlanningLoading(true);

    const isFromCarryOver = carryOverItems.some((i) => i.id === selectedItem.id);

    try {
      // 1. Move PBI to sprint. For sprint-planning items, also flip SprintPlanning=false and set State=Approved.
      const fields: Record<string, unknown> = { iterationPath: doneSprint };
      if (!isFromCarryOver) {
        fields.sprintPlanning = false;
        fields.state = "Approved";
      }

      const res = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedItem.id, fields }),
      });
      if (!res.ok) {
        const data = await res.json();
        showMsg(data.error || "Failed to move to sprint", "error");
        return;
      }

      // 2. Move active children to same sprint
      const activeChildIds = selectedItem.children
        .filter((c) => !DONE_STATES.has(c.state))
        .map((c) => c.id);

      let movedMsg = "";
      if (activeChildIds.length > 0) {
        const bulkRes = await fetch("/api/work-items", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: activeChildIds, iterationPath: doneSprint }),
        });
        if (bulkRes.ok) {
          const bulkData = await bulkRes.json();
          const moved = bulkData.succeeded?.length ?? 0;
          movedMsg = ` + ${moved} tasks moved`;
        }
      }

      // 3. Select next item and remove from appropriate list
      if (isFromCarryOver) {
        setCarryOverItems((prev) => prev.filter((i) => i.id !== selectedItem.id));
        setCarryOverSelected((prev) => { const next = new Set(prev); next.delete(selectedItem.id); return next; });
      } else {
        setItems((prev) => prev.filter((i) => i.id !== selectedItem.id));
      }

      const nextId = selectedIndex < items.length - 1
        ? items[selectedIndex + 1].id
        : selectedIndex > 0
          ? items[selectedIndex - 1].id
          : null;

      setSelectedId(nextId);
      setCapacityRefreshKey((k) => k + 1);

      const sprintName = doneSprint.replace("Relaunch - Charlie Tango\\", "");
      showMsg(`#${selectedItem.id} → ${sprintName}${movedMsg}`);
    } catch {
      showMsg("Connection error", "error");
    } finally {
      setDonePlanningLoading(false);
    }
  }, [selectedItem, selectedIndex, items, carryOverItems, doneSprint]);

  // Drag-and-drop handlers
  const handleDragStart = useCallback((itemId: number) => {
    dragSrcId.current = itemId;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (dragSrcId.current !== targetId) setDragOverId(targetId);
  }, []);

  const handleDrop = useCallback((targetId: number) => {
    const srcId = dragSrcId.current;
    if (!srcId || srcId === targetId) { setDragOverId(null); return; }

    setItems((prev) => {
      const newItems = [...prev];
      const srcIdx = newItems.findIndex((i) => i.id === srcId);
      const targetIdx = newItems.findIndex((i) => i.id === targetId);
      if (srcIdx < 0 || targetIdx < 0) return prev;
      const [item] = newItems.splice(srcIdx, 1);
      newItems.splice(targetIdx, 0, item);
      return newItems;
    });

    setDragOverId(null);
    dragSrcId.current = null;
  }, []);

  // Copy task structure from another PBI
  const handleCopyTasks = useCallback(async () => {
    const id = Number(copyFromId);
    if (!id || !selectedItem) return;
    setCopyLoading(true);
    try {
      const res = await fetch(`/api/work-items?action=pbi-task-structure&id=${id}`);
      const tasks = await res.json();
      if (!Array.isArray(tasks) || tasks.length === 0) {
        showMsg("No tasks found on that PBI", "error");
        return;
      }

      let created = 0;
      for (const task of tasks) {
        const title = task.title.replace(/^(Development|QA|Release|Other):\s*/, "");
        const taskTitle = task.activity ? `${task.activity}: ${selectedItem.title}` : title;
        const createRes = await fetch("/api/work-items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parentId: selectedItem.id,
            title: taskTitle,
            iterationPath: doneSprint || "Relaunch - Charlie Tango",
            remainingWork: task.remainingWork,
            activity: task.activity || "Development",
            tags: task.tags || undefined,
          }),
        });
        if (createRes.ok) {
          const newTask = await createRes.json();
          handleChildCreated(newTask);
          created++;
        }
      }
      showMsg(`Copied ${created} tasks from #${id}`);
      setCopyFromId("");
    } catch {
      showMsg("Failed to copy tasks", "error");
    } finally {
      setCopyLoading(false);
    }
  }, [copyFromId, selectedItem, doneSprint, handleChildCreated]);

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); selectNext(); }
      if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); selectPrev(); }
      if (e.key === "d" && !meetingMode) { e.preventDefault(); setDragEnabled((d) => !d); }
      if (e.key === "m" && !meetingMode) {
        e.preventDefault();
        // Open picker if multiple areas, else start directly
        if (meetingAreaKeys.length <= 1) {
          setMeetingSelectedAreas(new Set());
          setMeetingMode(true);
        } else {
          setMeetingPickerOpen(true);
        }
      }
      if (e.key === "Escape" && meetingMode) { e.preventDefault(); setMeetingMode(false); setMeetingPickerOpen(false); }
      if (e.key === "Escape" && meetingPickerOpen) { e.preventDefault(); setMeetingPickerOpen(false); }
      if (e.key === "Enter" && meetingMode && !donePlanningLoading) { e.preventDefault(); handleDonePlanning(); }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // --- RENDER ---

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-stale-ancient/30 bg-stale-ancient/10 px-5 py-3 text-sm text-stale-ancient">
        {error}
        <button onClick={fetchItems} className="ml-3 underline hover:no-underline">Retry</button>
      </div>
    );
  }

  if (items.length === 0 && carryOverItems.length === 0) {
    return (
      <div className="rounded-xl border border-border-default bg-bg-card p-12 text-center">
        <div className="text-4xl mb-3">&#9989;</div>
        <p className="text-lg font-medium text-text-primary">No items to plan</p>
        <p className="mt-1 text-sm text-text-muted">
          Set <code className="rounded bg-bg-secondary px-1.5 py-0.5 text-accent-blue">Sprint Planning = True</code> on PBIs or Bugs in Azure DevOps to see them here.
        </p>
      </div>
    );
  }

  // Area picker dialog
  if (meetingPickerOpen) {
    const pickerCount = meetingSelectedAreas.size === 0
      ? allPlanningItems.length
      : allPlanningItems.filter((item) => {
          if (meetingSelectedAreas.has(CARRY_OVER_KEY) && carryOverItems.some((c) => c.id === item.id)) return true;
          if (item.parentId && item.parentTitle) return meetingSelectedAreas.has(`${item.parentId}::${item.parentTitle}`);
          return meetingSelectedAreas.has(NO_PARENT_KEY);
        }).length;

    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-full max-w-md rounded-xl border border-border-default bg-bg-card shadow-2xl">
          <div className="border-b border-border-default px-6 py-4">
            <h2 className="text-lg font-bold text-text-primary">Start Planning Meeting</h2>
            <p className="mt-1 text-sm text-text-muted">Select areas to plan:</p>
          </div>
          <div className="px-6 py-4 space-y-1">
            {meetingAreaKeys.filter((a) => a.key !== CARRY_OVER_KEY).map((area) => (
              <label key={area.key} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-bg-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={meetingSelectedAreas.has(area.key)}
                  onChange={() => {
                    setMeetingSelectedAreas((prev) => {
                      const next = new Set(prev);
                      if (next.has(area.key)) next.delete(area.key); else next.add(area.key);
                      return next;
                    });
                  }}
                  className="accent-accent-blue"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{area.label}</span>
                <span className="text-xs text-text-muted tabular-nums">{area.count}</span>
              </label>
            ))}
            {carryOverItems.length > 0 && (
              <>
                <div className="my-2 h-px bg-border-default" />
                <label className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-bg-primary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={meetingSelectedAreas.has(CARRY_OVER_KEY)}
                    onChange={() => {
                      setMeetingSelectedAreas((prev) => {
                        const next = new Set(prev);
                        if (next.has(CARRY_OVER_KEY)) next.delete(CARRY_OVER_KEY); else next.add(CARRY_OVER_KEY);
                        return next;
                      });
                    }}
                    className="accent-accent-gold"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-accent-gold font-medium">Carry-over items</span>
                  <span className="text-xs text-accent-gold tabular-nums">{carryOverItems.length}</span>
                </label>
              </>
            )}
          </div>
          <div className="flex gap-3 border-t border-border-default px-6 py-4">
            <button
              onClick={() => {
                const startItems = meetingSelectedAreas.size === 0 ? allPlanningItems : meetingFilteredItems;
                if (startItems.length > 0) {
                  setSelectedId(startItems[0].id);
                  setMeetingMode(true);
                  setMeetingPickerOpen(false);
                }
              }}
              disabled={pickerCount === 0}
              className="flex-1 rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/90 disabled:opacity-40"
            >
              Start ({pickerCount} items)
            </button>
            <button
              onClick={() => { setMeetingPickerOpen(false); setMeetingSelectedAreas(new Set()); }}
              className="rounded-lg px-4 py-2 text-sm text-text-muted hover:text-text-primary hover:bg-bg-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Meeting mode render
  if (meetingMode && selectedItem) {
    return (
      <PlanningMeetingMode
        item={selectedItem}
        details={details}
        detailsLoading={detailsLoading}
        currentIndex={meetingIndex >= 0 ? meetingIndex : 0}
        totalItems={meetingFilteredItems.length}
        capacityData={capacityData}
        isCarryOverItem={isCarryOverItem}
        doneSprint={doneSprint}
        iterations={iterations}
        availableStates={availableStates}
        donePlanningLoading={donePlanningLoading}
        areaInfo={currentMeetingArea}
        areaBreadcrumbs={meetingAreaBreadcrumbs}
        onNext={selectNext}
        onPrev={selectPrev}
        onExit={() => { setMeetingMode(false); setMeetingPickerOpen(false); }}
        onDonePlanning={handleDonePlanning}
        onSprintChange={setDoneSprint}
        onStateChange={handleStateChange}
        onDeleteTask={handleDeleteTask}
        onChildCreated={handleChildCreated}
        onPbiAssigneeSaved={handlePbiAssigneeSaved}
        onTaskAssigneeChange={handleTaskAssigneeChange}
        onPriorityChange={handlePriorityChange}
        availableAssignees={availableAssignees}
      />
    );
  }

  const totalTasks = items.reduce((sum, i) => sum + i.children.length, 0);
  const totalHours = items.reduce((sum, i) => sum + i.children.reduce((s, c) => s + (c.remainingWork ?? 0), 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-6 rounded-xl bg-bg-secondary px-5 py-2.5 border border-border-default">
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold tabular-nums text-text-primary">{items.length}</span>
          <span className="text-xs text-text-muted">to plan</span>
        </div>
        <div className="h-4 w-px bg-border-default" />
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold tabular-nums text-text-primary">{totalTasks}</span>
          <span className="text-xs text-text-muted">tasks</span>
        </div>
        <div className="h-4 w-px bg-border-default" />
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold tabular-nums text-accent-gold">{totalHours}h</span>
          <span className="text-xs text-text-muted">estimated</span>
        </div>
        {carryOverItems.length > 0 && (
          <>
            <div className="h-4 w-px bg-border-default" />
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold tabular-nums text-accent-gold">{carryOverItems.length}</span>
              <span className="text-xs text-text-muted">carry-over</span>
            </div>
          </>
        )}
        <button
          onClick={() => {
            if (meetingAreaKeys.length <= 1) {
              setMeetingSelectedAreas(new Set());
              if (allPlanningItems.length > 0) setSelectedId(allPlanningItems[0].id);
              setMeetingMode(true);
            } else {
              setMeetingPickerOpen(true);
            }
          }}
          disabled={items.length === 0 && carryOverItems.length === 0}
          className={clsx(
            "ml-auto rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            "bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/20 disabled:opacity-30"
          )}
          title="Enter meeting mode (m)"
        >
          Meeting
        </button>
        <button
          onClick={() => setDragEnabled((d) => !d)}
          className={clsx(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            dragEnabled ? "bg-accent-gold/15 text-accent-gold" : "text-text-muted hover:bg-bg-card-hover hover:text-text-primary"
          )}
          title="Toggle drag-and-drop reordering (d)"
        >
          {dragEnabled ? "Reorder ON" : "Reorder"}
        </button>
        <button
          onClick={fetchItems}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-bg-card-hover hover:text-text-primary"
        >
          Refresh
        </button>
      </div>

      {/* Action message */}
      {actionMsg && (
        <div className={clsx(
          "rounded-xl border px-4 py-2.5 text-sm",
          actionMsgType === "error"
            ? "border-stale-ancient/30 bg-stale-ancient/10 text-stale-ancient"
            : "border-stale-fresh/30 bg-stale-fresh/10 text-stale-fresh"
        )}>
          {actionMsg}
        </div>
      )}

      {/* Three-column layout */}
      <div className="sprint-3col flex gap-4 items-start">
        {/* Left sidebar — item list, sticky */}
        <div className="w-72 shrink-0 sticky top-6 max-h-[calc(100vh-120px)] overflow-y-auto rounded-xl border border-border-default bg-bg-card">
          <div className="sticky top-0 z-10 border-b border-border-default/50 bg-bg-card px-4 py-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Items</span>
          </div>

          {/* Carry-over section */}
          {(carryOverItems.length > 0 || carryOverLoading) && (
            <div className="border-b border-border-default/50">
              <button
                onClick={() => setCarryOverOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-bg-card-hover"
              >
                <svg className={clsx("h-3 w-3 text-text-muted transition-transform", carryOverOpen && "rotate-90")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-[11px] font-bold uppercase tracking-wider text-accent-gold">Carry-over</span>
                <span className="rounded-full bg-accent-gold/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-accent-gold">{carryOverItems.length}</span>
                {carryOverLoading && <div className="ml-auto h-3 w-3 animate-spin rounded-full border border-accent-gold border-t-transparent" />}
              </button>

              {carryOverOpen && carryOverItems.length > 0 && (
                <div className="px-1.5 pb-2">
                  <div className="mb-1.5 flex items-center gap-2 px-2">
                    <label className="flex items-center gap-1.5 text-[10px] text-text-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={carryOverSelected.size === carryOverItems.length && carryOverItems.length > 0}
                        onChange={toggleCarryOverSelectAll}
                        className="h-3 w-3 rounded border-border-default accent-accent-gold"
                      />
                      All
                    </label>
                    {carryOverSelected.size > 0 && (
                      <button
                        onClick={handleCarryOver}
                        disabled={carryOverMoving}
                        className="ml-auto rounded bg-accent-gold/15 px-2 py-0.5 text-[10px] font-semibold text-accent-gold transition-colors hover:bg-accent-gold/25 disabled:opacity-50"
                      >
                        {carryOverMoving ? "Moving..." : `Move ${carryOverSelected.size} → ${targetSprintName}`}
                      </button>
                    )}
                  </div>
                  <p className="mb-1.5 px-2 text-[10px] text-text-muted/60">
                    Unfinished in {currentSprintName}
                  </p>
                  {carryOverItems.map((item) => {
                    const totalHours = item.children.reduce((sum, c) => sum + (c.remainingWork ?? 0), 0);
                    const activeChildren = item.children.filter((c) => !DONE_STATES.has(c.state)).length;
                    return (
                      <div
                        key={item.id}
                        className={clsx(
                          "flex items-start gap-1.5 rounded-lg px-2 py-2 transition-colors",
                          carryOverSelected.has(item.id) ? "bg-accent-gold/8" : "hover:bg-bg-card-hover"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={carryOverSelected.has(item.id)}
                          onChange={() => toggleCarryOverSelect(item.id)}
                          className="mt-1 h-3 w-3 shrink-0 rounded border-border-default accent-accent-gold"
                        />
                        <button
                          onClick={() => setSelectedId(item.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-center gap-1.5">
                            <WorkItemTypeIcon type={item.type} />
                            <span className="text-[10px] font-mono text-text-muted">#{item.id}</span>
                            <span className={clsx(
                              "ml-auto rounded px-1 py-0.5 text-[9px] font-semibold",
                              item.state === "Active" ? "bg-stale-fresh/15 text-stale-fresh" : "bg-accent-blue/15 text-accent-blue"
                            )}>
                              {item.state}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-xs font-medium text-text-primary leading-snug">{item.title}</p>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-text-muted">
                            {activeChildren > 0 && <span>{activeChildren} active tasks</span>}
                            {totalHours > 0 && <span className="text-accent-gold">{totalHours}h remaining</span>}
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="p-1.5 space-y-0.5">
            {groupedItems.map((group) => (
              <div key={group.parentId ?? "ungrouped"}>
                <div className="mt-3 mb-1 px-3 first:mt-1.5">
                  <div className="flex items-start gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider leading-snug text-text-muted/70">{group.parentTitle}</span>
                    <span className="shrink-0 mt-px text-[10px] text-text-muted/40">{group.items.length}</span>
                  </div>
                  <div className="mt-1.5 h-px bg-border-default/30" />
                </div>
                {group.items.map((item) => (
                  <SidebarItem
                    key={item.id}
                    item={item}
                    selected={item.id === selectedId}
                    onClick={() => setSelectedId(item.id)}
                    dragEnabled={dragEnabled}
                    onDragStart={() => handleDragStart(item.id)}
                    onDragOver={(e) => handleDragOver(e, item.id)}
                    onDrop={() => handleDrop(item.id)}
                    isDragOver={dragOverId === item.id}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Center main panel */}
        <div className="flex-1 min-w-0 rounded-xl border border-border-default bg-bg-card">
          {detailsLoading && !details ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
            </div>
          ) : selectedItem && details ? (
            <div>
              {/* Header */}
              <div className="border-b border-border-default/50 px-6 py-4">
                {/* Row 1: metadata + link */}
                <div className="flex items-center gap-2.5">
                  <WorkItemTypeIcon type={selectedItem.type} />
                  <span className="text-xs font-mono text-text-muted">#{selectedItem.id}</span>
                  <div onClick={(e) => e.stopPropagation()}>
                    <StateSelector
                      currentState={details.state}
                      availableStates={availableStates}
                      onStateChange={async (s) => {
                        await handleStateChange(selectedItem.id, s);
                        setDetails((d) => d ? { ...d, state: s } : d);
                      }}
                    />
                  </div>
                  <select
                    value={selectedItem.priority}
                    onChange={(e) => handlePriorityChange(selectedItem.id, Number(e.target.value))}
                    className={clsx(
                      "appearance-none rounded px-1.5 py-0.5 text-[11px] font-bold cursor-pointer border-none outline-none transition-colors hover:ring-1 hover:ring-border-default",
                      selectedItem.priority === 1 ? "bg-stale-ancient/15 text-stale-ancient" : selectedItem.priority === 2 ? "bg-stale-stale/15 text-stale-stale" : selectedItem.priority === 3 ? "bg-accent-blue/10 text-accent-blue" : "bg-text-muted/10 text-text-muted"
                    )}
                    title="Priority"
                  >
                    <option value={1}>P1</option>
                    <option value={2}>P2</option>
                    <option value={3}>P3</option>
                    <option value={4}>P4</option>
                  </select>
                  {details.storyPoints != null && (
                    <span className="rounded bg-accent-blue/10 px-1.5 py-0.5 text-[11px] font-semibold text-accent-blue">{details.storyPoints} SP</span>
                  )}
                  {selectedItem.refinement && (
                    <span className="rounded-full bg-accent-gold/15 px-2 py-0.5 text-[11px] font-semibold text-accent-gold">Refinement</span>
                  )}
                  <a
                    href={selectedItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-xs text-text-muted transition-colors hover:text-accent-blue"
                  >
                    Azure DevOps &rarr;
                  </a>
                </div>
                {/* Row 2: title */}
                <h3 className="mt-2.5 text-xl font-bold leading-tight text-text-primary">{selectedItem.title}</h3>
                {/* Row 3: assignee, sprint, tags */}
                <div className="mt-3 flex items-center gap-4 text-sm text-text-muted">
                  <PbiAssigneeEditor
                    key={selectedItem.id}
                    itemId={selectedItem.id}
                    initialValue={selectedItem.assignedTo}
                    suggestions={availableAssignees}
                    onSaved={handlePbiAssigneeSaved}
                  />
                  {selectedItem.iterationPath && selectedItem.iterationPath !== "Relaunch - Charlie Tango" && (
                    <span className="rounded bg-bg-secondary px-2 py-0.5 text-xs">{selectedItem.iterationPath.replace("Relaunch - Charlie Tango\\", "")}</span>
                  )}
                  {selectedItem.tags && (
                    <div className="flex gap-1.5">
                      {selectedItem.tags.split(";").filter(t => t.trim()).map((tag) => (
                        <span key={tag.trim()} className="rounded bg-bg-secondary px-1.5 py-0.5 text-xs">{tag.trim()}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Action bar — workflow completion */}
              <div className="border-b border-accent-teal/20 bg-accent-teal/10 px-6 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Move to</span>
                  <select
                    value={doneSprint}
                    onChange={(e) => setDoneSprint(e.target.value)}
                    disabled={donePlanningLoading}
                    className="rounded-lg border border-border-default bg-bg-input px-3 py-1.5 text-sm text-text-primary outline-none focus:border-border-focus disabled:opacity-50"
                  >
                    {getRelevantSprints(iterations).map((s) => {
                      const isCurrent = s.path === getCurrentSprintPath(iterations);
                      const isNext = s.path === getNextSprintPath(iterations);
                      const prefix = isCurrent ? ">> " : isNext ? "* " : "";
                      return (
                        <option key={s.id} value={s.path}>
                          {prefix}{s.name}{isCurrent ? " (current)" : isNext ? " (next)" : ""}
                        </option>
                      );
                    })}
                  </select>
                  <button
                    onClick={handleDonePlanning}
                    disabled={donePlanningLoading || !doneSprint}
                    className={clsx(
                      "rounded-lg px-5 py-1.5 text-sm font-semibold text-white transition-colors disabled:opacity-50",
                      isCarryOverItem
                        ? "bg-accent-gold hover:bg-accent-gold/80"
                        : "bg-accent-teal hover:bg-accent-teal/80"
                    )}
                  >
                    {donePlanningLoading ? "Moving..." : isCarryOverItem ? "Carry over" : "Done planning"}
                  </button>
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      onClick={selectPrev}
                      disabled={selectedIndex <= 0}
                      className="rounded-md border border-border-default px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-bg-card-hover hover:text-text-primary disabled:opacity-30"
                    >
                      &larr;
                    </button>
                    <span className="text-[11px] tabular-nums text-text-muted">{selectedIndex + 1}/{items.length}</span>
                    <button
                      onClick={selectNext}
                      disabled={selectedIndex >= items.length - 1}
                      className="rounded-md border border-border-default px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-bg-card-hover hover:text-text-primary disabled:opacity-30"
                    >
                      &rarr;
                    </button>
                    <span className="ml-1 text-[10px] text-text-muted/40">
                      <kbd className="rounded bg-bg-secondary/60 px-1">j</kbd>/<kbd className="rounded bg-bg-secondary/60 px-1">k</kbd>
                    </span>
                  </div>
                </div>
              </div>

              {/* Create task */}
              <div className="border-b border-border-default/50 bg-accent-blue/[0.04] px-6 py-4">
                <div className="mb-2.5 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">Create Task</h4>
                  {/* Copy task structure */}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={copyFromId}
                      onChange={(e) => setCopyFromId(e.target.value)}
                      placeholder="PBI #"
                      className="w-20 rounded border border-border-default bg-bg-input px-2 py-1 text-xs text-text-primary placeholder:text-text-muted/50 outline-none focus:border-border-focus [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      title="Copy task structure from another PBI"
                    />
                    <button
                      onClick={handleCopyTasks}
                      disabled={!copyFromId || copyLoading}
                      className="rounded bg-bg-secondary px-2 py-1 text-[10px] font-medium text-text-muted transition-colors hover:bg-bg-card-hover hover:text-text-primary disabled:opacity-40"
                      title="Copy tasks from PBI"
                    >
                      {copyLoading ? "..." : "Copy tasks"}
                    </button>
                  </div>
                </div>
                <QuickCreateForm
                  parentId={selectedItem.id}
                  pbiTitle={selectedItem.title}
                  pbiAssignedTo={selectedItem.assignedTo}
                  availableAssignees={availableAssignees}
                  iterations={iterations}
                  onCreated={handleChildCreated}
                  capacityData={capacityData}
                />
              </div>

              {/* Existing tasks */}
              <div className="border-b border-border-default/50 px-6 py-4">
                <div className="mb-2.5 flex items-center gap-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">
                    Tasks
                  </h4>
                  <span className="rounded-full bg-bg-secondary px-2 py-0.5 text-[11px] font-semibold tabular-nums text-text-secondary">
                    {selectedItem.children.length}
                  </span>
                  {selectedItem.children.length > 0 && (
                    <span className="rounded-full bg-accent-gold/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-accent-gold">
                      {selectedItem.children.reduce((s, c) => s + (c.remainingWork ?? 0), 0)}h
                    </span>
                  )}
                </div>
                {selectedItem.children.length > 0 ? (
                  <div className="rounded-lg border border-border-default/60 bg-bg-primary">
                    {selectedItem.children.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        availableStates={availableStates}
                        availableAssignees={availableAssignees}
                        onStateChange={handleStateChange}
                        onDelete={handleDeleteTask}
                        onAssigneeChange={handleTaskAssigneeChange}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border-default/40 py-4 text-center text-xs text-text-muted/50">
                    No tasks yet — create one above
                  </div>
                )}
              </div>

              {/* Description + AC */}
              <div className="px-6 py-4 space-y-4">
                <div>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-text-muted">Description</h4>
                  {details.description ? (
                    <div className="rounded-lg bg-bg-primary px-4 py-3">
                      <RichHtmlContent html={details.description} className="prose-devops text-sm text-text-secondary leading-relaxed" />
                    </div>
                  ) : (
                    <p className="text-xs italic text-text-muted/40">No description</p>
                  )}
                </div>
                {details.acceptanceCriteria && (
                  <div>
                    <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-text-muted">Acceptance Criteria</h4>
                    <div className="rounded-lg bg-bg-primary px-4 py-3">
                      <RichHtmlContent html={details.acceptanceCriteria} className="prose-devops text-sm text-text-secondary leading-relaxed" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-20">
              <p className="text-text-muted">Select an item to start planning</p>
            </div>
          )}
        </div>

        {/* Right capacity sidebar — sticky */}
        <div className="w-80 shrink-0 sticky top-6 max-h-[calc(100vh-120px)] overflow-y-auto space-y-3">
          <SprintGoalEditor iterationId={targetIteration?.id ?? null} />
          <CapacityPanel
            iterationId={targetIteration?.id ?? null}
            sprintName={targetSprintName}
            refreshKey={capacityRefreshKey}
            onDataLoaded={setCapacityData}
          />
          <WhatIfPreview item={selectedItem ?? null} capacityData={capacityData} />
        </div>
      </div>
    </div>
  );
}

// --- Meeting Mode: Compact Capacity Summary ---

function MeetingCapacitySummary({ data, item }: { data: SprintCapacityData | null; item: WorkItemWithChildren }) {
  if (!data || data.members.length === 0) return null;

  const totalAssigned = data.members.reduce((s, m) => s + m.totalAssigned, 0);
  const totalCapacity = data.members.reduce((s, m) => s + m.totalCapacity, 0);

  // What-if: additional hours this item would add
  const additionalHours = new Map<string, number>();
  for (const child of item.children) {
    if (child.assignedTo && child.remainingWork) {
      additionalHours.set(child.assignedTo, (additionalHours.get(child.assignedTo) ?? 0) + child.remainingWork);
    }
  }

  return (
    <div className="rounded-xl border border-border-default bg-bg-card">
      <div className="border-b border-border-default/50 px-4 py-2.5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">Team Capacity</h4>
          <span className={clsx(
            "text-sm font-mono tabular-nums font-semibold",
            totalAssigned > totalCapacity ? "text-stale-ancient" : totalAssigned / totalCapacity > 0.8 ? "text-accent-gold" : "text-accent-blue"
          )}>
            {Math.round(totalAssigned)}h / {Math.round(totalCapacity)}h
          </span>
        </div>
        <div className="mt-1.5">
          <CapacityBar assigned={Math.round(totalAssigned)} capacity={Math.round(totalCapacity)} />
        </div>
      </div>
      <div className="px-4 py-2 space-y-1.5">
        {data.members.map((member) => {
          const extra = additionalHours.get(member.displayName) ?? 0;
          const displayAssigned = member.totalAssigned;
          const projectedAssigned = displayAssigned + extra;
          return (
            <div key={member.displayName} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-xs text-text-secondary">{member.displayName}</span>
              <div className="flex-1">
                <CapacityBar assigned={Math.round(displayAssigned)} capacity={Math.round(member.totalCapacity)} />
              </div>
              {extra > 0 && (
                <span className={clsx(
                  "shrink-0 text-[11px] font-mono tabular-nums",
                  projectedAssigned > member.totalCapacity ? "text-stale-ancient font-bold" : "text-accent-gold"
                )}>
                  +{extra}h
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Meeting Mode: Full-screen planning presentation ---

function PlanningMeetingMode({
  item,
  details,
  detailsLoading,
  currentIndex,
  totalItems,
  capacityData,
  isCarryOverItem,
  doneSprint,
  iterations,
  availableStates,
  donePlanningLoading,
  areaInfo,
  areaBreadcrumbs,
  onNext,
  onPrev,
  onExit,
  onDonePlanning,
  onSprintChange,
  onStateChange,
  onDeleteTask,
  onChildCreated,
  onPbiAssigneeSaved,
  onTaskAssigneeChange,
  onPriorityChange,
  availableAssignees,
}: {
  item: WorkItemWithChildren;
  details: WorkItemDetails | null;
  detailsLoading: boolean;
  currentIndex: number;
  totalItems: number;
  capacityData: SprintCapacityData | null;
  isCarryOverItem: boolean;
  doneSprint: string;
  iterations: Iteration[];
  availableStates: string[];
  donePlanningLoading: boolean;
  areaInfo: { label: string; items: WorkItemWithChildren[]; indexInArea: number; total: number } | null;
  areaBreadcrumbs: { key: string; label: string; count: number; isCurrent: boolean; isComplete: boolean; remaining: number }[];
  onNext: () => void;
  onPrev: () => void;
  onExit: () => void;
  onDonePlanning: () => void;
  availableAssignees: string[];
  onSprintChange: (path: string) => void;
  onStateChange: (id: number, state: string) => Promise<void>;
  onDeleteTask: (id: number) => void;
  onChildCreated: (child: WorkItem) => void;
  onPbiAssigneeSaved: (assignee: string | null) => void;
  onTaskAssigneeChange: (id: number, assignee: string | null) => void;
  onPriorityChange: (itemId: number, priority: number) => void;
}) {
  const totalHours = item.children.reduce((s, c) => s + (c.remainingWork ?? 0), 0);
  const progressPct = totalItems > 0 ? ((currentIndex + 1) / totalItems) * 100 : 0;

  // AI Summary state
  const [aiSummary, setAiSummary] = useState<{ workItemId: number; summary: string[]; relevantFiles: { path: string; snippet: string }[]; generatedAt: string } | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const aiSummaryCacheRef = useRef<Map<number, typeof aiSummary>>(new Map());

  // Show cached summary when navigating items
  useEffect(() => {
    const cached = aiSummaryCacheRef.current.get(item.id);
    setAiSummary(cached ?? null);
  }, [item.id]);

  const handleGenerateAISummary = useCallback(async () => {
    const cached = aiSummaryCacheRef.current.get(item.id);
    if (cached) { setAiSummary(cached); return; }
    setAiSummaryLoading(true);
    try {
      const desc = details?.description?.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() ?? "";
      const ac = details?.acceptanceCriteria?.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() ?? "";
      const res = await fetch("/api/ai-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workItemId: item.id, title: item.title, description: desc, acceptanceCriteria: ac }),
      });
      if (res.ok) {
        const data = await res.json();
        aiSummaryCacheRef.current.set(item.id, data);
        setAiSummary(data);
      }
    } catch { /* ignore */ } finally {
      setAiSummaryLoading(false);
    }
  }, [item.id, item.title, details]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-primary">
      {/* Top bar: navigation + area context */}
      <div className="border-b border-border-default bg-bg-secondary">
        {/* Row 1: Nav + progress */}
        <div className="flex items-center gap-4 px-6 py-2.5">
          <button
            onClick={onPrev}
            disabled={currentIndex === 0}
            className="rounded-lg bg-bg-card px-3 py-1.5 text-sm font-medium text-text-primary transition hover:bg-bg-card-hover disabled:opacity-30 disabled:cursor-not-allowed"
          >
            &larr;
          </button>

          <div className="text-center">
            {areaInfo && (
              <div className="text-sm font-semibold text-text-primary">
                {areaInfo.indexInArea + 1}/{areaInfo.total}
                <span className="mx-2 text-text-muted font-normal">in</span>
                <span className={isCarryOverItem ? "text-accent-gold" : "text-accent-blue"}>
                  {areaInfo.label}
                </span>
              </div>
            )}
            <div className="text-[11px] text-text-muted tabular-nums">
              {currentIndex + 1} of {totalItems} total
            </div>
          </div>

          <button
            onClick={onNext}
            disabled={currentIndex >= totalItems - 1}
            className="rounded-lg bg-bg-card px-3 py-1.5 text-sm font-medium text-text-primary transition hover:bg-bg-card-hover disabled:opacity-30 disabled:cursor-not-allowed"
          >
            &rarr;
          </button>

          {/* Progress bar */}
          <div className="flex-1 mx-4">
            <div className="h-1.5 rounded-full bg-bg-card">
              <div
                className="h-full rounded-full bg-accent-teal transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <span className="hidden lg:inline text-xs text-text-muted">
            <kbd className="rounded bg-bg-card px-1.5 py-0.5 font-mono text-[10px]">j</kbd>/<kbd className="rounded bg-bg-card px-1.5 py-0.5 font-mono text-[10px]">k</kbd>
            <span className="mx-1.5">&middot;</span>
            <kbd className="rounded bg-bg-card px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
            <span className="mx-1.5">&middot;</span>
            <kbd className="rounded bg-bg-card px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
          </span>

          <button
            onClick={onExit}
            className="rounded-lg bg-bg-card px-4 py-1.5 text-sm font-medium text-text-primary hover:bg-bg-card-hover"
          >
            Exit
          </button>
        </div>

        {/* Row 2: Area breadcrumbs */}
        {areaBreadcrumbs.length > 1 && (
          <div className="flex items-center gap-1 px-6 pb-2 overflow-x-auto">
            {areaBreadcrumbs.map((area, idx) => (
              <span key={area.key}>
                {idx > 0 && <span className="mx-1 text-text-muted/30">&rarr;</span>}
                <span className={clsx(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  area.isCurrent
                    ? "bg-accent-blue/15 text-accent-blue"
                    : area.isComplete
                      ? "bg-stale-fresh/10 text-stale-fresh"
                      : "bg-bg-card text-text-muted"
                )}>
                  {area.isComplete && (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {area.label}
                  {!area.isComplete && <span className="text-text-muted/50">{area.remaining}</span>}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Main content — edge to edge */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {detailsLoading && !details ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
          </div>
        ) : (
          <div>
            {/* Title area — metadata is quiet, title is loud */}
            <div className={clsx("mb-6", isCarryOverItem && "border-l-4 border-accent-gold pl-4")}>
              {/* Metadata row — small and muted */}
              <div className="flex items-center gap-2.5 text-xs text-text-muted">
                <WorkItemTypeIcon type={item.type} />
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="font-mono hover:text-accent-blue">
                  #{item.id}
                </a>
                <StateSelector currentState={item.state} availableStates={availableStates} onStateChange={(s) => onStateChange(item.id, s)} />
                <select
                  value={item.priority}
                  onChange={(e) => onPriorityChange(item.id, Number(e.target.value))}
                  className={clsx(
                    "appearance-none rounded px-1.5 py-0.5 text-[11px] font-bold cursor-pointer border-none outline-none transition-colors hover:ring-1 hover:ring-border-default",
                    item.priority === 1 ? "bg-stale-ancient/15 text-stale-ancient" : item.priority === 2 ? "bg-stale-stale/15 text-stale-stale" : item.priority === 3 ? "bg-accent-blue/10 text-accent-blue" : "bg-text-muted/10 text-text-muted"
                  )}
                  title="Priority"
                >
                  <option value={1}>P1</option>
                  <option value={2}>P2</option>
                  <option value={3}>P3</option>
                  <option value={4}>P4</option>
                </select>
                {isCarryOverItem && (
                  <span className="rounded-full bg-accent-gold/15 px-2 py-0.5 text-[11px] font-semibold text-accent-gold">Carry-over</span>
                )}
                <span className="text-text-muted/30">|</span>
                <select
                  key={item.id}
                  defaultValue={item.assignedTo ?? ""}
                  onChange={async (e) => {
                    const val = e.target.value;
                    await fetch("/api/work-items", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id: item.id, fields: { assignedTo: val || null } }),
                    });
                    onPbiAssigneeSaved(val || null);
                  }}
                  className="appearance-none bg-transparent px-0 py-0 text-xs text-text-muted cursor-pointer border-none outline-none hover:text-text-primary"
                >
                  <option value="">Unassigned</option>
                  {availableAssignees.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {item.tags && item.tags.split(";").filter(t => t.trim()).map((tag) => (
                  <span key={tag.trim()} className="rounded bg-bg-secondary px-1.5 py-0.5 text-[11px] text-text-muted/60">{tag.trim()}</span>
                ))}
              </div>
              {/* Title — largest element */}
              <h1 className="mt-2 text-3xl font-bold leading-tight text-text-primary">{item.title}</h1>
            </div>

            {/* Two-column content: Description/AC left, Tasks/Capacity right */}
            <div className="flex gap-8">
              {/* Left — Description + AC (primary focus) */}
              <div className="min-w-0 flex-[3] space-y-4">
                {details?.description ? (
                  <div className="rounded-xl border border-border-default bg-bg-card px-6 py-5">
                    <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-text-muted/70">
                      {item.type === "Bug" ? "Repro Steps / Description" : "Description"}
                    </h4>
                    <RichHtmlContent html={details.description} className="prose-devops text-base text-text-primary leading-relaxed" />
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border-default/40 bg-bg-card/50 px-6 py-5 text-center text-sm text-text-muted/50">
                    No description
                  </div>
                )}
                {details?.acceptanceCriteria && (
                  <div className="rounded-xl border border-border-default bg-bg-card px-6 py-5">
                    <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-text-muted/70">Acceptance Criteria</h4>
                    <RichHtmlContent html={details.acceptanceCriteria} className="prose-devops text-base text-text-primary leading-relaxed" />
                  </div>
                )}

                {/* AI Summary */}
                {aiSummary ? (
                  <div className="rounded-xl border border-accent-blue/20 bg-accent-blue/[0.04] px-6 py-5">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-[11px] font-semibold uppercase tracking-widest text-accent-blue/70">AI Code Summary</h4>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={async () => {
                            // Append summary as HTML to description in Azure DevOps
                            const html = `<hr/><p><strong>AI Code Summary</strong> <em>(${new Date().toLocaleDateString("en-DK")})</em></p><ul>${aiSummary.summary.map((s) => `<li>${s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code>$1</code>")}</li>`).join("")}</ul>${aiSummary.relevantFiles.length > 0 ? `<p><em>Files: ${aiSummary.relevantFiles.slice(0, 5).map((f) => f.path.split("/").slice(-2).join("/")).join(", ")}</em></p>` : ""}`;
                            const currentDesc = details?.description ?? "";
                            const newDesc = currentDesc + html;
                            try {
                              const res = await fetch("/api/work-items", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: item.id, fields: { description: newDesc }, workItemType: item.type }),
                              });
                              if (res.ok) {
                                // Refresh details to show updated description
                                const detRes = await fetch(`/api/work-items?action=details&id=${item.id}`);
                                if (detRes.ok) {
                                  const newDetails = await detRes.json();
                                  if (!newDetails.error && details) {
                                    Object.assign(details, newDetails);
                                  }
                                }
                              }
                            } catch { /* ignore */ }
                          }}
                          className="text-[10px] text-accent-blue/60 hover:text-accent-blue transition-colors"
                          title="Append AI summary to the description in Azure DevOps"
                        >
                          Add to Description
                        </button>
                        <button
                          onClick={() => { aiSummaryCacheRef.current.delete(item.id); setAiSummary(null); handleGenerateAISummary(); }}
                          className="text-[10px] text-text-muted hover:text-text-primary"
                        >
                          Regenerate
                        </button>
                      </div>
                    </div>
                    <ul className="space-y-1.5 text-sm text-text-primary leading-relaxed">
                      {aiSummary.summary.map((line, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="shrink-0 mt-1.5 h-1.5 w-1.5 rounded-full bg-accent-blue/50" />
                          <span dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`(.+?)`/g, "<code class='rounded bg-bg-secondary px-1 py-0.5 text-xs font-mono text-accent-blue'>$1</code>") }} />
                        </li>
                      ))}
                    </ul>
                    {aiSummary.relevantFiles.length > 0 && (
                      <details className="mt-3">
                        <summary className="text-[11px] text-text-muted cursor-pointer hover:text-text-secondary">
                          {aiSummary.relevantFiles.length} relevant files
                        </summary>
                        <div className="mt-2 space-y-1">
                          {aiSummary.relevantFiles.slice(0, 5).map((f) => (
                            <div key={f.path} className="text-xs font-mono text-text-muted truncate" title={f.path}>
                              {f.path}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-accent-blue/20 bg-accent-blue/[0.02] px-6 py-4 text-center">
                    <button
                      onClick={handleGenerateAISummary}
                      disabled={aiSummaryLoading}
                      className="text-sm text-accent-blue/70 hover:text-accent-blue disabled:opacity-50"
                    >
                      {aiSummaryLoading ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="h-3.5 w-3.5 animate-spin rounded-full border border-accent-blue border-t-transparent" />
                          Analyzing codebase...
                        </span>
                      ) : (
                        "Generate AI Code Summary"
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Right — Tasks + Create + Capacity */}
              <div className="flex-[2] min-w-[380px] space-y-3">
                {/* Tasks — interactive with state, hours, delete */}
                <div className="rounded-xl border border-border-default bg-bg-card">
                  <div className="flex items-center gap-2 border-b border-border-default/50 px-4 py-2.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">Tasks</h4>
                    <span className="rounded-full bg-bg-secondary px-2 py-0.5 text-[11px] font-semibold tabular-nums text-text-secondary">{item.children.length}</span>
                    {totalHours > 0 && (
                      <span className="rounded-full bg-accent-gold/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-accent-gold">{totalHours}h</span>
                    )}
                  </div>
                  {item.children.length > 0 ? (
                    <div>
                      {item.children.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          availableStates={availableStates}
                          availableAssignees={availableAssignees}
                          onStateChange={onStateChange}
                          onDelete={onDeleteTask}
                          onAssigneeChange={onTaskAssigneeChange}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="py-4 text-center text-xs text-text-muted/50">No tasks</div>
                  )}
                </div>

                {/* Create Task */}
                <div className="rounded-xl border border-dashed border-border-default bg-bg-card/50 p-3">
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-text-muted">Create Task</h4>
                  <QuickCreateForm
                    parentId={item.id}
                    pbiTitle={item.title}
                    pbiAssignedTo={item.assignedTo}
                    availableAssignees={availableAssignees}
                    iterations={iterations}
                    onCreated={onChildCreated}
                    capacityData={capacityData}
                  />
                </div>

                {/* Capacity */}
                <MeetingCapacitySummary data={capacityData} item={item} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className={clsx(
        "border-t px-5 py-2.5",
        isCarryOverItem ? "border-accent-gold/20 bg-accent-gold/10" : "border-accent-teal/20 bg-accent-teal/10"
      )}>
        <div className="flex items-center gap-4">
          <span className="text-xs font-medium uppercase tracking-wider text-text-muted">Move to</span>
          <select
            value={doneSprint}
            onChange={(e) => onSprintChange(e.target.value)}
            disabled={donePlanningLoading}
            className="rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-border-focus disabled:opacity-50"
          >
            {getRelevantSprints(iterations).map((s) => {
              const isCurrent = s.path === getCurrentSprintPath(iterations);
              const isNext = s.path === getNextSprintPath(iterations);
              const prefix = isCurrent ? ">> " : isNext ? "* " : "";
              return (
                <option key={s.id} value={s.path}>
                  {prefix}{s.name}{isCurrent ? " (current)" : isNext ? " (next)" : ""}
                </option>
              );
            })}
          </select>
          <button
            onClick={onDonePlanning}
            disabled={donePlanningLoading || !doneSprint}
            className={clsx(
              "rounded-lg px-6 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50",
              isCarryOverItem ? "bg-accent-gold hover:bg-accent-gold/80" : "bg-accent-teal hover:bg-accent-teal/80"
            )}
          >
            {donePlanningLoading ? "Moving..." : isCarryOverItem ? "Carry over" : "Done planning"}
          </button>
          <span className="text-xs text-text-muted/60">
            <kbd className="rounded bg-bg-card/50 px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
