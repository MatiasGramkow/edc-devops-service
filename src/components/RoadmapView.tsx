"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import clsx from "clsx";
import { WorkItemTypeIcon } from "./WorkItemTypeIcon";
import { ConfirmDialog } from "./ConfirmDialog";
import type {
  RoadmapItem,
  RoadmapStep,
  RoadmapStepStatus,
  RoadmapEffort,
  RoadmapPlanType,
} from "@/types/devops";

// --- Constants & Helpers ---

const EFFORT_CONFIG: Record<RoadmapEffort, { label: string; color: string; bg: string }> = {
  S:  { label: "S",  color: "text-accent-teal", bg: "bg-accent-teal/15" },
  M:  { label: "M",  color: "text-accent-blue",  bg: "bg-accent-blue/15" },
  L:  { label: "L",  color: "text-accent-gold",  bg: "bg-accent-gold/15" },
  XL: { label: "XL", color: "text-accent-red",   bg: "bg-accent-red/15" },
};

const PHASE_COLORS = [
  { bg: "bg-accent-blue",  light: "bg-accent-blue/15",  text: "text-accent-blue",  border: "border-accent-blue/30" },
  { bg: "bg-accent-teal",  light: "bg-accent-teal/15",  text: "text-accent-teal",  border: "border-accent-teal/30" },
  { bg: "bg-accent-gold",  light: "bg-accent-gold/15",  text: "text-accent-gold",  border: "border-accent-gold/30" },
  { bg: "bg-type-feature",  light: "bg-type-feature/15", text: "text-type-feature", border: "border-type-feature/30" },
  { bg: "bg-stale-stale",  light: "bg-stale-stale/15",  text: "text-stale-stale",  border: "border-stale-stale/30" },
];

const STATE_COLORS: Record<string, string> = {
  New: "text-text-muted", Active: "text-accent-blue", Resolved: "text-accent-gold",
  Closed: "text-accent-teal", Done: "text-accent-teal", Removed: "text-stale-ancient",
};

function generateId(): string {
  return `rm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCurrentYear(): string {
  return `${new Date().getFullYear()}`;
}

function getYearOptions(): string[] {
  const year = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, i) => `${year + i}`);
}

function getProgress(steps: RoadmapStep[]): { done: number; inProgress: number; total: number; pct: number } {
  if (steps.length === 0) return { done: 0, inProgress: 0, total: 0, pct: 0 };
  const done = steps.filter((s) => s.status === "done").length;
  const inProgress = steps.filter((s) => s.status === "in-progress").length;
  return { done, inProgress, total: steps.length, pct: Math.round((done / steps.length) * 100) };
}

function getDerivedStatus(steps: RoadmapStep[]): "planned" | "in-progress" | "done" {
  if (steps.length === 0) return "planned";
  if (steps.every((s) => s.status === "done")) return "done";
  if (steps.some((s) => s.status !== "todo")) return "in-progress";
  return "planned";
}

interface PhaseInfo {
  name: string;
  steps: RoadmapStep[];
  colorIdx: number;
  progress: ReturnType<typeof getProgress>;
}

function getPhases(steps: RoadmapStep[]): PhaseInfo[] {
  const sorted = [...steps].sort((a, b) => a.sortOrder - b.sortOrder);
  const phaseMap = new Map<string, RoadmapStep[]>();
  const phaseOrder: string[] = [];
  for (const step of sorted) {
    const phase = step.phase || "Other";
    if (!phaseMap.has(phase)) {
      phaseMap.set(phase, []);
      phaseOrder.push(phase);
    }
    phaseMap.get(phase)!.push(step);
  }
  return phaseOrder.map((name, i) => {
    const phaseSteps = phaseMap.get(name)!;
    return { name, steps: phaseSteps, colorIdx: i % PHASE_COLORS.length, progress: getProgress(phaseSteps) };
  });
}

// --- Phase Timeline Bar (visual overview at top of card) ---

function PhaseTimelineBar({ phases }: { phases: PhaseInfo[] }) {
  const totalSteps = phases.reduce((s, p) => s + p.steps.length, 0);
  if (totalSteps === 0) return null;

  return (
    <div className="flex gap-0.5 overflow-hidden rounded-full h-2.5">
      {phases.map((phase) => {
        const widthPct = (phase.steps.length / totalSteps) * 100;
        const colors = PHASE_COLORS[phase.colorIdx];
        const donePct = phase.progress.pct;
        return (
          <div
            key={phase.name}
            className={clsx("relative overflow-hidden", colors.light)}
            style={{ width: `${widthPct}%` }}
            title={`${phase.name}: ${phase.progress.done}/${phase.progress.total}`}
          >
            <div
              className={clsx("absolute inset-y-0 left-0 transition-all duration-500", colors.bg)}
              style={{ width: `${donePct}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

// --- Phase Section (expanded view) ---

function PhaseSection({ phase, onStepStatusChange }: {
  phase: PhaseInfo;
  onStepStatusChange: (stepId: string, status: RoadmapStepStatus) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const colors = PHASE_COLORS[phase.colorIdx];
  const allDone = phase.steps.every((s) => s.status === "done");

  return (
    <div className={clsx("rounded-lg border", colors.border, allDone && "opacity-60")}>
      {/* Phase header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-3 px-4 py-2.5"
      >
        <div className={clsx("h-2.5 w-2.5 rounded-full shrink-0", colors.bg)} />
        <span className={clsx("text-xs font-bold uppercase tracking-wider flex-1 text-left", colors.text)}>
          {phase.name}
        </span>
        <span className="text-[10px] font-mono text-text-muted">
          {phase.progress.done}/{phase.progress.total}
        </span>
        <div className="h-1 w-16 overflow-hidden rounded-full bg-bg-secondary">
          <div className={clsx("h-full rounded-full transition-all", colors.bg)} style={{ width: `${phase.progress.pct}%` }} />
        </div>
        <svg className={clsx("h-3 w-3 text-text-muted transition-transform", collapsed && "-rotate-90")} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Steps */}
      {!collapsed && (
        <div className="border-t border-border-default/50 px-4 py-2 space-y-0.5">
          {phase.steps.map((step) => {
            const isDone = step.status === "done";
            const isActive = step.status === "in-progress";
            const nextStatus: RoadmapStepStatus =
              step.status === "todo" ? "in-progress" : step.status === "in-progress" ? "done" : "todo";
            const effort = step.effort ? EFFORT_CONFIG[step.effort] : null;

            return (
              <div key={step.id} className="flex items-center gap-2.5 py-1.5 group">
                {/* Status toggle */}
                <button
                  onClick={() => onStepStatusChange(step.id, nextStatus)}
                  className={clsx(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                    isDone && "border-accent-teal bg-accent-teal",
                    isActive && "border-accent-blue bg-accent-blue",
                    !isDone && !isActive && "border-text-muted/30 bg-transparent hover:border-text-muted/60"
                  )}
                  title={`Set: ${nextStatus}`}
                >
                  {isDone && (
                    <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                  {isActive && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </button>

                {/* Title */}
                <span className={clsx(
                  "flex-1 text-sm min-w-0",
                  isDone && "text-text-muted line-through",
                  isActive && "text-text-primary font-medium",
                  !isDone && !isActive && "text-text-secondary"
                )}>
                  {step.title}
                </span>

                {/* Linked WI */}
                {step.linkedWorkItemId && (
                  <a
                    href={`https://dev.azure.com/edc-group/Relaunch%20-%20Charlie%20Tango/_workitems/edit/${step.linkedWorkItemId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hidden group-hover:inline-flex items-center gap-1 rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] hover:bg-bg-card-hover"
                  >
                    {step.linkedWorkItemType && <WorkItemTypeIcon type={step.linkedWorkItemType} />}
                    <span className="font-mono text-text-muted">#{step.linkedWorkItemId}</span>
                  </a>
                )}

                {/* Effort badge */}
                {effort && (
                  <span className={clsx("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold", effort.bg, effort.color)}>
                    {effort.label}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Step Editor ---

interface StepEditorProps {
  steps: RoadmapStep[];
  onChange: (steps: RoadmapStep[]) => void;
}

function StepEditor({ steps, onChange }: StepEditorProps) {
  const [newTitle, setNewTitle] = useState("");
  const [newPhase, setNewPhase] = useState("");
  const [newEffort, setNewEffort] = useState<RoadmapEffort>("M");
  const [newLinkId, setNewLinkId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const existingPhases = useMemo(() => {
    const set = new Set<string>();
    for (const s of steps) if (s.phase) set.add(s.phase);
    return [...set];
  }, [steps]);

  const addStep = () => {
    const title = newTitle.trim();
    if (!title) return;
    const linkId = parseInt(newLinkId.trim(), 10);
    const step: RoadmapStep = {
      id: generateId(),
      title,
      status: "todo",
      sortOrder: steps.length,
      phase: newPhase.trim() || undefined,
      effort: newEffort,
      ...(linkId > 0 ? { linkedWorkItemId: linkId } : {}),
    };
    onChange([...steps, step]);
    setNewTitle("");
    setNewLinkId("");
    inputRef.current?.focus();
  };

  const removeStep = (id: string) => onChange(steps.filter((s) => s.id !== id));

  const moveStep = (idx: number, dir: -1 | 1) => {
    const next = [...steps];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    next.forEach((s, i) => (s.sortOrder = i));
    onChange(next);
  };

  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-text-muted">Steps / Milestones</label>

      {steps.length > 0 && (
        <div className="mb-3 space-y-1 max-h-64 overflow-y-auto pr-1">
          {steps.map((step, idx) => {
            const effort = step.effort ? EFFORT_CONFIG[step.effort] : null;
            return (
              <div key={step.id} className="flex items-center gap-2 rounded-lg bg-bg-secondary px-3 py-1.5 text-sm">
                {step.phase && <span className="shrink-0 rounded bg-bg-card px-1.5 py-0.5 text-[10px] text-text-muted">{step.phase}</span>}
                <span className="flex-1 text-text-primary truncate">{step.title}</span>
                {effort && <span className={clsx("shrink-0 rounded px-1 py-0.5 text-[10px] font-bold", effort.bg, effort.color)}>{effort.label}</span>}
                {step.linkedWorkItemId && <span className="text-[10px] font-mono text-text-muted">#{step.linkedWorkItemId}</span>}
                <button onClick={() => moveStep(idx, -1)} disabled={idx === 0} className="text-text-muted hover:text-text-secondary disabled:opacity-20" title="Up">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" /></svg>
                </button>
                <button onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1} className="text-text-muted hover:text-text-secondary disabled:opacity-20" title="Down">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                </button>
                <button onClick={() => removeStep(step.id)} className="text-text-muted hover:text-stale-ancient" title="Remove">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <input ref={inputRef} value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Step title" className="flex-1 min-w-[200px] rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addStep(); } }} />
        <input value={newPhase} onChange={(e) => setNewPhase(e.target.value)} list="phases-list"
          placeholder="Phase" className="w-32 rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none" />
        <datalist id="phases-list">{existingPhases.map((p) => <option key={p} value={p} />)}</datalist>
        <select value={newEffort} onChange={(e) => setNewEffort(e.target.value as RoadmapEffort)}
          className="w-16 rounded-lg border border-border-default bg-bg-input px-2 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none">
          {(["S","M","L","XL"] as RoadmapEffort[]).map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <input value={newLinkId} onChange={(e) => setNewLinkId(e.target.value)} placeholder="WI #" title="Optional: Azure DevOps work item ID"
          className="w-16 rounded-lg border border-border-default bg-bg-input px-2 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addStep(); } }} />
        <button type="button" onClick={addStep} disabled={!newTitle.trim()}
          className="rounded-lg bg-accent-blue/20 px-3 py-2 text-sm font-medium text-accent-blue hover:bg-accent-blue/30 disabled:opacity-40">
          Add
        </button>
      </div>
    </div>
  );
}

// --- Initiative Form ---

function InitiativeForm({ initial, planType, onSave, onCancel, saving }: {
  initial?: RoadmapItem; planType: RoadmapPlanType; onSave: (item: RoadmapItem) => void; onCancel: () => void; saving: boolean;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [quarter, setQuarter] = useState(initial?.quarter ?? getCurrentYear());
  const [estimate, setEstimate] = useState(initial?.estimate ?? "");
  const [steps, setSteps] = useState<RoadmapStep[]>(initial?.steps ?? []);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);

  const handleSubmit = () => {
    if (!title.trim()) return;
    const now = new Date().toISOString();
    onSave({
      id: initial?.id ?? generateId(), title: title.trim(), description: description.trim(),
      planType, quarter, sortOrder: initial?.sortOrder ?? Date.now(), steps,
      estimate: estimate.trim() || undefined,
      createdDate: initial?.createdDate ?? now, lastModified: now,
    });
  };

  return (
    <div className="space-y-4 rounded-xl border border-border-default bg-bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">Initiative Title</label>
          <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Umbraco upgrade 13 → 17"
            className="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">Year</label>
          <select value={quarter} onChange={(e) => setQuarter(e.target.value)}
            className="w-28 rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none">
            {getYearOptions().map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-muted">Estimate</label>
          <input value={estimate} onChange={(e) => setEstimate(e.target.value)}
            placeholder="e.g. 2-4 uger"
            className="w-32 rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none" />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-muted">Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this initiative involve?" rows={2}
          className="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none resize-none" />
      </div>
      <StepEditor steps={steps} onChange={setSteps} />
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="rounded-lg border border-border-default px-4 py-2 text-sm text-text-secondary hover:bg-bg-card-hover">Cancel</button>
        <button onClick={handleSubmit} disabled={!title.trim() || saving}
          className="rounded-lg bg-accent-teal px-4 py-2 text-sm font-medium text-white hover:bg-accent-teal/80 disabled:opacity-50">
          {saving ? "Saving..." : initial ? "Update" : "Add Initiative"}
        </button>
      </div>
    </div>
  );
}

// --- Initiative Card ---

function InitiativeCard({ item, onEdit, onDelete, onStepStatusChange, expanded, onToggleExpand }: {
  item: RoadmapItem; onEdit: () => void; onDelete: () => void;
  onStepStatusChange: (itemId: string, stepId: string, status: RoadmapStepStatus) => void;
  expanded: boolean; onToggleExpand: () => void;
}) {
  const phases = useMemo(() => getPhases(item.steps), [item.steps]);
  const progress = getProgress(item.steps);
  const status = getDerivedStatus(item.steps);

  const statusLabel = status === "done" ? "Done" : status === "in-progress" ? "In Progress" : "Planned";
  const statusColor = status === "done" ? "bg-accent-teal/20 text-accent-teal"
    : status === "in-progress" ? "bg-accent-blue/20 text-accent-blue" : "bg-text-muted/20 text-text-muted";

  // Effort summary
  const effortCounts = { S: 0, M: 0, L: 0, XL: 0 };
  for (const step of item.steps) {
    if (step.effort && step.status !== "done") effortCounts[step.effort]++;
  }

  return (
    <div className={clsx(
      "rounded-xl border transition-colors",
      status === "done" ? "border-accent-teal/30" : "border-border-default",
      "bg-bg-card",
      expanded && "ring-1 ring-border-focus/20"
    )}>
      {/* Header */}
      <div className="cursor-pointer p-4" onClick={onToggleExpand}>
        <div className="flex items-start gap-3 mb-3">
          <svg className={clsx("mt-1 h-4 w-4 shrink-0 text-text-muted transition-transform", expanded && "rotate-90")}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-base font-semibold text-text-primary">{item.title}</h4>
              <span className={clsx("rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", statusColor)}>{statusLabel}</span>
              <span className="text-xs font-mono text-text-muted">{progress.done}/{progress.total} steps</span>
              {item.estimate && (
                <span className="rounded-md bg-bg-secondary px-2 py-0.5 text-[10px] font-medium text-text-muted">
                  {item.estimate}
                </span>
              )}
            </div>
            {item.description && <p className="mt-1 text-xs text-text-secondary">{item.description}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button onClick={onEdit} className="rounded p-1.5 text-text-muted hover:bg-bg-card-hover hover:text-text-secondary" title="Edit">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" /></svg>
            </button>
            <button onClick={onDelete} className="rounded p-1.5 text-text-muted hover:bg-stale-ancient/10 hover:text-stale-ancient" title="Delete">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
            </button>
          </div>
        </div>

        {/* Phase timeline bar */}
        <PhaseTimelineBar phases={phases} />

        {/* Phase legend + effort summary */}
        <div className="mt-2.5 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            {phases.map((phase) => {
              const colors = PHASE_COLORS[phase.colorIdx];
              return (
                <span key={phase.name} className="flex items-center gap-1.5">
                  <span className={clsx("h-2 w-2 rounded-full", colors.bg)} />
                  <span className="text-[10px] text-text-muted">{phase.name}</span>
                  <span className={clsx("text-[10px] font-mono", phase.progress.pct === 100 ? "text-accent-teal" : "text-text-muted")}>
                    {phase.progress.done}/{phase.progress.total}
                  </span>
                </span>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[10px] text-text-muted mr-1">Remaining:</span>
            {(["S","M","L","XL"] as RoadmapEffort[]).map((e) => effortCounts[e] > 0 ? (
              <span key={e} className={clsx("rounded px-1 py-0.5 text-[10px] font-bold", EFFORT_CONFIG[e].bg, EFFORT_CONFIG[e].color)}>
                {effortCounts[e]}{e}
              </span>
            ) : null)}
          </div>
        </div>
      </div>

      {/* Expanded: phase sections */}
      {expanded && phases.length > 0 && (
        <div className="border-t border-border-default p-4 space-y-2">
          {phases.map((phase) => (
            <PhaseSection
              key={phase.name}
              phase={phase}
              onStepStatusChange={(stepId, status) => onStepStatusChange(item.id, stepId, status)}
            />
          ))}
        </div>
      )}

      {expanded && item.steps.length === 0 && (
        <div className="border-t border-border-default px-4 py-6 text-center text-xs text-text-muted">
          No steps defined. Edit to add steps.
        </div>
      )}
    </div>
  );
}

// --- Main View ---

export function RoadmapView() {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [activePlan, setActivePlan] = useState<RoadmapPlanType>("technical");
  const [editingItem, setEditingItem] = useState<RoadmapItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoadmapItem | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const resolveLinks = useCallback(async (loadedItems: RoadmapItem[]) => {
    const allIds = new Set<number>();
    for (const item of loadedItems) for (const step of item.steps) if (step.linkedWorkItemId) allIds.add(step.linkedWorkItemId);
    if (allIds.size === 0) return;
    try {
      const res = await fetch(`/api/roadmap?action=resolve-links&ids=${[...allIds].join(",")}`);
      const data = await res.json();
      if (!res.ok || !data.summaries) return;
      const map = new Map<number, { title: string; state: string; type: string }>();
      for (const s of data.summaries) map.set(s.id, s);
      setItems((prev) => prev.map((item) => ({
        ...item,
        steps: item.steps.map((step) => {
          if (!step.linkedWorkItemId) return step;
          const live = map.get(step.linkedWorkItemId);
          return live ? { ...step, linkedWorkItemTitle: live.title, linkedWorkItemState: live.state, linkedWorkItemType: live.type } : step;
        }),
      })));
    } catch {}
  }, []);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/roadmap?action=items");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const loaded = data.items ?? [];
      setItems(loaded);
      resolveLinks(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load roadmap");
    } finally {
      setLoading(false);
    }
  }, [resolveLinks]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const saveItem = useCallback(async (item: RoadmapItem) => {
    setSaving(true);
    try {
      const res = await fetch("/api/roadmap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setItems(data.items ?? []);
      setShowForm(false);
      setEditingItem(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const res = await fetch("/api/roadmap", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: deleteTarget.id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setItems(data.items ?? []);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setSaving(false);
    }
  }, [deleteTarget]);

  const handleStepStatusChange = useCallback((itemId: string, stepId: string, newStatus: RoadmapStepStatus) => {
    setItems((prev) => {
      const updated = prev.map((item) => item.id !== itemId ? item : {
        ...item, lastModified: new Date().toISOString(),
        steps: item.steps.map((s) => s.id === stepId ? { ...s, status: newStatus } : s),
      });
      const changedItem = updated.find((i) => i.id === itemId);
      if (changedItem) fetch("/api/roadmap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changedItem) }).catch(() => {});
      return updated;
    });
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const planItems = items.filter((i) => i.planType === activePlan);

  // Group by quarter
  const quarters = getYearOptions();
  const itemsByQuarter = new Map<string, RoadmapItem[]>();
  for (const q of quarters) itemsByQuarter.set(q, []);
  for (const item of planItems) {
    const list = itemsByQuarter.get(item.quarter);
    if (list) list.push(item); else itemsByQuarter.set(item.quarter, [item]);
  }
  for (const [, list] of itemsByQuarter) list.sort((a, b) => a.sortOrder - b.sortOrder);
  const currentQ = getCurrentYear();
  const visibleQuarters = [...itemsByQuarter.entries()].filter(([q, list]) => list.length > 0 || q === currentQ);

  // Summary
  const totalSteps = planItems.reduce((s, i) => s + i.steps.length, 0);
  const doneSteps = planItems.reduce((s, i) => s + i.steps.filter((st) => st.status === "done").length, 0);
  const inProgressSteps = planItems.reduce((s, i) => s + i.steps.filter((st) => st.status === "in-progress").length, 0);
  const overallPct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-text-primary">Roadmap</h2>
          <p className="text-sm text-text-muted">Plan and track initiatives for edc.dk</p>
        </div>
        <button onClick={() => { setShowForm(true); setEditingItem(null); }}
          className="rounded-lg bg-accent-teal px-4 py-2 text-sm font-medium text-white hover:bg-accent-teal/80">
          + Add Initiative
        </button>
      </div>

      {/* Plan type toggle */}
      <div className="flex gap-1 rounded-xl bg-bg-secondary p-1 w-fit">
        {(["technical", "commercial"] as RoadmapPlanType[]).map((plan) => (
          <button key={plan} onClick={() => setActivePlan(plan)}
            className={clsx("rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              activePlan === plan ? "bg-bg-card text-text-primary shadow-sm" : "text-text-muted hover:text-text-secondary")}>
            {plan === "technical" ? "Technical Plan" : "Commercial Plan"}
          </button>
        ))}
      </div>

      {/* Overall progress bar */}
      {totalSteps > 0 && (
        <div className="rounded-xl border border-border-default bg-bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-text-primary">Overall Progress</span>
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <span><span className="font-mono font-bold text-accent-teal">{doneSteps}</span> done</span>
              <span><span className="font-mono font-bold text-accent-blue">{inProgressSteps}</span> active</span>
              <span><span className="font-mono font-bold text-text-secondary">{totalSteps - doneSteps - inProgressSteps}</span> todo</span>
              <span className="font-mono font-bold text-text-primary">{overallPct}%</span>
            </div>
          </div>
          <div className="flex h-3 overflow-hidden rounded-full bg-bg-secondary">
            <div className="bg-accent-teal transition-all duration-500" style={{ width: `${overallPct}%` }} />
            <div className="bg-accent-blue transition-all duration-500" style={{ width: `${totalSteps > 0 ? Math.round((inProgressSteps / totalSteps) * 100) : 0}%` }} />
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-stale-ancient/30 bg-stale-ancient/10 px-5 py-3 text-sm text-stale-ancient">
          {error} <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {(showForm || editingItem) && (
        <InitiativeForm initial={editingItem ?? undefined} planType={activePlan} onSave={saveItem}
          onCancel={() => { setShowForm(false); setEditingItem(null); }} saving={saving} />
      )}

      {/* Initiatives by quarter */}
      {planItems.length > 0 ? (
        <div className="space-y-8">
          {visibleQuarters.map(([quarter, quarterItems]) => (
            <div key={quarter}>
              <div className="mb-3 flex items-center gap-3">
                <h3 className={clsx("text-sm font-bold uppercase tracking-wider", quarter === currentQ ? "text-accent-blue" : "text-text-muted")}>{quarter}</h3>
                {quarter === currentQ && <span className="rounded-md bg-accent-blue/15 px-2 py-0.5 text-[10px] font-semibold text-accent-blue">Current</span>}
                <div className="h-px flex-1 bg-border-default" />
              </div>
              {quarterItems.length === 0 ? (
                <p className="py-4 text-center text-xs text-text-muted">No initiatives planned</p>
              ) : (
                <div className="space-y-3">
                  {quarterItems.map((item) => (
                    <InitiativeCard key={item.id} item={item} expanded={expandedIds.has(item.id)}
                      onToggleExpand={() => toggleExpand(item.id)}
                      onEdit={() => { setEditingItem(item); setShowForm(false); }}
                      onDelete={() => setDeleteTarget(item)}
                      onStepStatusChange={handleStepStatusChange} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : !showForm && (
        <div className="rounded-xl border border-border-default bg-bg-card p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent-blue/10">
            <svg className="h-8 w-8 text-accent-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-text-primary">{activePlan === "technical" ? "Technical Roadmap" : "Commercial Plan"}</h3>
          <p className="mb-4 text-sm text-text-muted">Plan initiatives with phased milestones and effort estimates.</p>
          <button onClick={() => { setShowForm(true); setEditingItem(null); }}
            className="rounded-lg bg-accent-teal px-4 py-2 text-sm font-medium text-white hover:bg-accent-teal/80">
            + Add First Initiative
          </button>
        </div>
      )}

      <ConfirmDialog open={!!deleteTarget} title="Delete Initiative"
        description={`Are you sure you want to delete "${deleteTarget?.title}"?`}
        confirmLabel="Delete" onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} loading={saving} />
    </div>
  );
}
