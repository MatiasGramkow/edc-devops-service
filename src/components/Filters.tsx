"use client";

import { useCallback } from "react";
import clsx from "clsx";

export type AgeField = "updated" | "created";

interface FiltersProps {
  maxAgeDays: number;
  onMaxAgeDaysChange: (days: number) => void;
  ageField: AgeField;
  onAgeFieldChange: (field: AgeField) => void;
  states: string[];
  onStatesChange: (states: string[]) => void;
  types: string[];
  onTypesChange: (types: string[]) => void;
  availableStates: string[];
  availableTypes: string[];
  availableAssignees: string[];
  assignedTo: string | null;
  onAssignedToChange: (assignee: string | null) => void;
}

const AGE_PRESETS = [
  { label: "30+ days", value: 30 },
  { label: "60+ days", value: 60 },
  { label: "90+ days", value: 90 },
  { label: "180+ days", value: 180 },
  { label: "365+ days", value: 365 },
];

export function Filters({
  maxAgeDays,
  onMaxAgeDaysChange,
  ageField,
  onAgeFieldChange,
  states,
  onStatesChange,
  types,
  onTypesChange,
  availableStates,
  availableTypes,
  availableAssignees,
  assignedTo,
  onAssignedToChange,
}: FiltersProps) {
  const toggleState = useCallback(
    (state: string) => {
      onStatesChange(
        states.includes(state) ? states.filter((s) => s !== state) : [...states, state]
      );
    },
    [states, onStatesChange]
  );

  const toggleType = useCallback(
    (type: string) => {
      onTypesChange(
        types.includes(type) ? types.filter((t) => t !== type) : [...types, type]
      );
    },
    [types, onTypesChange]
  );

  return (
    <div className="space-y-5 rounded-xl border border-border-default bg-bg-card p-5">
      <div>
        <div className="mb-2 flex items-center gap-3">
          <label className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Age
          </label>
          <div className="flex rounded-md border border-border-default bg-bg-secondary p-0.5">
            <button
              onClick={() => onAgeFieldChange("updated")}
              className={clsx(
                "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                ageField === "updated"
                  ? "bg-accent-blue text-white"
                  : "text-text-muted hover:text-text-primary"
              )}
            >
              Not updated since
            </button>
            <button
              onClick={() => onAgeFieldChange("created")}
              className={clsx(
                "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                ageField === "created"
                  ? "bg-accent-blue text-white"
                  : "text-text-muted hover:text-text-primary"
              )}
            >
              Created more than
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {AGE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              onClick={() => onMaxAgeDaysChange(preset.value)}
              className={clsx(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                maxAgeDays === preset.value
                  ? "bg-accent-blue text-white"
                  : "bg-bg-input text-text-secondary hover:bg-bg-card-hover hover:text-text-primary"
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {availableStates.length > 0 && (
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-muted">
            State
          </label>
          <div className="flex flex-wrap gap-2">
            {availableStates.map((state) => (
              <button
                key={state}
                onClick={() => toggleState(state)}
                className={clsx(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  states.includes(state)
                    ? "bg-accent-teal text-white"
                    : "bg-bg-input text-text-secondary hover:bg-bg-card-hover hover:text-text-primary"
                )}
              >
                {state}
              </button>
            ))}
          </div>
        </div>
      )}

      {availableTypes.length > 0 && (
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-muted">
            Type
          </label>
          <div className="flex flex-wrap gap-2">
            {availableTypes.map((type) => (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={clsx(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  types.includes(type)
                    ? "bg-accent-gold text-white"
                    : "bg-bg-input text-text-secondary hover:bg-bg-card-hover hover:text-text-primary"
                )}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
      )}

      {availableAssignees.length > 0 && (
        <div>
          <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-muted">
            Assigned to
          </label>
          <select
            value={assignedTo ?? ""}
            onChange={(e) => onAssignedToChange(e.target.value || null)}
            className="rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-border-focus"
          >
            <option value="">All</option>
            {availableAssignees.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
