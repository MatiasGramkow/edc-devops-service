"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import clsx from "clsx";
import type { Iteration, SprintVelocity, CarryOverItem, MemberSprintComparison } from "@/types/devops";
import { WorkItemTypeIcon } from "./WorkItemTypeIcon";

interface RetrospectiveViewProps {
  iterations: Iteration[];
}

// --- SVG Bar Chart ---

function BarChart({ data, field, label, color, unit }: {
  data: SprintVelocity[];
  field: "completedHours" | "completedItems" | "originalEstimateHours";
  label: string;
  color: string;
  unit?: string;
}) {
  if (data.length === 0) return null;

  const values = data.map((d) => d[field]);
  const max = Math.max(...values, 1);
  const barWidth = Math.min(60, Math.floor(600 / data.length) - 8);
  const chartWidth = data.length * (barWidth + 8) + 40;
  const chartHeight = 200;
  const plotHeight = 160;

  const avg = values.reduce((s, v) => s + v, 0) / values.length;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="text-sm font-semibold text-text-primary">{label}</h4>
        <span className="text-xs text-text-muted">
          avg: <span className="font-mono font-semibold text-text-secondary">{Math.round(avg * 10) / 10}{unit ? ` ${unit}` : ""}</span>
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg bg-bg-primary p-3">
        <svg width={chartWidth} height={chartHeight} className="block">
          {/* Grid lines */}
          {[0.25, 0.5, 0.75, 1].map((pct) => (
            <line
              key={pct}
              x1={30}
              y1={plotHeight - plotHeight * pct + 10}
              x2={chartWidth}
              y2={plotHeight - plotHeight * pct + 10}
              stroke="var(--color-border-default)"
              strokeWidth={0.5}
              strokeDasharray="4 4"
              opacity={0.4}
            />
          ))}
          {/* Avg line */}
          <line
            x1={30}
            y1={plotHeight - (avg / max) * plotHeight + 10}
            x2={chartWidth}
            y2={plotHeight - (avg / max) * plotHeight + 10}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="6 3"
            opacity={0.5}
          />
          {/* Bars */}
          {data.map((d, i) => {
            const val = d[field];
            const barHeight = max > 0 ? (val / max) * plotHeight : 0;
            const x = 40 + i * (barWidth + 8);
            const y = plotHeight - barHeight + 10;

            return (
              <g key={d.iterationId}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx={4}
                  fill={color}
                  opacity={0.85}
                />
                {/* Value label */}
                <text
                  x={x + barWidth / 2}
                  y={y - 4}
                  textAnchor="middle"
                  className="text-[10px] font-mono"
                  fill="var(--color-text-secondary)"
                >
                  {Math.round(val * 10) / 10}{unit === "h" ? "h" : ""}
                </text>
                {/* Sprint label */}
                <text
                  x={x + barWidth / 2}
                  y={plotHeight + 28}
                  textAnchor="middle"
                  className="text-[9px]"
                  fill="var(--color-text-muted)"
                >
                  {d.sprintName.replace(/.*\\/, "").replace(/Sprint\s*/i, "S")}
                </text>
              </g>
            );
          })}
          {/* Y axis label */}
          <text x={2} y={10} className="text-[9px]" fill="var(--color-text-muted)">{Math.round(max)}</text>
          <text x={2} y={plotHeight + 10} className="text-[9px]" fill="var(--color-text-muted)">0</text>
        </svg>
      </div>
    </div>
  );
}

// --- Hours stacked bars ---

function HoursBreakdownChart({ data }: { data: SprintVelocity[] }) {
  if (data.length === 0) return null;

  const maxHours = Math.max(...data.map((d) => d.completedHours + d.remainingHours), 1);
  const barWidth = Math.min(60, Math.floor(600 / data.length) - 8);
  const chartWidth = data.length * (barWidth + 8) + 40;
  const chartHeight = 200;
  const plotHeight = 160;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="text-sm font-semibold text-text-primary">Hours Breakdown</h4>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-accent-teal" /> Completed</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-accent-gold" /> Remaining</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: "var(--color-border-default)" }} /> Estimate</span>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg bg-bg-primary p-3">
        <svg width={chartWidth} height={chartHeight} className="block">
          {data.map((d, i) => {
            const total = d.completedHours + d.remainingHours;
            const completedH = maxHours > 0 ? (d.completedHours / maxHours) * plotHeight : 0;
            const remainingH = maxHours > 0 ? (d.remainingHours / maxHours) * plotHeight : 0;
            const estimateH = maxHours > 0 ? (d.originalEstimateHours / maxHours) * plotHeight : 0;
            const x = 40 + i * (barWidth + 8);

            return (
              <g key={d.iterationId}>
                {/* Estimate outline */}
                <rect
                  x={x - 1}
                  y={plotHeight - estimateH + 10 - 1}
                  width={barWidth + 2}
                  height={estimateH + 2}
                  rx={4}
                  fill="none"
                  stroke="var(--color-border-default)"
                  strokeWidth={1}
                  strokeDasharray="3 2"
                  opacity={0.5}
                />
                {/* Remaining (top) */}
                <rect
                  x={x}
                  y={plotHeight - completedH - remainingH + 10}
                  width={barWidth}
                  height={remainingH}
                  rx={4}
                  fill="var(--color-accent-gold)"
                  opacity={0.7}
                />
                {/* Completed (bottom) */}
                <rect
                  x={x}
                  y={plotHeight - completedH + 10}
                  width={barWidth}
                  height={completedH}
                  rx={0}
                  fill="var(--color-accent-teal)"
                  opacity={0.85}
                />
                {/* Total label */}
                <text
                  x={x + barWidth / 2}
                  y={plotHeight - completedH - remainingH + 6}
                  textAnchor="middle"
                  className="text-[10px] font-mono"
                  fill="var(--color-text-secondary)"
                >
                  {Math.round(total)}h
                </text>
                {/* Sprint label */}
                <text
                  x={x + barWidth / 2}
                  y={plotHeight + 28}
                  textAnchor="middle"
                  className="text-[9px]"
                  fill="var(--color-text-muted)"
                >
                  {d.sprintName.replace(/.*\\/, "").replace(/Sprint\s*/i, "S")}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// --- Carry-over list ---

function CarryOverList({ items }: { items: CarryOverItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-default/40 py-6 text-center text-sm text-text-muted/50">
        No carry-over items found
      </div>
    );
  }

  const totalHours = items.reduce((s, i) => s + (i.remainingWork ?? 0), 0);

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className="rounded-full bg-stale-stale/15 px-2.5 py-0.5 text-xs font-semibold text-stale-stale">
          {items.length} items
        </span>
        {totalHours > 0 && (
          <span className="rounded-full bg-accent-gold/10 px-2.5 py-0.5 text-xs font-semibold text-accent-gold">
            {Math.round(totalHours * 10) / 10}h remaining
          </span>
        )}
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 rounded-lg bg-bg-primary px-3 py-2"
          >
            <WorkItemTypeIcon type={item.type} />
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate text-sm text-text-secondary hover:text-accent-blue"
            >
              #{item.id} {item.title}
            </a>
            <span className={clsx(
              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
              item.state === "New" ? "bg-text-muted/10 text-text-muted" :
              item.state === "Active" ? "bg-accent-blue/15 text-accent-blue" :
              "bg-accent-gold/15 text-accent-gold"
            )}>
              {item.state}
            </span>
            {item.remainingWork != null && item.remainingWork > 0 && (
              <span className="shrink-0 text-xs font-mono text-accent-gold">{item.remainingWork}h</span>
            )}
            {item.assignedTo && (
              <span className="hidden shrink-0 w-28 truncate text-xs text-text-muted lg:block">{item.assignedTo}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Member comparison table ---

function MemberComparisonTable({ data, sprintNames }: {
  data: MemberSprintComparison[];
  sprintNames: string[];
}) {
  const [metric, setMetric] = useState<"completedHours" | "completedItems" | "remainingHours" | "capacityHours">("completedHours");

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-default/40 py-6 text-center text-sm text-text-muted/50">
        No member data available
      </div>
    );
  }

  const labels: Record<string, string> = {
    completedHours: "Completed Hours",
    completedItems: "Completed Items",
    remainingHours: "Remaining Hours",
    capacityHours: "Capacity Hours",
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => (
          <button
            key={key}
            onClick={() => setMetric(key as typeof metric)}
            className={clsx(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              metric === key ? "bg-accent-blue/15 text-accent-blue" : "text-text-muted hover:text-text-secondary"
            )}
          >
            {labels[key]}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border-default">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-default bg-bg-secondary">
              <th className="px-3 py-2 text-left text-xs font-semibold text-text-muted">Member</th>
              {sprintNames.map((name) => (
                <th key={name} className="px-3 py-2 text-right text-xs font-semibold text-text-muted">
                  {name.replace(/.*\\/, "").replace(/Sprint\s*/i, "S")}
                </th>
              ))}
              <th className="px-3 py-2 text-right text-xs font-semibold text-text-muted">Avg</th>
            </tr>
          </thead>
          <tbody>
            {data.map((member) => {
              const vals = member.sprints.map((s) => s[metric]);
              const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
              const maxVal = Math.max(...vals, 1);

              return (
                <tr key={member.displayName} className="border-b border-border-default/30 last:border-b-0">
                  <td className="px-3 py-2 font-medium text-text-primary">{member.displayName}</td>
                  {member.sprints.map((sprint, i) => {
                    const val = sprint[metric];
                    const pct = maxVal > 0 ? val / maxVal : 0;
                    return (
                      <td key={i} className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-12 rounded-full bg-bg-secondary">
                            <div
                              className="h-full rounded-full bg-accent-blue"
                              style={{ width: `${pct * 100}%` }}
                            />
                          </div>
                          <span className="w-10 text-right font-mono text-xs tabular-nums text-text-secondary">
                            {Math.round(val * 10) / 10}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-mono text-xs font-semibold tabular-nums text-accent-gold">
                    {Math.round(avg * 10) / 10}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Main component ---

export function RetrospectiveView({ iterations }: RetrospectiveViewProps) {
  const [sprintCount, setSprintCount] = useState(6);
  const [velocityData, setVelocityData] = useState<SprintVelocity[]>([]);
  const [carryOverItems, setCarryOverItems] = useState<CarryOverItem[]>([]);
  const [memberComparison, setMemberComparison] = useState<MemberSprintComparison[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"throughput" | "hours" | "carryover" | "members">("throughput");

  // Get recent completed sprints
  const recentSprints = useMemo(() => {
    const now = new Date();
    return iterations
      .filter((i) => i.startDate && i.finishDate && new Date(i.finishDate) <= now)
      .sort((a, b) => new Date(b.startDate!).getTime() - new Date(a.startDate!).getTime())
      .slice(0, sprintCount)
      .reverse();
  }, [iterations, sprintCount]);

  // Also include current sprint
  const currentSprint = useMemo(() => {
    const now = new Date();
    return iterations.find((i) =>
      i.startDate && i.finishDate &&
      new Date(i.startDate) <= now && new Date(i.finishDate) >= now
    );
  }, [iterations]);

  const selectedSprints = useMemo(() => {
    const sprints = [...recentSprints];
    if (currentSprint && !sprints.some((s) => s.id === currentSprint.id)) {
      sprints.push(currentSprint);
    }
    return sprints;
  }, [recentSprints, currentSprint]);

  const selectedIds = useMemo(() => selectedSprints.map((s) => s.id), [selectedSprints]);

  const fetchData = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      // Fetch velocity data
      const velRes = await fetch(`/api/work-items?action=velocity&iterationIds=${selectedIds.join(",")}`);
      const velData = await velRes.json();
      if (Array.isArray(velData)) setVelocityData(velData);

      // Fetch carry-over for the last two sprints
      if (selectedSprints.length >= 2) {
        const from = selectedSprints[selectedSprints.length - 2];
        const to = selectedSprints[selectedSprints.length - 1];
        const coRes = await fetch(`/api/work-items?action=carry-over&fromIterationId=${from.id}&toIterationId=${to.id}`);
        const coData = await coRes.json();
        if (coData.items) setCarryOverItems(coData.items);
      }

      // Fetch member comparison
      const mcRes = await fetch(`/api/work-items?action=member-comparison&iterationIds=${selectedIds.join(",")}`);
      const mcData = await mcRes.json();
      if (Array.isArray(mcData)) setMemberComparison(mcData);
    } catch {
      setError("Failed to load retrospective data");
    } finally {
      setLoading(false);
    }
  }, [selectedIds, selectedSprints]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const sprintNames = velocityData.map((d) => d.sprintName);

  // Summary stats — hours-based
  const totalCompletedHours = velocityData.reduce((s, d) => s + d.completedHours, 0);
  const totalCompletedItems = velocityData.reduce((s, d) => s + d.completedItems, 0);
  const avgHoursPerSprint = velocityData.length > 0 ? totalCompletedHours / velocityData.length : 0;
  const totalEstimateHours = velocityData.reduce((s, d) => s + d.originalEstimateHours, 0);

  const sections = [
    { key: "throughput" as const, label: "Throughput" },
    { key: "hours" as const, label: "Hours" },
    { key: "carryover" as const, label: "Carry-over" },
    { key: "members" as const, label: "Members" },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-text-primary">Sprint Retrospective</h2>
          <p className="mt-1 text-sm text-text-muted">Throughput, hours, carry-over, and member comparison</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-text-muted">Sprints:</label>
          <select
            value={sprintCount}
            onChange={(e) => setSprintCount(Number(e.target.value))}
            className="rounded-lg border border-border-default bg-bg-input px-3 py-1.5 text-sm text-text-primary outline-none focus:border-border-focus"
          >
            {[3, 4, 5, 6, 8, 10].map((n) => (
              <option key={n} value={n}>Last {n}</option>
            ))}
          </select>
          <button
            onClick={fetchData}
            disabled={loading}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-bg-card-hover hover:text-text-primary disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-stale-ancient/30 bg-stale-ancient/10 px-5 py-3 text-sm text-stale-ancient">
          {error}
        </div>
      )}

      {/* Summary cards — hours-focused */}
      {!loading && velocityData.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-border-default bg-bg-card px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Avg Completed</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-accent-blue">{Math.round(avgHoursPerSprint)}<span className="text-sm font-normal text-text-muted">h / sprint</span></p>
          </div>
          <div className="rounded-xl border border-border-default bg-bg-card px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Total Completed</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-accent-teal">{Math.round(totalCompletedHours)}<span className="text-sm font-normal text-text-muted">h</span></p>
          </div>
          <div className="rounded-xl border border-border-default bg-bg-card px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Items Done</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-text-primary">{totalCompletedItems}</p>
          </div>
          <div className="rounded-xl border border-border-default bg-bg-card px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-text-muted">Carry-over</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-stale-stale">{carryOverItems.length} <span className="text-sm font-normal text-text-muted">items</span></p>
          </div>
        </div>
      )}

      {/* Section tabs */}
      <div className="flex gap-1 rounded-xl bg-bg-secondary p-1">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setActiveSection(s.key)}
            className={clsx(
              "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              activeSection === s.key
                ? "bg-bg-card text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-secondary"
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
        </div>
      ) : (
        <div className="rounded-xl border border-border-default bg-bg-card p-6">
          {activeSection === "throughput" && (
            <div className="space-y-8">
              <BarChart data={velocityData} field="completedHours" label="Completed Hours per Sprint" color="var(--color-accent-blue)" unit="h" />
              <BarChart data={velocityData} field="completedItems" label="Items Completed per Sprint" color="var(--color-accent-teal)" />
            </div>
          )}

          {activeSection === "hours" && (
            <HoursBreakdownChart data={velocityData} />
          )}

          {activeSection === "carryover" && (
            <div>
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-text-primary">
                  Carry-over: {selectedSprints.length >= 2 ? `${selectedSprints[selectedSprints.length - 2].name} → ${selectedSprints[selectedSprints.length - 1].name}` : "—"}
                </h3>
                <p className="mt-1 text-xs text-text-muted">Items created before the current sprint that are still active</p>
              </div>
              <CarryOverList items={carryOverItems} />
            </div>
          )}

          {activeSection === "members" && (
            <div>
              <h3 className="mb-4 text-sm font-semibold text-text-primary">Cross-Sprint Member Comparison</h3>
              <MemberComparisonTable data={memberComparison} sprintNames={sprintNames} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
