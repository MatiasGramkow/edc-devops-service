"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import clsx from "clsx";
import type { TeamMember, TeamConfig, Activity, Iteration, SprintAnalyticsData, MemberAnalytics, SprintWorkItem } from "@/types/devops";
import { WorkItemTypeIcon } from "./WorkItemTypeIcon";
import { ConfirmDialog } from "./ConfirmDialog";

// --- Constants ---

const ACTIVITIES: { value: Activity; label: string; color: string; bgLight: string }[] = [
  { value: "Development", label: "Dev", color: "bg-accent-blue", bgLight: "bg-accent-blue/15 text-accent-blue" },
  { value: "QA", label: "QA", color: "bg-accent-gold", bgLight: "bg-accent-gold/15 text-accent-gold" },
  { value: "Release", label: "Release", color: "bg-stale-fresh", bgLight: "bg-stale-fresh/15 text-stale-fresh" },
];

const DONE_STATES = new Set(["Done", "Closed"]);

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function pct(value: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
}

function barColor(ratio: number): string {
  if (ratio > 1) return "bg-stale-ancient";
  if (ratio > 0.8) return "bg-accent-gold";
  return "bg-accent-blue";
}

function getCurrentIteration(iterations: Iteration[]): Iteration | undefined {
  const now = new Date();
  return iterations.find((i) => i.startDate && i.finishDate && new Date(i.startDate) <= now && new Date(i.finishDate) >= now);
}

function getRelevantIterations(iterations: Iteration[]): Iteration[] {
  const now = new Date();
  return iterations
    .filter((i) => i.startDate && i.finishDate)
    .filter((i) => new Date(i.finishDate!) >= new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000))
    .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());
}

function sprintLabel(iteration: Iteration, current: Iteration | undefined): string {
  if (current && iteration.id === current.id) return `${iteration.name} (current)`;
  if (current?.finishDate && iteration.startDate && new Date(iteration.startDate) > new Date(current.finishDate)) {
    const sorted = [current, iteration].sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());
    if (sorted[1].id === iteration.id && sorted.length === 2) return `${iteration.name} (next)`;
  }
  return iteration.name;
}

// --- Main component ---

interface TeamSetupViewProps {
  onMembersChanged?: () => void;
  iterations: Iteration[];
}

export function TeamSetupView({ onMembersChanged, iterations }: TeamSetupViewProps) {
  const [analytics, setAnalytics] = useState<SprintAnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIterationId, setSelectedIterationId] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const errorTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  function showError(msg: string) {
    setError(msg);
    clearTimeout(errorTimeout.current);
    errorTimeout.current = setTimeout(() => setError(null), 8000);
  }

  // Set initial iteration to current sprint
  useEffect(() => {
    if (iterations.length > 0 && !selectedIterationId) {
      const current = getCurrentIteration(iterations);
      if (current) setSelectedIterationId(current.id);
      else {
        const relevant = getRelevantIterations(iterations);
        if (relevant.length > 0) setSelectedIterationId(relevant[relevant.length - 1].id);
      }
    }
  }, [iterations, selectedIterationId]);

  // Fetch analytics when sprint changes
  const fetchAnalytics = useCallback(async (iterationId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/team?action=sprint-analytics&iterationId=${iterationId}`);
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Failed to load sprint analytics");
        return;
      }
      setAnalytics(data);
    } catch {
      showError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedIterationId) fetchAnalytics(selectedIterationId);
  }, [selectedIterationId, fetchAnalytics]);

  const currentIteration = getCurrentIteration(iterations);
  const relevantIterations = getRelevantIterations(iterations);
  const selectedIter = iterations.find((i) => i.id === selectedIterationId);
  const memberData = analytics?.members ?? [];
  const selected = memberData.find((m) => m.displayName === selectedMember);

  // Team totals
  const teamTotalCapacity = memberData.reduce((s, m) => s + (m.capacity?.totalCapacity ?? 0), 0);
  const teamTotalAssigned = memberData.reduce((s, m) => s + (m.capacity?.totalAssigned ?? 0), 0);
  const teamTotalItems = memberData.reduce((s, m) => s + m.stats.total, 0);
  const teamCompletedItems = memberData.reduce((s, m) => s + m.stats.completed, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Sprint selector + summary */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl bg-bg-secondary px-5 py-3">
        <select
          value={selectedIterationId ?? ""}
          onChange={(e) => { setSelectedIterationId(e.target.value); setSelectedMember(null); }}
          className="rounded-lg border border-border-default bg-bg-input px-3 py-1.5 text-sm font-medium text-text-primary focus:border-border-focus focus:outline-none"
        >
          {relevantIterations.map((iter) => (
            <option key={iter.id} value={iter.id}>
              {sprintLabel(iter, currentIteration)}
            </option>
          ))}
        </select>

        {analytics && (
          <div className="flex items-center gap-4 text-sm text-text-secondary">
            <span><span className="font-semibold text-text-primary">{memberData.length}</span> members</span>
            <span className="text-text-muted">|</span>
            <span><span className="font-semibold text-accent-blue">{Math.round(teamTotalAssigned)}h</span> / {Math.round(teamTotalCapacity)}h capacity</span>
            <span className="text-text-muted">|</span>
            <span><span className="font-semibold text-stale-fresh">{teamCompletedItems}</span> / {teamTotalItems} items done</span>
          </div>
        )}

        <button
          onClick={() => setShowSettings(!showSettings)}
          className="ml-auto rounded-lg p-2 text-text-muted hover:text-text-secondary"
          title="Team settings"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-stale-ancient/30 bg-stale-ancient/10 px-5 py-3 text-sm text-stale-ancient">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
        </div>
      )}

      {/* Analytics content */}
      {!loading && analytics && (
        <div className="flex gap-5">
          {/* Member list — left side */}
          <div className="w-80 shrink-0 space-y-2">
            {memberData.map((member) => (
              <MemberOverviewCard
                key={member.displayName}
                member={member}
                selected={selectedMember === member.displayName}
                onClick={() => setSelectedMember(selectedMember === member.displayName ? null : member.displayName)}
              />
            ))}

            {/* Unassigned items */}
            {analytics.unassignedItems.length > 0 && (
              <div className="rounded-xl border border-border-default bg-bg-card p-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-text-muted/20 text-xs text-text-muted">?</span>
                  <div>
                    <p className="font-medium text-text-secondary">Unassigned</p>
                    <p className="text-xs text-text-muted">{analytics.unassignedItems.length} items</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Detail panel — right side */}
          <div className="min-w-0 flex-1">
            {selected ? (
              <MemberDetailPanel member={selected} sprintWorkDays={analytics.sprintWorkDays} />
            ) : (
              <div className="rounded-xl border border-border-default bg-bg-card px-8 py-16 text-center">
                <p className="text-text-muted">Select a team member to see their sprint details</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Team Settings — collapsible */}
      {showSettings && (
        <TeamSettingsSection onMembersChanged={onMembersChanged} />
      )}
    </div>
  );
}

// --- Member overview card (left sidebar) ---

function MemberOverviewCard({
  member,
  selected,
  onClick,
}: {
  member: MemberAnalytics;
  selected: boolean;
  onClick: () => void;
}) {
  const cap = member.capacity;
  const ratio = cap && cap.totalCapacity > 0 ? cap.totalAssigned / cap.totalCapacity : 0;

  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full rounded-xl border p-3 text-left transition-all",
        selected
          ? "border-accent-blue/40 bg-accent-blue/8 ring-1 ring-accent-blue/20"
          : "border-border-default bg-bg-card hover:bg-bg-card-hover"
      )}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-blue text-xs font-bold text-white">
          {initials(member.displayName)}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text-primary">{member.displayName}</p>

          {/* Capacity bar */}
          {cap && cap.totalCapacity > 0 ? (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-secondary">
                <div
                  className={clsx("h-full rounded-full transition-all", barColor(ratio))}
                  style={{ width: `${pct(cap.totalAssigned, cap.totalCapacity)}%` }}
                />
              </div>
              <span className="text-[11px] tabular-nums text-text-muted">
                {Math.round(cap.totalAssigned)}/{Math.round(cap.totalCapacity)}h
              </span>
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-text-muted">No capacity set</p>
          )}
        </div>
      </div>

      {/* Item counts */}
      <div className="mt-2.5 flex items-center gap-2 text-[11px]">
        {member.stats.completed > 0 && (
          <span className="rounded-full bg-stale-fresh/15 px-2 py-0.5 font-medium text-stale-fresh">
            {member.stats.completed} done
          </span>
        )}
        {member.stats.active > 0 && (
          <span className="rounded-full bg-accent-blue/15 px-2 py-0.5 font-medium text-accent-blue">
            {member.stats.active} active
          </span>
        )}
        {member.stats.newItems > 0 && (
          <span className="rounded-full bg-text-muted/15 px-2 py-0.5 text-text-muted">
            {member.stats.newItems} new
          </span>
        )}
        {member.stats.total === 0 && (
          <span className="text-text-muted">No items</span>
        )}
      </div>
    </button>
  );
}

// --- Member detail panel (right side) ---

function MemberDetailPanel({ member, sprintWorkDays }: { member: MemberAnalytics; sprintWorkDays: number }) {
  const cap = member.capacity;

  // Group items by parent PBI/Bug — tasks go under their parent, PBIs/Bugs become group headers
  const itemIds = new Set(member.items.map((i) => i.id));
  // Items that are parents to other items in this sprint
  const isParentInSprint = new Set(
    member.items.filter((i) => i.parentId && itemIds.has(i.parentId)).map((i) => i.parentId!)
  );

  // Build groups: parent PBI/Bug as header, child tasks underneath
  const grouped = new Map<number, { parent: SprintWorkItem; children: SprintWorkItem[] }>();
  const standalone: SprintWorkItem[] = [];

  for (const item of member.items) {
    // If this item is a parent for other items in this sprint, it becomes a group header
    if (isParentInSprint.has(item.id)) {
      const group = grouped.get(item.id) ?? { parent: item, children: [] };
      group.parent = item;
      grouped.set(item.id, group);
    }
    // If this item has a parent that's also in this sprint, it's a child in that group
    else if (item.parentId && itemIds.has(item.parentId)) {
      const group = grouped.get(item.parentId) ?? { parent: item, children: [] }; // parent placeholder
      group.children.push(item);
      grouped.set(item.parentId, group);
    }
    // Otherwise standalone (PBI with no children in sprint, or orphaned tasks)
    else {
      standalone.push(item);
    }
  }

  // Sort standalone: PBIs/Bugs first, then tasks
  standalone.sort((a, b) => {
    const typeOrder = (t: string) => t === "Product Backlog Item" ? 0 : t === "Bug" ? 1 : t === "Feature" ? 2 : 3;
    return typeOrder(a.type) - typeOrder(b.type) || a.priority - b.priority;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-border-default bg-bg-card p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-blue text-lg font-bold text-white">
            {initials(member.displayName)}
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-text-primary">{member.displayName}</h2>
            <p className="text-sm text-text-secondary">
              {member.stats.total} items in sprint — {member.stats.completed} done, {member.stats.active} active, {member.stats.newItems} new
            </p>
          </div>
        </div>

        {/* Capacity breakdown */}
        {cap && cap.activities.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            {cap.activities.map((act) => {
              const actInfo = ACTIVITIES.find((a) => a.value === act.name);
              const ratio = act.capacityHours > 0 ? act.assignedHours / act.capacityHours : 0;
              return (
                <div key={act.name} className="rounded-lg bg-bg-secondary p-3">
                  <div className="flex items-center gap-2">
                    <span className={clsx("h-2.5 w-2.5 rounded-full", actInfo?.color ?? "bg-text-muted")} />
                    <span className="text-xs font-medium text-text-secondary">{act.name}</span>
                  </div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-lg font-bold tabular-nums text-text-primary">{Math.round(act.assignedHours)}</span>
                    <span className="text-xs text-text-muted">/ {Math.round(act.capacityHours)}h</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-card">
                    <div
                      className={clsx("h-full rounded-full", barColor(ratio))}
                      style={{ width: `${pct(act.assignedHours, act.capacityHours)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Hours summary */}
        <div className="mt-4 flex items-center gap-6 border-t border-border-default pt-3 text-sm">
          {member.stats.remainingHours > 0 && (
            <span className="text-text-secondary">
              <span className="font-semibold text-accent-gold">{member.stats.remainingHours}h</span> remaining
            </span>
          )}
          {member.stats.completedHours > 0 && (
            <span className="text-text-secondary">
              <span className="font-semibold text-stale-fresh">{member.stats.completedHours}h</span> completed
            </span>
          )}
          {member.stats.originalEstimateHours > 0 && (
            <span className="text-text-secondary">
              <span className="font-semibold text-text-muted">{member.stats.originalEstimateHours}h</span> estimated
            </span>
          )}
          {sprintWorkDays > 0 && (
            <span className="text-text-muted">{sprintWorkDays} work days</span>
          )}
        </div>
      </div>

      {/* Work items grouped by parent PBI/Bug */}
      {[...grouped.entries()].map(([parentId, group]) => (
        <div key={parentId} className="rounded-xl border border-border-default bg-bg-card overflow-hidden">
          {/* Parent PBI/Bug as header */}
          <div className="border-b border-border-default bg-bg-secondary">
            <WorkItemRow item={group.parent} isGroupHeader />
          </div>
          {/* Child tasks */}
          {group.children.length > 0 && (
            <div className="divide-y divide-border-default">
              {group.children.map((item) => (
                <WorkItemRow key={item.id} item={item} indent />
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Standalone items — group by external parent if available */}
      {(() => {
        // Group standalone items by their external parent (parent not in this sprint)
        const byExternalParent = new Map<string, SprintWorkItem[]>();
        const noParent: SprintWorkItem[] = [];
        for (const item of standalone) {
          if (item.parentId && item.parentTitle) {
            const key = `${item.parentId}::${item.parentTitle}`;
            const list = byExternalParent.get(key) ?? [];
            list.push(item);
            byExternalParent.set(key, list);
          } else {
            noParent.push(item);
          }
        }

        return (
          <>
            {[...byExternalParent.entries()].map(([key, items]) => {
              const [parentIdStr, parentTitle] = key.split("::");
              return (
                <div key={key} className="rounded-xl border border-border-default bg-bg-card overflow-hidden">
                  <div className="border-b border-border-default bg-bg-secondary px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <WorkItemTypeIcon type="Feature" />
                      <a
                        href={`https://dev.azure.com/edc-group/Relaunch%20-%20Charlie%20Tango/_workitems/edit/${parentIdStr}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono text-text-muted hover:text-accent-blue"
                      >
                        #{parentIdStr}
                      </a>
                      <span className="text-sm font-medium text-text-secondary">{parentTitle}</span>
                    </div>
                  </div>
                  <div className="divide-y divide-border-default">
                    {items.map((item) => (
                      <WorkItemRow key={item.id} item={item} indent />
                    ))}
                  </div>
                </div>
              );
            })}

            {noParent.length > 0 && (
              <div className="rounded-xl border border-border-default bg-bg-card overflow-hidden">
                {(grouped.size > 0 || byExternalParent.size > 0) && (
                  <div className="border-b border-border-default bg-bg-secondary px-4 py-2.5">
                    <span className="text-xs font-medium uppercase tracking-wider text-text-muted">Other items</span>
                  </div>
                )}
                <div className="divide-y divide-border-default">
                  {noParent.map((item) => (
                    <WorkItemRow key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}
          </>
        );
      })()}

      {/* Empty state */}
      {member.items.length === 0 && (
        <div className="rounded-xl border border-border-default bg-bg-card px-6 py-12 text-center">
          <p className="text-text-muted">No work items assigned in this sprint</p>
        </div>
      )}
    </div>
  );
}

// --- Work item row ---

function WorkItemRow({ item, isGroupHeader, indent }: { item: SprintWorkItem; isGroupHeader?: boolean; indent?: boolean }) {
  const isDone = DONE_STATES.has(item.state);

  return (
    <div className={clsx("flex items-center gap-3 py-2.5", isDone && "opacity-50", indent ? "pl-8 pr-4" : "px-4", isGroupHeader && "font-medium")}>
      <WorkItemTypeIcon type={item.type} />
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs font-mono text-text-muted hover:text-accent-blue"
      >
        #{item.id}
      </a>
      <span className={clsx("min-w-0 flex-1 truncate text-sm", isDone ? "text-text-muted line-through" : "text-text-primary")}>
        {item.title}
      </span>

      {/* Activity badge */}
      {item.activity && (
        <span className={clsx(
          "rounded px-1.5 py-0.5 text-[10px] font-medium",
          ACTIVITIES.find((a) => a.value === item.activity)?.bgLight ?? "bg-text-muted/15 text-text-muted"
        )}>
          {item.activity}
        </span>
      )}

      {/* Hours */}
      {(item.remainingWork != null || item.completedWork != null) && (
        <span className="text-xs tabular-nums text-text-muted">
          {item.remainingWork != null && <span>{item.remainingWork}h rem</span>}
          {item.completedWork != null && item.completedWork > 0 && (
            <span className="ml-1 text-stale-fresh">{item.completedWork}h done</span>
          )}
        </span>
      )}

      {/* Story points for PBIs */}
      {item.storyPoints != null && (
        <span className="rounded bg-type-feature/15 px-1.5 py-0.5 text-[10px] font-bold text-type-feature">
          {item.storyPoints} SP
        </span>
      )}

      {/* Priority */}
      {item.priority <= 2 && (
        <span className={clsx(
          "rounded px-1 py-0.5 text-[10px] font-bold",
          item.priority === 1 ? "bg-stale-ancient/15 text-stale-ancient" : "bg-stale-stale/15 text-stale-stale"
        )}>
          P{item.priority}
        </span>
      )}

      {/* State */}
      <span className={clsx(
        "rounded-full px-2 py-0.5 text-[10px] font-medium",
        isDone
          ? "bg-stale-fresh/15 text-stale-fresh"
          : item.state === "Active" || item.state === "In Progress"
            ? "bg-accent-blue/15 text-accent-blue"
            : item.state === "New" || item.state === "To Do"
              ? "bg-text-muted/15 text-text-muted"
              : "bg-accent-gold/15 text-accent-gold"
      )}>
        {item.state}
      </span>
    </div>
  );
}

// ========================================
// Team Settings (collapsible section)
// ========================================

function TeamSettingsSection({ onMembersChanged }: { onMembersChanged?: () => void }) {
  const [config, setConfig] = useState<TeamConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncData, setSyncData] = useState<{ displayName: string; email: string }[] | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TeamMember | null>(null);
  const errorTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  function showError(msg: string) {
    setError(msg);
    clearTimeout(errorTimeout.current);
    errorTimeout.current = setTimeout(() => setError(null), 6000);
  }

  const fetchConfig = useCallback(async (notify = false) => {
    try {
      const res = await fetch("/api/team?action=config");
      const data = await res.json();
      if (res.ok) {
        setConfig(data);
        if (notify) onMembersChanged?.();
      } else {
        showError(data.error || "Failed to load team config");
      }
    } catch {
      showError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  }, [onMembersChanged]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const members = config?.members ?? [];
  const activeMembers = members.filter((m) => m.active);
  const inactiveMembers = members.filter((m) => !m.active);
  const existingNames = new Set(members.map((m) => m.displayName));

  const updateMember = async (id: string, fields: Record<string, unknown>) => {
    const res = await fetch("/api/team", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, fields }),
    });
    if (!res.ok) {
      const data = await res.json();
      showError(data.error || "Update failed");
      return;
    }
    await fetchConfig(true);
  };

  const addMember = async (displayName: string, defaultActivity: Activity) => {
    const res = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, defaultActivity }),
    });
    if (!res.ok) {
      const data = await res.json();
      showError(data.error || "Add failed");
      return;
    }
    await fetchConfig(true);
  };

  const deleteMember = async (id: string) => {
    const res = await fetch("/api/team", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) {
      const data = await res.json();
      showError(data.error || "Delete failed");
      return;
    }
    setDeleteTarget(null);
    await fetchConfig(true);
  };

  const startSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/team?action=sync");
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || "Sync failed. Your PAT may not have Team read permissions.");
        return;
      }
      setSyncData(data);
    } catch {
      showError("Could not connect to server");
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncAdd = async (names: string[]) => {
    for (const name of names) {
      await addMember(name, "Development");
    }
    setSyncData(null);
    await fetchConfig(true);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border-default bg-bg-secondary p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Team Settings</h3>
        <div className="flex items-center gap-2">
          {inactiveMembers.length > 0 && (
            <button
              onClick={() => setShowInactive(!showInactive)}
              className="text-xs text-text-muted hover:text-text-secondary"
            >
              {showInactive ? "Hide" : "Show"} {inactiveMembers.length} inactive
            </button>
          )}
          <button
            onClick={startSync}
            disabled={syncing}
            className="rounded-lg bg-bg-card px-3 py-1 text-xs font-medium text-text-primary hover:bg-bg-card-hover disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync from Azure DevOps"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-stale-ancient/30 bg-stale-ancient/10 px-4 py-2 text-xs text-stale-ancient">
          {error}
        </div>
      )}

      {/* Member config cards */}
      <div className="space-y-2">
        {activeMembers.map((member) => (
          <MemberConfigCard
            key={member.id}
            member={member}
            onUpdate={(fields) => updateMember(member.id, fields)}
            onDelete={() => setDeleteTarget(member)}
          />
        ))}

        {showInactive && inactiveMembers.map((member) => (
          <div key={member.id} className="opacity-50">
            <MemberConfigCard
              member={member}
              onUpdate={(fields) => updateMember(member.id, fields)}
              onDelete={() => setDeleteTarget(member)}
            />
          </div>
        ))}
      </div>

      {/* Add member */}
      <AddMemberForm onAdd={addMember} existingNames={existingNames} />

      {/* Sync modal */}
      {syncData && (
        <SyncModal
          synced={syncData}
          existing={existingNames}
          onAdd={handleSyncAdd}
          onClose={() => setSyncData(null)}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <ConfirmDialog
          open={true}
          title="Remove team member"
          description={`Remove ${deleteTarget.displayName} from the team configuration?`}
          confirmLabel="Remove"
          onConfirm={() => deleteMember(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// --- Member config card (settings) ---

function MemberConfigCard({
  member,
  onUpdate,
  onDelete,
}: {
  member: TeamMember;
  onUpdate: (fields: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border-default bg-bg-card px-4 py-2.5 hover:bg-bg-card-hover">
      <div className={clsx(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white",
        member.active ? "bg-accent-blue" : "bg-text-muted/30"
      )}>
        {initials(member.displayName)}
      </div>

      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{member.displayName}</span>

      <select
        value={member.defaultActivity}
        onChange={(e) => onUpdate({ defaultActivity: e.target.value })}
        className="rounded border border-border-default bg-bg-input px-2 py-1 text-xs text-text-primary focus:border-border-focus focus:outline-none"
      >
        {ACTIVITIES.map((a) => (
          <option key={a.value} value={a.value}>{a.label}</option>
        ))}
      </select>

      <InlineHoursInput value={member.capacityPerDay} onSave={(v) => onUpdate({ capacityPerDay: v })} />
      <span className="text-xs text-text-muted">h/d</span>

      <button
        onClick={() => onUpdate({ active: !member.active })}
        className={clsx(
          "relative h-5 w-9 rounded-full transition-colors",
          member.active ? "bg-stale-fresh" : "bg-text-muted/30"
        )}
      >
        <span className={clsx(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
          member.active ? "left-[18px]" : "left-0.5"
        )} />
      </button>

      <button
        onClick={onDelete}
        className="rounded p-1 text-text-muted opacity-0 hover:text-stale-ancient group-hover:opacity-100"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
}

// --- Inline hours input ---

function InlineHoursInput({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [local, setLocal] = useState(String(value));

  useEffect(() => { setLocal(String(value)); }, [value]);

  const commit = () => {
    const num = parseFloat(local);
    if (isNaN(num) || num < 0 || num > 24 || num === value) {
      setLocal(String(value));
      return;
    }
    onSave(num);
  };

  return (
    <input
      type="number"
      min={0}
      max={24}
      step={0.5}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
      className="w-14 rounded border border-border-default bg-bg-input px-1.5 py-1 text-right text-xs text-text-primary focus:border-border-focus focus:outline-none"
    />
  );
}

// --- Add member form ---

function AddMemberForm({ onAdd, existingNames }: { onAdd: (name: string, activity: Activity) => void; existingNames: Set<string> }) {
  const [name, setName] = useState("");
  const [activity, setActivity] = useState<Activity>("Development");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (existingNames.has(trimmed)) { setError("Already exists"); return; }
    onAdd(trimmed, activity);
    setName("");
    setError(null);
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border-2 border-dashed border-border-default px-4 py-3">
      <input
        type="text"
        value={name}
        onChange={(e) => { setName(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        placeholder="Add member name..."
        className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
      />
      <select
        value={activity}
        onChange={(e) => setActivity(e.target.value as Activity)}
        className="rounded border border-border-default bg-bg-input px-2 py-1 text-xs text-text-primary focus:outline-none"
      >
        {ACTIVITIES.map((a) => (
          <option key={a.value} value={a.value}>{a.label}</option>
        ))}
      </select>
      <button
        onClick={submit}
        disabled={!name.trim()}
        className="rounded-lg bg-accent-blue px-3 py-1 text-xs font-medium text-white hover:bg-accent-blue/90 disabled:opacity-40"
      >
        Add
      </button>
      {error && <span className="text-xs text-stale-ancient">{error}</span>}
    </div>
  );
}

// --- Sync modal ---

function SyncModal({ synced, existing, onAdd, onClose }: {
  synced: { displayName: string; email: string }[];
  existing: Set<string>;
  onAdd: (names: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const m of synced) {
      if (!existing.has(m.displayName)) s.add(m.displayName);
    }
    return s;
  });

  const newMembers = synced.filter((m) => !existing.has(m.displayName));
  const existingMembers = synced.filter((m) => existing.has(m.displayName));

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 max-h-[80vh] w-full max-w-lg overflow-hidden rounded-xl border border-border-default bg-bg-secondary shadow-2xl">
        <div className="border-b border-border-default px-6 py-4">
          <h3 className="text-lg font-semibold text-text-primary">Sync from Azure DevOps</h3>
          <p className="mt-1 text-sm text-text-secondary">Found {synced.length} member{synced.length !== 1 ? "s" : ""}</p>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-6 py-4 space-y-2">
          {newMembers.length > 0 && (
            <>
              <p className="text-xs font-medium uppercase tracking-wider text-text-muted">New ({newMembers.length})</p>
              {newMembers.map((m) => (
                <label key={m.displayName} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-bg-card">
                  <input type="checkbox" checked={selected.has(m.displayName)} onChange={() => toggle(m.displayName)} className="accent-accent-blue" />
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-blue text-[10px] font-bold text-white">{initials(m.displayName)}</div>
                  <div>
                    <div className="text-sm text-text-primary">{m.displayName}</div>
                    {m.email && <div className="text-xs text-text-muted">{m.email}</div>}
                  </div>
                </label>
              ))}
            </>
          )}
          {existingMembers.length > 0 && (
            <>
              <p className="mt-3 text-xs font-medium uppercase tracking-wider text-text-muted">Already added ({existingMembers.length})</p>
              {existingMembers.map((m) => (
                <div key={m.displayName} className="flex items-center gap-3 rounded-lg px-3 py-2 opacity-40">
                  <div className="h-4 w-4" />
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-text-muted/30 text-[10px] font-bold text-text-muted">{initials(m.displayName)}</div>
                  <span className="text-sm text-text-muted">{m.displayName}</span>
                </div>
              ))}
            </>
          )}
          {synced.length === 0 && <p className="py-8 text-center text-sm text-text-muted">No team members found.</p>}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-border-default px-6 py-4">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:text-text-primary">Cancel</button>
          {newMembers.length > 0 && (
            <button
              onClick={() => onAdd([...selected])}
              disabled={selected.size === 0}
              className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/90 disabled:opacity-40"
            >
              Add {selected.size}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
