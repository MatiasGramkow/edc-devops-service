"use client";

import clsx from "clsx";

const typeColors: Record<string, string> = {
  Bug: "bg-type-bug",
  Task: "bg-type-task",
  "User Story": "bg-type-story",
  Feature: "bg-type-feature",
  Epic: "bg-type-epic",
};

export function WorkItemTypeIcon({ type }: { type: string }) {
  const color = typeColors[type] ?? "bg-text-muted";

  return (
    <span
      className={clsx("inline-block h-3 w-3 rounded-sm", color)}
      title={type}
    />
  );
}
