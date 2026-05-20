"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import clsx from "clsx";
import type { Iteration, VacationOverviewData, SprintVacationData, MemberVacation } from "@/types/devops";

// --- Helpers ---

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function getCurrentIteration(iterations: Iteration[]): Iteration | undefined {
  const now = new Date();
  return iterations.find((i) => i.startDate && i.finishDate && new Date(i.startDate) <= now && new Date(i.finishDate) >= now);
}

function getRelevantIterations(iterations: Iteration[]): Iteration[] {
  const now = new Date();
  return iterations
    .filter((i) => i.startDate && i.finishDate)
    .filter((i) => new Date(i.finishDate!) >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
    .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatDateRange(start: string, end: string): string {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function capacityColor(pct: number): string {
  if (pct >= 80) return "text-stale-fresh";
  if (pct >= 50) return "text-accent-gold";
  return "text-stale-ancient";
}

function capacityBg(pct: number): string {
  if (pct >= 80) return "bg-stale-fresh";
  if (pct >= 50) return "bg-accent-gold";
  return "bg-stale-ancient";
}

// Calculate bar position within a sprint cell
function barPosition(periodStart: string, periodEnd: string, sprintStart: string, sprintEnd: string): { left: string; width: string } {
  const sStart = new Date(sprintStart).getTime();
  const sEnd = new Date(sprintEnd).getTime();
  const duration = sEnd - sStart;
  if (duration <= 0) return { left: "0%", width: "100%" };

  const pStart = Math.max(new Date(periodStart).getTime(), sStart);
  const pEnd = Math.min(new Date(periodEnd).getTime(), sEnd);

  const left = ((pStart - sStart) / duration) * 100;
  const width = Math.max(((pEnd - pStart) / duration) * 100, 3); // min 3% for visibility

  return { left: `${left}%`, width: `${width}%` };
}

// --- Main component ---

interface VacationPlannerViewProps {
  iterations: Iteration[];
}

export function VacationPlannerView({ iterations }: VacationPlannerViewProps) {
  const [data, setData] = useState<VacationOverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startIdx, setStartIdx] = useState<number>(0);
  const [sprintCount, setSprintCount] = useState(4);
  const errorTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const relevant = getRelevantIterations(iterations);
  const currentIteration = getCurrentIteration(iterations);

  function showError(msg: string) {
    setError(msg);
    clearTimeout(errorTimeout.current);
    errorTimeout.current = setTimeout(() => setError(null), 8000);
  }

  // Set initial start index to current sprint
  useEffect(() => {
    if (relevant.length > 0 && currentIteration) {
      const idx = relevant.findIndex((i) => i.id === currentIteration.id);
      if (idx >= 0) setStartIdx(idx);
    }
  }, [iterations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedIterations = relevant.slice(startIdx, startIdx + sprintCount);
  const selectedIds = selectedIterations.map((i) => i.id);

  const fetchData = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/team?action=vacation-overview&iterationIds=${ids.join(",")}`);
      const json = await res.json();
      if (!res.ok) {
        showError(json.error || "Failed to load vacation data");
        return;
      }
      setData(json);
    } catch {
      showError("Could not connect to server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedIds.length > 0) fetchData(selectedIds);
  }, [selectedIds.join(","), fetchData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExport = async () => {
    if (!selectedIds.length) return;
    try {
      const res = await fetch(`/api/team?action=vacation-export&iterationIds=${selectedIds.join(",")}`);
      if (!res.ok) {
        showError("Export failed");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vacation-plan.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showError("Export failed");
    }
  };

  // Collect all unique members across sprints
  const allMembers = (() => {
    if (!data) return [];
    const nameSet = new Set<string>();
    for (const sprint of data.sprints) {
      for (const m of sprint.members) nameSet.add(m.displayName);
    }
    return [...nameSet].sort();
  })();

  // Build a lookup: sprintId -> memberName -> MemberVacation
  const lookup = new Map<string, Map<string, MemberVacation>>();
  if (data) {
    for (const sprint of data.sprints) {
      const memberMap = new Map<string, MemberVacation>();
      for (const m of sprint.members) memberMap.set(m.displayName, m);
      lookup.set(sprint.iterationId, memberMap);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl bg-bg-secondary px-5 py-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted">From</label>
          <select
            value={startIdx}
            onChange={(e) => setStartIdx(Number(e.target.value))}
            className="rounded-lg border border-border-default bg-bg-input px-3 py-1.5 text-sm font-medium text-text-primary focus:border-border-focus focus:outline-none"
          >
            {relevant.map((iter, idx) => (
              <option key={iter.id} value={idx}>
                {iter.name}{currentIteration?.id === iter.id ? " (current)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted">Sprints</label>
          <select
            value={sprintCount}
            onChange={(e) => setSprintCount(Number(e.target.value))}
            className="rounded-lg border border-border-default bg-bg-input px-3 py-1.5 text-sm font-medium text-text-primary focus:border-border-focus focus:outline-none"
          >
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        {data && (
          <div className="flex items-center gap-4 text-sm text-text-secondary">
            <span><span className="font-semibold text-text-primary">{allMembers.length}</span> members</span>
            <span className="text-text-muted">|</span>
            <span><span className="font-semibold text-text-primary">{data.sprints.length}</span> sprints</span>
          </div>
        )}

        <button
          onClick={handleExport}
          disabled={!data || loading}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-bg-card px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-bg-card-hover disabled:opacity-40"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export CSV
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

      {/* Vacation grid */}
      {!loading && data && data.sprints.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border-default">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-bg-secondary">
                <th className="sticky left-0 z-10 border-b border-r border-border-default bg-bg-secondary px-4 py-3 text-left text-xs font-medium text-text-muted w-48">
                  Member
                </th>
                {data.sprints.map((sprint) => (
                  <th
                    key={sprint.iterationId}
                    className={clsx(
                      "border-b border-border-default px-3 py-3 text-center text-xs font-medium min-w-[140px]",
                      currentIteration?.id === sprint.iterationId ? "bg-accent-blue/5 text-accent-blue" : "text-text-muted"
                    )}
                  >
                    <div>{sprint.sprintName}</div>
                    <div className="mt-0.5 text-[10px] font-normal text-text-muted">
                      {formatDateRange(sprint.startDate, sprint.finishDate)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allMembers.map((name) => (
                <tr key={name} className="group hover:bg-bg-card-hover/30">
                  <td className="sticky left-0 z-10 border-b border-r border-border-default bg-bg-card px-4 py-2.5 group-hover:bg-bg-card-hover">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-blue text-[10px] font-bold text-white">
                        {initials(name)}
                      </div>
                      <span className="truncate text-sm font-medium text-text-primary">{name}</span>
                    </div>
                  </td>
                  {data.sprints.map((sprint) => {
                    const memberData = lookup.get(sprint.iterationId)?.get(name);
                    const daysOff = memberData?.daysOff ?? [];
                    const totalDaysOff = memberData?.totalDaysOff ?? 0;
                    return (
                      <td
                        key={sprint.iterationId}
                        className={clsx(
                          "border-b border-border-default px-2 py-2.5",
                          currentIteration?.id === sprint.iterationId && "bg-accent-blue/5"
                        )}
                      >
                        {daysOff.length > 0 ? (
                          <div className="relative h-6 rounded bg-bg-secondary">
                            {daysOff.map((period, idx) => {
                              const pos = barPosition(period.start, period.end, sprint.startDate, sprint.finishDate);
                              return (
                                <div
                                  key={idx}
                                  className="absolute top-0.5 bottom-0.5 rounded border-l-2 border-accent-blue bg-accent-blue/30"
                                  style={{ left: pos.left, width: pos.width }}
                                  title={`${formatDateRange(period.start, period.end)} (${totalDaysOff}d off)`}
                                />
                              );
                            })}
                            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-accent-blue">
                              {totalDaysOff}d
                            </span>
                          </div>
                        ) : (
                          <div className="h-6" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {/* Capacity summary row */}
            <tfoot>
              <tr className="bg-bg-secondary">
                <td className="sticky left-0 z-10 border-r border-border-default bg-bg-secondary px-4 py-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">Capacity</span>
                </td>
                {data.sprints.map((sprint) => (
                  <td key={sprint.iterationId} className={clsx("px-3 py-3 text-center", currentIteration?.id === sprint.iterationId && "bg-accent-blue/5")}>
                    <div className={clsx("text-lg font-bold tabular-nums", capacityColor(sprint.capacityPercent))}>
                      {sprint.capacityPercent}%
                    </div>
                    <div className="mt-1 text-[10px] text-text-muted">
                      {sprint.membersOnVacation > 0
                        ? `${sprint.membersOnVacation} of ${sprint.totalMembers} off`
                        : "Full team"}
                    </div>
                    <div className="mx-auto mt-1.5 h-1.5 w-16 overflow-hidden rounded-full bg-bg-card">
                      <div
                        className={clsx("h-full rounded-full", capacityBg(sprint.capacityPercent))}
                        style={{ width: `${sprint.capacityPercent}%` }}
                      />
                    </div>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Sprint impact cards */}
      {!loading && data && data.sprints.some((s) => s.membersOnVacation > 0) && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Sprint Impact</h3>
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(data.sprints.length, 4)}, 1fr)` }}>
            {data.sprints.map((sprint) => {
              if (sprint.membersOnVacation === 0) return null;
              return (
                <SprintImpactCard key={sprint.iterationId} sprint={sprint} isCurrent={currentIteration?.id === sprint.iterationId} />
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && data && data.sprints.length === 0 && (
        <div className="rounded-xl border border-border-default bg-bg-card px-8 py-16 text-center">
          <p className="text-text-muted">No sprint data available for the selected range</p>
        </div>
      )}

      {!loading && data && data.sprints.length > 0 && allMembers.length === 0 && (
        <div className="rounded-xl border border-border-default bg-bg-card px-8 py-16 text-center">
          <p className="text-text-muted">No team members found with capacity configured</p>
        </div>
      )}

      {!loading && data && data.sprints.length > 0 && allMembers.length > 0 && !data.sprints.some((s) => s.membersOnVacation > 0) && (
        <div className="rounded-xl border border-border-default bg-bg-card px-5 py-4 text-center text-sm text-text-muted">
          No vacation days found for the selected sprints
        </div>
      )}
    </div>
  );
}

// --- Sprint impact card ---

function SprintImpactCard({ sprint, isCurrent }: { sprint: SprintVacationData; isCurrent: boolean }) {
  const membersOff = sprint.members.filter((m) => m.totalDaysOff > 0);

  return (
    <div className={clsx(
      "rounded-xl border p-4",
      sprint.capacityPercent < 50
        ? "border-stale-ancient/30 bg-stale-ancient/5"
        : sprint.capacityPercent < 80
          ? "border-accent-gold/30 bg-accent-gold/5"
          : "border-border-default bg-bg-card"
    )}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text-primary">
          {sprint.sprintName}
          {isCurrent && <span className="ml-1.5 text-[10px] font-normal text-accent-blue">(current)</span>}
        </h4>
        <span className={clsx("text-sm font-bold tabular-nums", capacityColor(sprint.capacityPercent))}>
          {sprint.capacityPercent}%
        </span>
      </div>
      <p className="mt-1 text-xs text-text-secondary">
        {sprint.membersOnVacation} of {sprint.totalMembers} members on vacation
      </p>
      <div className="mt-2.5 space-y-1.5">
        {membersOff.map((m) => (
          <div key={m.displayName} className="flex items-center gap-2 text-xs">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-blue/20 text-[8px] font-bold text-accent-blue">
              {initials(m.displayName)}
            </div>
            <span className="min-w-0 flex-1 truncate text-text-secondary">{m.displayName}</span>
            <span className="tabular-nums text-text-muted">{m.totalDaysOff}d off</span>
          </div>
        ))}
      </div>
    </div>
  );
}
