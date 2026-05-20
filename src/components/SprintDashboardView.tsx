"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import clsx from "clsx";
import type {
  Iteration,
  WorkItemWithChildren,
  SprintCapacityData,
  BacklogHealthData,
  SprintVelocity,
} from "@/types/devops";
import { WorkItemTypeIcon } from "./WorkItemTypeIcon";

// --- Types ---

interface SprintDashboardViewProps {
  iterations: Iteration[];
}

interface SprintGoalResponse {
  text: string;
}

interface UnfinishedItemsResponse {
  items: WorkItemWithChildren[];
}

// --- Helpers ---

const DONE_STATES = new Set(["Done", "Closed", "Removed"]);

function pct(value: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
}

function capacityColor(ratio: number): string {
  if (ratio > 1) return "text-stale-ancient";
  if (ratio > 0.8) return "text-accent-gold";
  return "text-accent-blue";
}

function capacityBarColor(ratio: number): string {
  if (ratio > 1) return "bg-stale-ancient";
  if (ratio > 0.8) return "bg-accent-gold";
  return "bg-accent-blue";
}

function healthScoreColor(score: number): string {
  if (score >= 70) return "text-stale-fresh";
  if (score >= 40) return "text-accent-gold";
  return "text-stale-ancient";
}

function healthScoreBarColor(score: number): string {
  if (score >= 70) return "bg-stale-fresh";
  if (score >= 40) return "bg-accent-gold";
  return "bg-stale-ancient";
}

function ageColor(days: number): string {
  if (days <= 30) return "text-stale-fresh";
  if (days <= 90) return "text-accent-gold";
  return "text-stale-ancient";
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

function stateColor(state: string): string {
  if (DONE_STATES.has(state)) return "bg-stale-fresh/15 text-stale-fresh";
  if (state === "Active" || state === "In Progress") return "bg-accent-blue/15 text-accent-blue";
  if (state === "New" || state === "To Do") return "bg-text-muted/15 text-text-muted";
  return "bg-accent-gold/15 text-accent-gold";
}

// --- Main Component ---

export function SprintDashboardView({ iterations }: SprintDashboardViewProps) {
  const [capacity, setCapacity] = useState<SprintCapacityData | null>(null);
  const [unfinished, setUnfinished] = useState<WorkItemWithChildren[]>([]);
  const [sprintGoal, setSprintGoal] = useState<string | null>(null);
  const [backlogHealth, setBacklogHealth] = useState<BacklogHealthData | null>(null);
  const [velocity, setVelocity] = useState<SprintVelocity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unfinishedExpanded, setUnfinishedExpanded] = useState(false);
  const errorTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Determine current sprint
  const now = new Date();
  const currentSprint = iterations.find(
    (i) =>
      i.startDate &&
      i.finishDate &&
      new Date(i.startDate) <= now &&
      new Date(i.finishDate) >= now
  );

  function showError(msg: string) {
    setError(msg);
    clearTimeout(errorTimeout.current);
    errorTimeout.current = setTimeout(() => setError(null), 8000);
  }

  const fetchData = useCallback(async () => {
    if (!currentSprint) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const results = await Promise.allSettled([
        // 1. Sprint capacity
        fetch(`/api/work-items?action=sprint-capacity&iterationId=${currentSprint.id}`)
          .then((r) => r.json()),
        // 2. Unfinished items
        fetch(`/api/work-items?action=unfinished-sprint&iterationPath=${encodeURIComponent(currentSprint.path)}`)
          .then((r) => r.json()),
        // 3. Sprint goal
        fetch(`/api/work-items?action=sprint-goals&iterationId=${currentSprint.id}`)
          .then((r) => r.json()),
        // 4. Backlog health
        fetch(`/api/work-items?action=backlog-health`)
          .then((r) => r.json()),
        // 5. Velocity for current sprint
        fetch(`/api/work-items?action=velocity&iterationIds=${currentSprint.id}`)
          .then((r) => r.json()),
      ]);

      // Capacity
      if (results[0].status === "fulfilled" && !results[0].value.error) {
        setCapacity(results[0].value as SprintCapacityData);
      }

      // Unfinished items
      if (results[1].status === "fulfilled" && !results[1].value.error) {
        const data = results[1].value as UnfinishedItemsResponse;
        setUnfinished(data.items ?? []);
      }

      // Sprint goal
      if (results[2].status === "fulfilled" && !results[2].value.error) {
        const data = results[2].value as SprintGoalResponse;
        setSprintGoal(data.text || null);
      }

      // Backlog health
      if (results[3].status === "fulfilled" && !results[3].value.error) {
        setBacklogHealth(results[3].value as BacklogHealthData);
      }

      // Velocity
      if (results[4].status === "fulfilled" && !results[4].value.error) {
        const data = results[4].value as SprintVelocity[];
        if (Array.isArray(data) && data.length > 0) {
          setVelocity(data[0]);
        }
      }
    } catch {
      showError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  }, [currentSprint?.id, currentSprint?.path]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // No current sprint
  if (!currentSprint) {
    return (
      <div className="mx-auto max-w-6xl">
        <div className="rounded-xl border border-border-default bg-bg-card px-8 py-16 text-center">
          <svg
            className="mx-auto h-12 w-12 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
            />
          </svg>
          <p className="mt-4 text-lg font-medium text-text-primary">No active sprint found</p>
          <p className="mt-1 text-sm text-text-muted">
            There is no sprint with dates that include today.
          </p>
        </div>
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
      </div>
    );
  }

  // Sprint dates and progress
  const sprintStart = new Date(currentSprint.startDate!);
  const sprintEnd = new Date(currentSprint.finishDate!);
  const totalDays = daysBetween(sprintStart, sprintEnd);
  const elapsedDays = daysBetween(sprintStart, now);
  const daysRemaining = daysBetween(now, sprintEnd);
  const sprintProgress = pct(elapsedDays, totalDays);

  // Capacity totals
  const totalCapacity = capacity?.members.reduce((s, m) => s + m.totalCapacity, 0) ?? 0;
  const totalAssigned = capacity?.members.reduce((s, m) => s + m.totalAssigned, 0) ?? 0;
  const capacityRatio = totalCapacity > 0 ? totalAssigned / totalCapacity : 0;

  // Progress from velocity
  const totalItems = velocity?.totalItems ?? 0;
  const completedItems = velocity?.completedItems ?? 0;
  const completedHours = velocity?.completedHours ?? 0;
  const remainingHours = velocity?.remainingHours ?? 0;
  const totalHours = completedHours + remainingHours;
  const hoursRatio = totalHours > 0 ? completedHours / totalHours : 0;

  // Carry-over warning threshold
  const showCarryOverWarning = daysRemaining <= 3 && unfinished.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Error */}
      {error && (
        <div className="rounded-xl border border-stale-ancient/30 bg-stale-ancient/10 px-5 py-3 text-sm text-stale-ancient">
          {error}
        </div>
      )}

      {/* Sprint Header */}
      <div className="rounded-xl border border-border-default bg-bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-text-primary">{currentSprint.name}</h2>
            <p className="mt-0.5 text-sm text-text-secondary">
              {formatShortDate(currentSprint.startDate!)} &ndash;{" "}
              {formatShortDate(currentSprint.finishDate!)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={clsx(
                "rounded-full px-3 py-1 text-sm font-medium",
                daysRemaining <= 2
                  ? "bg-stale-ancient/15 text-stale-ancient"
                  : daysRemaining <= 5
                    ? "bg-accent-gold/15 text-accent-gold"
                    : "bg-accent-blue/15 text-accent-blue"
              )}
            >
              {daysRemaining} {daysRemaining === 1 ? "day" : "days"} left
            </span>
          </div>
        </div>

        {/* Sprint elapsed progress bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>Sprint progress</span>
            <span>{sprintProgress}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg-secondary">
            <div
              className="h-full rounded-full bg-accent-blue transition-all"
              style={{ width: `${sprintProgress}%` }}
            />
          </div>
        </div>
      </div>

      {/* 4 Summary Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Capacity Card */}
        <SummaryCard
          label="Capacity"
          value={`${pct(totalAssigned, totalCapacity)}%`}
          detail={`${Math.round(totalAssigned)} / ${Math.round(totalCapacity)}h`}
          valueColor={capacityColor(capacityRatio)}
          progress={pct(totalAssigned, totalCapacity)}
          barColor={capacityBarColor(capacityRatio)}
        />

        {/* Progress Card */}
        <SummaryCard
          label="Progress"
          value={`${completedItems}/${totalItems}`}
          detail="items completed"
          valueColor="text-stale-fresh"
          progress={pct(completedItems, totalItems)}
          barColor="bg-stale-fresh"
        />

        {/* Hours Card */}
        <SummaryCard
          label="Hours"
          value={`${Math.round(completedHours)}/${Math.round(totalHours)}h`}
          detail="hours done"
          valueColor="text-accent-gold"
          progress={pct(completedHours, totalHours)}
          barColor="bg-accent-gold"
        />

        {/* Carry-over Card */}
        <SummaryCard
          label="Carry-over"
          value={`${unfinished.length}`}
          detail={unfinished.length === 1 ? "unfinished item" : "unfinished items"}
          valueColor={unfinished.length > 0 ? "text-stale-ancient" : "text-stale-fresh"}
          progress={0}
          barColor="bg-transparent"
          noBar
        />
      </div>

      {/* Two-column: Capacity Overview + Backlog Health */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Capacity Overview */}
        <div className="rounded-xl border border-border-default bg-bg-card p-5">
          <h3 className="text-sm font-semibold text-text-primary">Capacity Overview</h3>

          {capacity && capacity.members.length > 0 ? (
            <div className="mt-4 space-y-3">
              {capacity.members.map((member) => {
                const ratio =
                  member.totalCapacity > 0
                    ? member.totalAssigned / member.totalCapacity
                    : 0;
                return (
                  <div key={member.displayName} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate text-text-secondary">
                        {member.displayName}
                      </span>
                      <span className="shrink-0 tabular-nums text-text-muted">
                        {Math.round(member.totalAssigned)}/{Math.round(member.totalCapacity)}h
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-bg-secondary">
                      <div
                        className={clsx(
                          "h-full rounded-full transition-all",
                          capacityBarColor(ratio)
                        )}
                        style={{
                          width: `${pct(member.totalAssigned, member.totalCapacity)}%`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}

              {/* Team total */}
              <div className="mt-2 border-t border-border-default pt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-text-primary">Team total</span>
                  <span
                    className={clsx(
                      "font-semibold tabular-nums",
                      capacityColor(capacityRatio)
                    )}
                  >
                    {Math.round(totalAssigned)}/{Math.round(totalCapacity)}h (
                    {pct(totalAssigned, totalCapacity)}%)
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg-secondary">
                  <div
                    className={clsx(
                      "h-full rounded-full transition-all",
                      capacityBarColor(capacityRatio)
                    )}
                    style={{
                      width: `${pct(totalAssigned, totalCapacity)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-text-muted">No capacity data available.</p>
          )}
        </div>

        {/* Backlog Health */}
        <div className="rounded-xl border border-border-default bg-bg-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">Backlog Health</h3>
            {backlogHealth && backlogHealth.needsAttention > 0 && (
              <span className="rounded-full bg-stale-ancient/15 px-2.5 py-0.5 text-xs font-medium text-stale-ancient">
                {backlogHealth.needsAttention} needs attention
              </span>
            )}
          </div>

          {backlogHealth ? (
            <div className="mt-4 space-y-4">
              {/* Score */}
              <div className="flex items-center gap-4">
                <span
                  className={clsx(
                    "text-4xl font-bold tabular-nums",
                    healthScoreColor(backlogHealth.healthScore)
                  )}
                >
                  {backlogHealth.healthScore}
                </span>
                <div className="flex-1">
                  <div className="h-2.5 overflow-hidden rounded-full bg-bg-secondary">
                    <div
                      className={clsx(
                        "h-full rounded-full transition-all",
                        healthScoreBarColor(backlogHealth.healthScore)
                      )}
                      style={{ width: `${backlogHealth.healthScore}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-text-muted">Health score (0-100)</p>
                </div>
              </div>

              {/* Breakdown rows */}
              <div className="space-y-2.5">
                <HealthMetricRow
                  label="Estimates"
                  value={`${pct(backlogHealth.withEstimates, backlogHealth.totalItems)}%`}
                  progress={pct(backlogHealth.withEstimates, backlogHealth.totalItems)}
                  barColor="bg-accent-blue"
                />
                <HealthMetricRow
                  label="Assigned"
                  value={`${pct(backlogHealth.withAssignee, backlogHealth.totalItems)}%`}
                  progress={pct(backlogHealth.withAssignee, backlogHealth.totalItems)}
                  barColor="bg-accent-teal"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary">Avg Age</span>
                  <span
                    className={clsx(
                      "text-xs font-semibold tabular-nums",
                      ageColor(backlogHealth.averageAgeDays)
                    )}
                  >
                    {Math.round(backlogHealth.averageAgeDays)} days
                  </span>
                </div>
                <HealthMetricRow
                  label="In Pipeline"
                  value={`${pct(
                    backlogHealth.inRefinement + backlogHealth.sprintPlanning,
                    backlogHealth.totalItems
                  )}%`}
                  progress={pct(
                    backlogHealth.inRefinement + backlogHealth.sprintPlanning,
                    backlogHealth.totalItems
                  )}
                  barColor="bg-type-feature"
                />
              </div>

              {/* Oldest items */}
              {backlogHealth.oldestItems.length > 0 && (
                <div className="border-t border-border-default pt-3">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
                    Oldest items
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {backlogHealth.oldestItems.slice(0, 5).map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2 text-xs"
                      >
                        <WorkItemTypeIcon type={item.type} />
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-text-muted hover:text-accent-blue"
                        >
                          #{item.id}
                        </a>
                        <span className="min-w-0 flex-1 truncate text-text-secondary">
                          {item.title}
                        </span>
                        <span
                          className={clsx(
                            "shrink-0 tabular-nums",
                            ageColor(item.ageDays)
                          )}
                        >
                          {item.ageDays}d
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-text-muted">No backlog data available.</p>
          )}
        </div>
      </div>

      {/* Sprint Goal */}
      {sprintGoal && (
        <div className="rounded-xl border border-border-default bg-bg-card p-5">
          <h3 className="text-sm font-semibold text-text-primary">Sprint Goal</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
            {sprintGoal}
          </p>
        </div>
      )}

      {/* Carry-over Warning Banner */}
      {showCarryOverWarning && (
        <div className="flex items-center gap-3 rounded-xl border border-accent-gold/30 bg-accent-gold/10 px-5 py-3">
          <svg
            className="h-5 w-5 shrink-0 text-accent-gold"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <p className="text-sm text-accent-gold">
            <span className="font-semibold">{unfinished.length}</span>{" "}
            {unfinished.length === 1 ? "item is" : "items are"} still unfinished with{" "}
            <span className="font-semibold">{daysRemaining}</span>{" "}
            {daysRemaining === 1 ? "day" : "days"} remaining in the sprint
          </p>
        </div>
      )}

      {/* Unfinished Items */}
      {unfinished.length > 0 && (
        <div className="rounded-xl border border-border-default bg-bg-card overflow-hidden">
          <button
            onClick={() => setUnfinishedExpanded(!unfinishedExpanded)}
            className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-bg-card-hover transition-colors"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text-primary">
                Unfinished Items
              </h3>
              <span className="rounded-full bg-stale-ancient/15 px-2 py-0.5 text-xs font-medium text-stale-ancient">
                {unfinished.length}
              </span>
            </div>
            <svg
              className={clsx(
                "h-4 w-4 text-text-muted transition-transform",
                unfinishedExpanded && "rotate-180"
              )}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {unfinishedExpanded && (
            <div className="border-t border-border-default divide-y divide-border-default">
              {unfinished.map((item) => {
                const childHoursRemaining = item.children
                  .filter((c) => !DONE_STATES.has(c.state))
                  .reduce((sum, c) => sum + (c.remainingWork ?? 0), 0);

                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-5 py-2.5 hover:bg-bg-card-hover transition-colors"
                  >
                    <WorkItemTypeIcon type={item.type} />
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-text-muted hover:text-accent-blue"
                    >
                      #{item.id}
                    </a>
                    <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                      {item.title}
                    </span>

                    {/* Remaining hours from children */}
                    {childHoursRemaining > 0 && (
                      <span className="shrink-0 text-xs tabular-nums text-accent-gold">
                        {childHoursRemaining}h rem
                      </span>
                    )}

                    {/* State badge */}
                    <span
                      className={clsx(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        stateColor(item.state)
                      )}
                    >
                      {item.state}
                    </span>

                    {/* Open in DevOps */}
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-text-muted hover:text-accent-blue"
                      title="Open in Azure DevOps"
                    >
                      <svg
                        className="h-3.5 w-3.5"
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
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Summary Card ---

function SummaryCard({
  label,
  value,
  detail,
  valueColor,
  progress,
  barColor,
  noBar,
}: {
  label: string;
  value: string;
  detail: string;
  valueColor: string;
  progress: number;
  barColor: string;
  noBar?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border-default bg-bg-card p-4">
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className={clsx("mt-1 text-2xl font-bold tabular-nums", valueColor)}>{value}</p>
      <p className="mt-0.5 text-xs text-text-secondary">{detail}</p>
      {!noBar && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-secondary">
          <div
            className={clsx("h-full rounded-full transition-all", barColor)}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// --- Health Metric Row ---

function HealthMetricRow({
  label,
  value,
  progress,
  barColor,
}: {
  label: string;
  value: string;
  progress: number;
  barColor: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-secondary">{label}</span>
        <span className="font-semibold tabular-nums text-text-primary">{value}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-bg-secondary">
        <div
          className={clsx("h-full rounded-full transition-all", barColor)}
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
    </div>
  );
}
