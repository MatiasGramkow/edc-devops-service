"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import clsx from "clsx";
import type { Iteration, DailyStandupData, MemberStandupData, WorkItemStateChange, BlockedItem } from "@/types/devops";
import { WorkItemTypeIcon } from "@/components/WorkItemTypeIcon";

// --- Color helpers ---

function stateColor(state: string): string {
  switch (state) {
    case "New": return "bg-accent-blue/15 text-accent-blue";
    case "Active": case "In Progress": return "bg-accent-gold/15 text-accent-gold";
    case "Resolved": return "bg-accent-teal/15 text-accent-teal";
    case "Done": case "Closed": return "bg-stale-fresh/15 text-stale-fresh";
    case "Removed": return "bg-text-muted/15 text-text-muted";
    default: return "bg-text-muted/15 text-text-muted";
  }
}

function riskColor(score: number): string {
  if (score <= 35) return "text-stale-fresh";
  if (score <= 65) return "text-accent-gold";
  return "text-stale-ancient";
}

function riskBg(score: number): string {
  if (score <= 35) return "bg-stale-fresh";
  if (score <= 65) return "bg-accent-gold";
  return "bg-stale-ancient";
}

function trajectoryBadge(trajectory: "on-track" | "at-risk" | "behind"): { text: string; color: string } {
  switch (trajectory) {
    case "on-track": return { text: "On Track", color: "bg-stale-fresh/15 text-stale-fresh" };
    case "at-risk": return { text: "At Risk", color: "bg-accent-gold/15 text-accent-gold" };
    case "behind": return { text: "Behind", color: "bg-stale-ancient/15 text-stale-ancient" };
  }
}

function capacityBarColor(pct: number): string {
  if (pct > 100) return "bg-stale-ancient";
  if (pct > 80) return "bg-accent-gold";
  return "bg-accent-blue";
}

// --- Sub-components ---

function StateTransition({ change }: { change: WorkItemStateChange }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-secondary px-3 py-2">
      <WorkItemTypeIcon type={change.type} />
      <a
        href={change.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-text-muted hover:text-accent-blue"
      >
        #{change.workItemId}
      </a>
      <span className="flex-1 truncate text-sm text-text-primary">{change.title}</span>
      <span className="inline-flex items-center gap-1 text-xs">
        <span className={clsx("rounded px-1.5 py-0.5", stateColor(change.oldState))}>
          {change.oldState}
        </span>
        <svg className="h-3 w-3 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
        </svg>
        <span className={clsx("rounded px-1.5 py-0.5", stateColor(change.newState))}>
          {change.newState}
        </span>
      </span>
    </div>
  );
}

function BlockerCard({ blocker }: { blocker: BlockedItem }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-stale-ancient/30 bg-stale-ancient/5 px-3 py-2">
      <WorkItemTypeIcon type={blocker.type} />
      <a
        href={blocker.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-text-muted hover:text-accent-blue"
      >
        #{blocker.id}
      </a>
      <span className="flex-1 truncate text-sm text-text-primary">{blocker.title}</span>
      {blocker.reason === "tagged" ? (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-stale-ancient/15 text-stale-ancient">Blocked</span>
      ) : (
        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-accent-gold/15 text-accent-gold">
          Stuck {blocker.daysSinceChange}d
        </span>
      )}
      {blocker.remainingWork != null && (
        <span className="text-xs text-text-muted">{blocker.remainingWork}h</span>
      )}
    </div>
  );
}

function ActiveItemRow({ item }: { item: { id: number; title: string; type: string; state: string; remainingWork: number | null; priority: number; url: string } }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-secondary px-3 py-2">
      <WorkItemTypeIcon type={item.type} />
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-text-muted hover:text-accent-blue"
      >
        #{item.id}
      </a>
      <span className="flex-1 truncate text-sm text-text-primary">{item.title}</span>
      <span className={clsx("rounded px-1.5 py-0.5 text-[10px] font-medium", stateColor(item.state))}>
        {item.state}
      </span>
      {item.remainingWork != null && (
        <span className="text-xs text-text-muted">{item.remainingWork}h</span>
      )}
    </div>
  );
}

// --- Sprint Pulse Banner ---

function SprintPulseBanner({ data }: { data: DailyStandupData }) {
  const { pulse } = data;
  const badge = trajectoryBadge(pulse.trajectory);
  const circumference = 2 * Math.PI * 36;
  const dashOffset = circumference - (pulse.riskScore / 100) * circumference;

  return (
    <div className="rounded-xl border border-border-default bg-bg-card p-4">
      <div className="flex items-center gap-6">
        {/* Risk gauge */}
        <div className="relative h-20 w-20 flex-shrink-0">
          <svg className="h-20 w-20 -rotate-90" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeWidth="6" className="text-bg-secondary" />
            <circle
              cx="40" cy="40" r="36" fill="none" strokeWidth="6"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              className={riskColor(pulse.riskScore)}
              stroke="currentColor"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={clsx("text-lg font-bold", riskColor(pulse.riskScore))}>{pulse.riskScore}</span>
            <span className="text-[9px] text-text-muted">RISK</span>
          </div>
        </div>

        {/* Sprint info */}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-text-primary">{data.sprintName}</h3>
            <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-medium", badge.color)}>
              {badge.text}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-4 text-xs text-text-muted">
            <span>Day {pulse.daysElapsed} of {pulse.totalDays}</span>
            <span>{pulse.daysRemaining} days remaining</span>
          </div>
          {/* Progress bar */}
          <div className="mt-2 h-1.5 w-full max-w-xs rounded-full bg-bg-secondary">
            <div
              className={clsx("h-1.5 rounded-full transition-all", riskBg(pulse.riskScore))}
              style={{ width: `${Math.min(100, Math.round((pulse.daysElapsed / Math.max(1, pulse.totalDays)) * 100))}%` }}
            />
          </div>
        </div>

        {/* Mini metrics */}
        <div className="flex gap-4">
          <MiniMetric
            label="Capacity"
            value={`${pulse.capacityRisk}%`}
            color={pulse.capacityRisk > 65 ? "text-stale-ancient" : pulse.capacityRisk > 35 ? "text-accent-gold" : "text-stale-fresh"}
          />
          <MiniMetric
            label="Stuck"
            value={String(pulse.stuckItems.length)}
            color={pulse.stuckItems.length > 0 ? "text-stale-ancient" : "text-stale-fresh"}
          />
          <MiniMetric
            label="Time"
            value={`${pulse.timeRisk}%`}
            color={pulse.timeRisk > 65 ? "text-stale-ancient" : pulse.timeRisk > 35 ? "text-accent-gold" : "text-stale-fresh"}
          />
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center">
      <div className={clsx("text-lg font-bold", color)}>{value}</div>
      <div className="text-[10px] text-text-muted">{label}</div>
    </div>
  );
}

// --- Member Sidebar Card ---

function MemberCard({
  member,
  selected,
  onClick,
}: {
  member: MemberStandupData;
  selected: boolean;
  onClick: () => void;
}) {
  const initial = member.displayName.charAt(0).toUpperCase();
  const capPct = member.capacity
    ? member.capacity.totalCapacity > 0
      ? Math.round((member.capacity.totalAssigned / member.capacity.totalCapacity) * 100)
      : 0
    : null;

  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-accent-blue/40 bg-bg-card"
          : "border-border-default bg-bg-secondary hover:bg-bg-card"
      )}
    >
      {/* Avatar */}
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-accent-blue/15 text-sm font-medium text-accent-blue">
        {initial}
      </div>

      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium text-text-primary">{member.displayName}</div>
        <div className="flex items-center gap-2 mt-0.5">
          {member.stats.changesYesterday > 0 && (
            <span className="text-[10px] text-accent-blue">{member.stats.changesYesterday} changes</span>
          )}
          <span className="text-[10px] text-text-muted">{member.stats.activeItems} active</span>
          {member.stats.blockerCount > 0 && (
            <span className="text-[10px] text-stale-ancient">{member.stats.blockerCount} blocked</span>
          )}
        </div>
      </div>

      {/* Capacity mini-bar */}
      {capPct !== null && (
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[10px] text-text-muted">{member.stats.remainingHours}h</span>
          <div className="h-1 w-12 rounded-full bg-bg-primary">
            <div
              className={clsx("h-1 rounded-full", capacityBarColor(capPct))}
              style={{ width: `${Math.min(100, capPct)}%` }}
            />
          </div>
        </div>
      )}
    </button>
  );
}

// --- Member Detail Panel ---

function MemberDetail({ member }: { member: MemberStandupData }) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-text-primary">{member.displayName}</h2>
        {member.capacity && (
          <span className="text-sm text-text-muted">
            {member.capacity.totalAssigned}h / {member.capacity.totalCapacity}h capacity
          </span>
        )}
      </div>

      {/* Yesterday */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-medium text-accent-blue">Yesterday</h3>
          <span className="rounded-full bg-accent-blue/10 px-2 py-0.5 text-[10px] font-medium text-accent-blue">
            {member.yesterday.length}
          </span>
        </div>
        {member.yesterday.length === 0 ? (
          <p className="text-sm text-text-muted italic">No state changes recorded</p>
        ) : (
          <div className="space-y-1.5">
            {member.yesterday.map((change, i) => (
              <StateTransition key={`${change.workItemId}-${i}`} change={change} />
            ))}
          </div>
        )}
      </section>

      {/* Today */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-medium text-accent-gold">Today</h3>
          <span className="rounded-full bg-accent-gold/10 px-2 py-0.5 text-[10px] font-medium text-accent-gold">
            {member.today.length}
          </span>
          {member.stats.remainingHours > 0 && (
            <span className="text-xs text-text-muted">{member.stats.remainingHours}h remaining</span>
          )}
        </div>
        {member.today.length === 0 ? (
          <p className="text-sm text-text-muted italic">No active items</p>
        ) : (
          <div className="space-y-1.5">
            {member.today.map((item) => (
              <ActiveItemRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      {/* Blockers */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="text-sm font-medium text-stale-ancient">Blockers</h3>
          <span className={clsx(
            "rounded-full px-2 py-0.5 text-[10px] font-medium",
            member.blockers.length > 0
              ? "bg-stale-ancient/10 text-stale-ancient"
              : "bg-stale-fresh/10 text-stale-fresh"
          )}>
            {member.blockers.length}
          </span>
        </div>
        {member.blockers.length === 0 ? (
          <p className="text-sm text-stale-fresh">No blockers</p>
        ) : (
          <div className="space-y-1.5">
            {member.blockers.map((blocker) => (
              <BlockerCard key={blocker.id} blocker={blocker} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// --- Meeting Mode ---

function MeetingMode({
  members,
  onExit,
}: {
  members: MemberStandupData[];
  onExit: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);

  // Sort: members with blockers first, then by change count, then alphabetical
  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      if (a.stats.blockerCount !== b.stats.blockerCount) return b.stats.blockerCount - a.stats.blockerCount;
      if (a.stats.changesYesterday !== b.stats.changesYesterday) return b.stats.changesYesterday - a.stats.changesYesterday;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [members]);

  const current = sortedMembers[currentIndex];

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, sortedMembers.length - 1));
  }, [sortedMembers.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); goNext(); }
      if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); goPrev(); }
      if (e.key === "Escape") { e.preventDefault(); onExit(); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev, onExit]);

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-primary">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border-default bg-bg-secondary px-6 py-3">
        <div className="flex items-center gap-4">
          <button
            onClick={goPrev}
            disabled={currentIndex === 0}
            className="rounded-lg border border-border-default px-3 py-1 text-sm text-text-muted hover:text-text-primary disabled:opacity-30"
          >
            ← Prev
          </button>
          <span className="text-sm text-text-muted">
            {currentIndex + 1} of {sortedMembers.length}
          </span>
          <button
            onClick={goNext}
            disabled={currentIndex === sortedMembers.length - 1}
            className="rounded-lg border border-border-default px-3 py-1 text-sm text-text-muted hover:text-text-primary disabled:opacity-30"
          >
            Next →
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted">j/k navigate · Esc exit</span>
          <button
            onClick={onExit}
            className="rounded-lg border border-border-default px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"
          >
            Exit Meeting
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-bg-secondary">
        <div
          className="h-1 bg-accent-blue transition-all"
          style={{ width: `${((currentIndex + 1) / sortedMembers.length) * 100}%` }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-4xl">
          {/* Member name */}
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-blue/15 text-2xl font-bold text-accent-blue">
              {current.displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-3xl font-bold text-text-primary">{current.displayName}</h1>
              {current.capacity && (
                <p className="text-sm text-text-muted">
                  {current.capacity.totalAssigned}h assigned / {current.capacity.totalCapacity}h capacity
                  {current.capacity.activities.map((a) => (
                    <span key={a.name} className="ml-3">
                      {a.name}: {a.assignedHours}/{a.capacityHours}h
                    </span>
                  ))}
                </p>
              )}
            </div>
          </div>

          {/* Yesterday */}
          <div className="mb-6 rounded-xl border border-border-default bg-bg-card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-accent-blue">
              Yesterday
              <span className="rounded-full bg-accent-blue/10 px-2.5 py-0.5 text-sm font-medium text-accent-blue">
                {current.yesterday.length}
              </span>
            </h2>
            {current.yesterday.length === 0 ? (
              <p className="text-base text-text-muted italic">No state changes recorded</p>
            ) : (
              <div className="space-y-2">
                {current.yesterday.map((change, i) => (
                  <StateTransition key={`${change.workItemId}-${i}`} change={change} />
                ))}
              </div>
            )}
          </div>

          {/* Today */}
          <div className="mb-6 rounded-xl border border-border-default bg-bg-card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-accent-gold">
              Today
              <span className="rounded-full bg-accent-gold/10 px-2.5 py-0.5 text-sm font-medium text-accent-gold">
                {current.today.length}
              </span>
              {current.stats.remainingHours > 0 && (
                <span className="text-sm font-normal text-text-muted">{current.stats.remainingHours}h remaining</span>
              )}
            </h2>
            {current.today.length === 0 ? (
              <p className="text-base text-text-muted italic">No active items</p>
            ) : (
              <div className="space-y-2">
                {current.today.map((item) => (
                  <ActiveItemRow key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>

          {/* Blockers */}
          <div className={clsx(
            "rounded-xl border bg-bg-card p-5",
            current.blockers.length > 0
              ? "border-l-4 border-stale-ancient/40 border-l-stale-ancient"
              : "border-border-default"
          )}>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-stale-ancient">
              Blockers
              <span className={clsx(
                "rounded-full px-2.5 py-0.5 text-sm font-medium",
                current.blockers.length > 0
                  ? "bg-stale-ancient/10 text-stale-ancient"
                  : "bg-stale-fresh/10 text-stale-fresh"
              )}>
                {current.blockers.length}
              </span>
            </h2>
            {current.blockers.length === 0 ? (
              <p className="text-base text-stale-fresh">No blockers</p>
            ) : (
              <div className="space-y-2">
                {current.blockers.map((blocker) => (
                  <BlockerCard key={blocker.id} blocker={blocker} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Main Component ---

interface DailyStandupViewProps {
  iterations: Iteration[];
}

export function DailyStandupView({ iterations }: DailyStandupViewProps) {
  const [data, setData] = useState<DailyStandupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [meetingMode, setMeetingMode] = useState(false);
  const [stuckDays, setStuckDays] = useState(3);

  // Find current sprint
  const currentSprint = useMemo(() => {
    const now = new Date();
    return iterations.find(
      (i) =>
        i.startDate &&
        i.finishDate &&
        new Date(i.startDate) <= now &&
        new Date(i.finishDate) >= now
    );
  }, [iterations]);

  const fetchStandup = useCallback(async () => {
    if (!currentSprint) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/work-items?action=standup&iterationId=${currentSprint.id}&stuckDays=${stuckDays}`
      );
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      if (json.members.length > 0 && !selectedMember) {
        setSelectedMember(json.members[0].displayName);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [currentSprint, stuckDays, selectedMember]);

  useEffect(() => {
    fetchStandup();
  }, [fetchStandup]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (meetingMode) return; // meeting mode handles its own keys

      if (e.key === "m") {
        e.preventDefault();
        if (data && data.members.length > 0) setMeetingMode(true);
      }
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        if (data) {
          const idx = data.members.findIndex((m) => m.displayName === selectedMember);
          if (idx < data.members.length - 1) setSelectedMember(data.members[idx + 1].displayName);
        }
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        if (data) {
          const idx = data.members.findIndex((m) => m.displayName === selectedMember);
          if (idx > 0) setSelectedMember(data.members[idx - 1].displayName);
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [data, selectedMember, meetingMode]);

  const selectedMemberData = data?.members.find((m) => m.displayName === selectedMember);

  // Summary stats
  const totalChanges = data?.members.reduce((s, m) => s + m.stats.changesYesterday, 0) ?? 0;
  const totalActive = data?.members.reduce((s, m) => s + m.stats.activeItems, 0) ?? 0;
  const totalBlockers = (data?.members.reduce((s, m) => s + m.stats.blockerCount, 0) ?? 0) + (data?.unassignedBlockers.length ?? 0);

  if (!currentSprint) {
    return (
      <div className="flex items-center justify-center py-20 text-text-muted">
        No active sprint found
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <p className="text-stale-ancient">{error}</p>
        <button
          onClick={fetchStandup}
          className="mt-4 rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <>
      {meetingMode && (
        <MeetingMode
          members={data.members}
          onExit={() => setMeetingMode(false)}
        />
      )}

      <div className="space-y-4">
        {/* Sprint Pulse */}
        <SprintPulseBanner data={data} />

        {/* Summary bar */}
        <div className="flex items-center justify-between rounded-xl border border-border-default bg-bg-card px-4 py-3">
          <div className="flex items-center gap-4 text-sm text-text-muted">
            <span>{totalChanges} changes yesterday</span>
            <span className="text-border-default">|</span>
            <span>{totalActive} active items</span>
            <span className="text-border-default">|</span>
            <span className={totalBlockers > 0 ? "text-stale-ancient font-medium" : ""}>
              {totalBlockers} blockers
            </span>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-text-muted">
              Stuck threshold:
              <select
                value={stuckDays}
                onChange={(e) => setStuckDays(Number(e.target.value))}
                className="rounded border border-border-default bg-bg-secondary px-2 py-1 text-xs text-text-primary"
              >
                <option value={2}>2 days</option>
                <option value={3}>3 days</option>
                <option value={5}>5 days</option>
                <option value={7}>7 days</option>
              </select>
            </label>
            <button
              onClick={() => setMeetingMode(true)}
              className="rounded-lg bg-accent-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-blue/80"
            >
              Start Meeting
            </button>
            <button
              onClick={fetchStandup}
              className="rounded-lg border border-border-default p-1.5 text-text-muted hover:text-text-primary"
              title="Refresh"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="flex gap-4" style={{ minHeight: "calc(100vh - 320px)" }}>
          {/* Left: member cards */}
          <div className="w-80 flex-shrink-0 space-y-1.5 overflow-y-auto">
            {data.members.map((member) => (
              <MemberCard
                key={member.displayName}
                member={member}
                selected={selectedMember === member.displayName}
                onClick={() => setSelectedMember(member.displayName)}
              />
            ))}
            {data.unassignedBlockers.length > 0 && (
              <div className="mt-3 rounded-lg border border-stale-ancient/30 bg-stale-ancient/5 p-3">
                <h4 className="mb-2 text-xs font-medium text-stale-ancient">
                  Unassigned Blockers ({data.unassignedBlockers.length})
                </h4>
                <div className="space-y-1">
                  {data.unassignedBlockers.map((b) => (
                    <div key={b.id} className="flex items-center gap-1.5 text-xs text-text-muted">
                      <WorkItemTypeIcon type={b.type} />
                      <span>#{b.id}</span>
                      <span className="truncate">{b.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: detail panel */}
          <div className="flex-1 overflow-y-auto rounded-xl border border-border-default bg-bg-card p-5">
            {selectedMemberData ? (
              <MemberDetail member={selectedMemberData} />
            ) : (
              <div className="flex h-full items-center justify-center text-text-muted">
                Select a team member
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
