"use client";

import clsx from "clsx";
import { stalenessLevel, daysSince } from "@/lib/utils";

interface StaleIndicatorProps {
  changedDate: string;
}

const levelConfig = {
  fresh: { color: "bg-stale-fresh", label: "Fresh" },
  aging: { color: "bg-stale-aging", label: "Aging" },
  stale: { color: "bg-stale-stale", label: "Stale" },
  ancient: { color: "bg-stale-ancient", label: "Ancient" },
} as const;

export function StaleIndicator({ changedDate }: StaleIndicatorProps) {
  const days = daysSince(changedDate);
  const level = stalenessLevel(days);
  const config = levelConfig[level];

  return (
    <div className="flex items-center gap-2">
      <span className={clsx("inline-block h-2.5 w-2.5 rounded-full", config.color)} />
      <span className="text-sm text-text-secondary">
        {days}d — {config.label}
      </span>
    </div>
  );
}
