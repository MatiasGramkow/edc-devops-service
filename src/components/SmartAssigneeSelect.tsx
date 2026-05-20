"use client";

import { useMemo } from "react";
import clsx from "clsx";
import type { SprintCapacityData } from "@/types/devops";
import { computeAssigneeSuggestions } from "@/lib/capacity-utils";

interface SmartAssigneeSelectProps {
  value: string;
  onChange: (value: string) => void;
  assignees: string[];
  capacityData?: SprintCapacityData | null;
  activity?: string;
  placeholder?: string;
  className?: string;
}

export function SmartAssigneeSelect({
  value,
  onChange,
  assignees,
  capacityData,
  activity = "Development",
  placeholder = "— Unassigned —",
  className,
}: SmartAssigneeSelectProps) {
  const suggestions = useMemo(
    () => computeAssigneeSuggestions(capacityData ?? null, activity, assignees),
    [capacityData, activity, assignees]
  );

  const hasCapacity = capacityData && capacityData.members.length > 0;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={clsx(
        "rounded-lg border border-border-default bg-bg-secondary px-3 py-1.5 text-sm text-text-primary outline-none focus:border-accent-blue",
        className
      )}
    >
      <option value="">{placeholder}</option>
      {suggestions.map((s) => (
        <option key={s.displayName} value={s.displayName}>
          {s.displayName}
          {hasCapacity && s.availableHours > 0
            ? ` (${s.availableHours}h avail)`
            : hasCapacity && s.capacityPercent > 0
              ? ` (${s.capacityPercent}% used)`
              : ""}
          {s.isSuggested ? " ★" : ""}
        </option>
      ))}
    </select>
  );
}
