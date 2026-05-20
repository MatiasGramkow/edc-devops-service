"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import clsx from "clsx";
import type { WorkItemDetails, WorkItemComment, Iteration, WorkItem } from "@/types/devops";
import { formatDate } from "@/lib/utils";
import { StateSelector } from "./StateSelector";
import { RichHtmlContent } from "./RichHtmlContent";

interface PbiDetailPanelProps {
  workItemId: number;
  childItems: WorkItem[];
  availableStates: string[];
  availableAssignees: string[];
  iterations: Iteration[];
  onClose: () => void;
  onChildCreated: (child: WorkItem) => void;
  onFieldsUpdated: (id: number, fields: { iterationPath?: string; assignedTo?: string | null; description?: string }) => void;
  onStateChange: (id: number, newState: string) => Promise<void>;
  onChildrenSprintChanged: (childIds: number[], iterationPath: string) => void;
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

function CommentItem({ comment }: { comment: WorkItemComment }) {
  return (
    <div className="border-b border-border-default/50 px-4 py-3 last:border-b-0">
      <div className="mb-1 flex items-center gap-2 text-xs text-text-muted">
        <span className="font-medium text-text-secondary">{comment.createdBy}</span>
        <span>{formatDate(comment.createdDate)}</span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-text-primary">{sanitizeHtml(comment.text)}</p>
    </div>
  );
}

function AddCommentForm({ workItemId, onAdded }: { workItemId: number; onAdded: (comment: WorkItemComment) => void }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: workItemId, comment: text.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not add comment");
        return;
      }
      onAdded(data);
      setText("");
    } catch {
      setError("Connection error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment..."
        rows={2}
        disabled={saving}
        className="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 outline-none focus:border-border-focus disabled:opacity-50 resize-y"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving || !text.trim()}
          className="rounded-lg bg-accent-blue px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-80 disabled:opacity-50"
        >
          {saving ? "Posting..." : "Post comment"}
        </button>
        {error && <span className="text-xs text-stale-ancient">{error}</span>}
      </div>
    </form>
  );
}

function EditableDescription({
  workItemId,
  workItemType,
  initialValue,
  onSaved,
}: {
  workItemId: number;
  workItemType?: string;
  initialValue: string;
  onSaved: (newDesc: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: workItemId, fields: { description: value }, workItemType }),
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
      <div className="group/desc">
        <div className="mb-1.5 flex items-center gap-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">Description</h4>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-text-muted opacity-0 transition-opacity hover:text-accent-blue group-hover/desc:opacity-100"
          >
            Edit
          </button>
        </div>
        {initialValue ? (
          <RichHtmlContent html={initialValue} className="prose-devops text-sm text-text-secondary" />
        ) : (
          <p className="text-xs italic text-text-muted/60">No description</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-text-muted">Description</h4>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={6}
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
          onClick={() => { setValue(initialValue); setEditing(false); }}
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

function SprintSelector({
  iterations,
  currentPath,
  onSelect,
  saving,
}: {
  iterations: Iteration[];
  currentPath: string;
  onSelect: (path: string) => void;
  saving: boolean;
}) {
  const now = new Date();
  const relevantSprints = iterations
    .filter((i) => {
      if (!i.finishDate) return true;
      return new Date(i.finishDate) >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    })
    .sort((a, b) => {
      if (!a.startDate) return -1;
      if (!b.startDate) return 1;
      return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    });

  const currentSprint = iterations.find((i) => {
    if (!i.startDate || !i.finishDate) return false;
    return new Date(i.startDate) <= now && new Date(i.finishDate) >= now;
  });

  return (
    <select
      value={currentPath}
      onChange={(e) => onSelect(e.target.value)}
      disabled={saving}
      className="w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-border-focus disabled:opacity-50"
    >
      <option value="">Backlog (no sprint)</option>
      {relevantSprints.map((s) => {
        const isCurrent = s.id === currentSprint?.id;
        const start = s.startDate ? new Date(s.startDate).toLocaleDateString("da-DK", { day: "numeric", month: "short" }) : "";
        const end = s.finishDate ? new Date(s.finishDate).toLocaleDateString("da-DK", { day: "numeric", month: "short" }) : "";
        const range = start && end ? ` (${start} – ${end})` : "";
        return (
          <option key={s.id} value={s.path}>
            {isCurrent ? ">> " : ""}{s.name}{range}
          </option>
        );
      })}
    </select>
  );
}

const TASK_PRESETS = [
  { key: "dev", label: "Development", activity: "Development", tag: "Development", color: "bg-accent-blue text-white" },
  { key: "qa", label: "QA", activity: "QA", tag: "QA", color: "bg-accent-gold text-white" },
  { key: "release", label: "Release", activity: "Release", tag: "Release", color: "bg-stale-fresh text-white" },
  { key: "other", label: "Other", activity: "Development", tag: "", color: "bg-text-muted/20 text-text-primary border border-border-default" },
] as const;

function getCurrentSprintPath(iterations: Iteration[]): string {
  const now = new Date();
  const current = iterations.find((i) => {
    if (!i.startDate || !i.finishDate) return false;
    return new Date(i.startDate) <= now && new Date(i.finishDate) >= now;
  });
  return current?.path ?? "";
}

function AssigneeInput({
  value,
  onChange,
  suggestions,
  disabled,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  disabled: boolean;
  onBlur?: () => void;
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
        onBlur={() => { setTimeout(() => onBlur?.(), 150); }}
        placeholder="Assigned to"
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

function CreateTaskForm({
  parentId,
  pbiTitle,
  pbiAssignedTo,
  availableAssignees,
  iterations,
  onCreated,
}: {
  parentId: number;
  pbiTitle: string;
  pbiAssignedTo: string | null;
  availableAssignees: string[];
  iterations: Iteration[];
  onCreated: (task: WorkItem) => void;
}) {
  const [hours, setHours] = useState("");
  const [assignee, setAssignee] = useState(pbiAssignedTo ?? "");
  const [iterationPath, setIterationPath] = useState(() => getCurrentSprintPath(iterations));
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function handleCreate(preset: typeof TASK_PRESETS[number]) {
    const title = preset.key === "other"
      ? `${pbiTitle}`
      : `${preset.label}: ${pbiTitle}`;

    if (!hours || Number(hours) <= 0) {
      setError("Hours is required");
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
      setTimeout(() => setCreated(null), 3000);
    } catch {
      setError("Could not connect to server");
    } finally {
      setCreating(null);
    }
  }

  const now = new Date();
  const relevantSprints = iterations
    .filter((i) => !i.finishDate || new Date(i.finishDate) >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
    .sort((a, b) => {
      if (!a.startDate) return -1;
      if (!b.startDate) return 1;
      return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select
          value={iterationPath}
          onChange={(e) => setIterationPath(e.target.value)}
          disabled={creating !== null}
          className="flex-1 rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-border-focus disabled:opacity-50"
        >
          {relevantSprints.map((s) => (
            <option key={s.id} value={s.path}>{s.name}</option>
          ))}
        </select>
        <input
          type="number"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="Hours *"
          min="0.5"
          step="0.5"
          required
          disabled={creating !== null}
          className="w-20 rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 outline-none focus:border-border-focus disabled:opacity-50"
        />
      </div>
      <AssigneeInput
        value={assignee}
        onChange={setAssignee}
        suggestions={availableAssignees}
        disabled={creating !== null}
      />
      <div className="grid grid-cols-2 gap-2">
        {TASK_PRESETS.map((preset) => (
          <button
            key={preset.key}
            onClick={() => handleCreate(preset)}
            disabled={creating !== null}
            className={clsx(
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50",
              preset.color,
              "hover:opacity-80"
            )}
          >
            {creating === preset.key ? "Creating..." : `+ ${preset.label}`}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-stale-ancient">{error}</p>}
      {created && <p className="text-xs text-stale-fresh">{created}</p>}
    </div>
  );
}

function PbiAssigneeField({
  initialValue,
  suggestions,
  disabled,
  onSave,
}: {
  initialValue: string;
  suggestions: string[];
  disabled: boolean;
  onSave: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  const savedRef = useRef(initialValue);

  function commitIfChanged(v: string) {
    if (v !== savedRef.current) {
      savedRef.current = v;
      onSave(v);
    }
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-text-muted">Assigned to</label>
      <select
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          commitIfChanged(e.target.value);
        }}
        disabled={disabled}
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

const DONE_STATES = new Set(["Done", "Closed", "Removed"]);

export function PbiDetailPanel({
  workItemId,
  childItems,
  availableStates,
  availableAssignees,
  iterations,
  onClose,
  onChildCreated,
  onFieldsUpdated,
  onStateChange,
  onChildrenSprintChanged,
}: PbiDetailPanelProps) {
  const [details, setDetails] = useState<WorkItemDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingFields, setSavingFields] = useState(false);
  const [fieldMsg, setFieldMsg] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/work-items?action=details&id=${workItemId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setDetails(data);
        }
      })
      .catch(() => setError("Could not load details"))
      .finally(() => setLoading(false));
  }, [workItemId]);

  function showFieldMsg(msg: string, isError = false) {
    setFieldMsg(msg);
    setTimeout(() => setFieldMsg(null), isError ? 4000 : 2000);
  }

  const handleSprintChange = useCallback(async (path: string) => {
    if (!details) return;
    setSavingFields(true);
    setFieldMsg(null);

    const newPath = path || "Relaunch - Charlie Tango";

    try {
      // Update PBI sprint
      const res = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: workItemId, fields: { iterationPath: newPath } }),
      });
      if (!res.ok) {
        const data = await res.json();
        showFieldMsg(data.error || "Failed to update sprint", true);
        return;
      }

      setDetails((d) => d ? { ...d, iterationPath: newPath } : d);
      onFieldsUpdated(workItemId, { iterationPath: newPath });

      // Move non-done children to same sprint
      console.log("[Sprint move] Children states:", childItems.map((c) => ({ id: c.id, state: c.state })));
      const activeChildIds = childItems
        .filter((c) => !DONE_STATES.has(c.state))
        .map((c) => c.id);
      console.log("[Sprint move] Active child IDs (not Done/Closed/Removed):", activeChildIds);

      if (activeChildIds.length > 0) {
        const bulkRes = await fetch("/api/work-items", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: activeChildIds, iterationPath: newPath }),
        });
        const bulkData = await bulkRes.json();
        const movedCount = bulkData.succeeded?.length ?? 0;
        const failedCount = bulkData.failed?.length ?? 0;
        onChildrenSprintChanged(bulkData.succeeded ?? [], newPath);

        if (failedCount > 0) {
          showFieldMsg(`Sprint updated. ${movedCount} children moved, ${failedCount} failed.`, true);
        } else {
          showFieldMsg(`Sprint updated + ${movedCount} active children moved`);
        }
      } else {
        showFieldMsg("Sprint updated");
      }
    } catch {
      showFieldMsg("Connection error", true);
    } finally {
      setSavingFields(false);
    }
  }, [details, workItemId, childItems, onFieldsUpdated, onChildrenSprintChanged]);

  const handleAssigneeChange = useCallback(async (name: string) => {
    if (!details) return;
    setSavingFields(true);
    try {
      const res = await fetch("/api/work-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: workItemId, fields: { assignedTo: name || null } }),
      });
      if (!res.ok) {
        const data = await res.json();
        showFieldMsg(data.error || "Failed to update assignee", true);
        return;
      }
      setDetails((d) => d ? { ...d, assignedTo: name || null } : d);
      onFieldsUpdated(workItemId, { assignedTo: name || null });
      showFieldMsg("Assignee updated");
    } catch {
      showFieldMsg("Connection error", true);
    } finally {
      setSavingFields(false);
    }
  }, [details, workItemId, onFieldsUpdated]);

  const handleCommentAdded = useCallback((comment: WorkItemComment) => {
    setDetails((d) => d ? { ...d, comments: [...d.comments, comment] } : d);
  }, []);

  const handleDescriptionSaved = useCallback((newDesc: string) => {
    setDetails((d) => d ? { ...d, description: newDesc } : d);
    onFieldsUpdated(workItemId, { description: newDesc });
    showFieldMsg("Description saved");
  }, [workItemId, onFieldsUpdated]);

  if (loading) {
    return (
      <div className="border-t border-border-default/50 bg-bg-primary px-6 py-8">
        <div className="flex items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
        </div>
      </div>
    );
  }

  if (error || !details) {
    return (
      <div className="border-t border-border-default/50 bg-bg-primary px-6 py-4">
        <p className="text-sm text-stale-ancient">{error || "Could not load details"}</p>
      </div>
    );
  }

  return (
    <div className="border-t border-border-default/50 bg-bg-primary">
      <div className="grid gap-6 px-6 py-5 lg:grid-cols-[1fr_320px]">
        {/* Left column: description + comments */}
        <div className="space-y-5">
          {/* Description */}
          <EditableDescription
            workItemId={workItemId}
            workItemType={details.type}
            initialValue={details.description ?? ""}
            onSaved={handleDescriptionSaved}
          />

          {/* Acceptance criteria */}
          {details.acceptanceCriteria && (
            <div>
              <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-text-muted">Acceptance criteria</h4>
              <RichHtmlContent html={details.acceptanceCriteria} className="prose-devops text-sm text-text-secondary" />
            </div>
          )}

          {/* Comments */}
          <div>
            <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-text-muted">
              Comments ({details.comments.length})
            </h4>
            {details.comments.length > 0 ? (
              <div className="rounded-lg border border-border-default bg-bg-card">
                {details.comments.map((c) => (
                  <CommentItem key={c.id} comment={c} />
                ))}
              </div>
            ) : (
              <p className="text-xs italic text-text-muted/60">No comments</p>
            )}
            <AddCommentForm workItemId={workItemId} onAdded={handleCommentAdded} />
          </div>
        </div>

        {/* Right column: PBI fields + task creation */}
        <div className="space-y-5">
          {/* State */}
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-text-muted">State</label>
            <StateSelector
              currentState={details.state}
              availableStates={availableStates}
              onStateChange={async (s) => {
                await onStateChange(workItemId, s);
                setDetails((d) => d ? { ...d, state: s } : d);
              }}
            />
          </div>

          {/* Assignee */}
          <PbiAssigneeField
            initialValue={details.assignedTo ?? ""}
            suggestions={availableAssignees}
            disabled={savingFields}
            onSave={handleAssigneeChange}
          />

          {/* Sprint */}
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-text-muted">Sprint</label>
            <SprintSelector
              iterations={iterations}
              currentPath={details.iterationPath}
              onSelect={handleSprintChange}
              saving={savingFields}
            />
            {childItems.filter((c) => !DONE_STATES.has(c.state)).length > 0 && (
              <p className="mt-1 text-[11px] text-text-muted">
                Changing sprint moves {childItems.filter((c) => !DONE_STATES.has(c.state)).length} active children too
              </p>
            )}
          </div>

          {/* Quick info */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-text-muted">Board column</label>
              <p className="text-sm text-text-secondary">{details.boardColumn || "—"}</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-text-muted">Iteration</label>
              <p className="text-sm text-text-secondary">
                {details.iterationPath === "Relaunch - Charlie Tango"
                  ? "Backlog"
                  : details.iterationPath.replace("Relaunch - Charlie Tango\\", "")}
              </p>
            </div>
          </div>

          {fieldMsg && (
            <p className={clsx("text-xs", fieldMsg.includes("error") || fieldMsg.includes("Failed") || fieldMsg.includes("failed") ? "text-stale-ancient" : "text-stale-fresh")}>
              {fieldMsg}
            </p>
          )}

          {/* Create child task */}
          <div>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-text-muted">Create child task</h4>
            <CreateTaskForm
              parentId={workItemId}
              pbiTitle={details.title}
              pbiAssignedTo={details.assignedTo}
              availableAssignees={availableAssignees}
              iterations={iterations}
              onCreated={onChildCreated}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
