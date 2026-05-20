"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

interface StateSelectorProps {
  currentState: string;
  availableStates: string[];
  onStateChange: (newState: string) => Promise<void>;
}

const stateColors: Record<string, string> = {
  New: "bg-text-muted/15 text-text-muted",
  "To Do": "bg-text-muted/15 text-text-muted",
  Open: "bg-text-muted/15 text-text-muted",
  "In Progress": "bg-accent-blue/15 text-accent-blue",
  "In Review": "bg-accent-gold/15 text-accent-gold",
  "Ready for Test": "bg-accent-gold/15 text-accent-gold",
  Approved: "bg-stale-fresh/15 text-stale-fresh",
  Qualification: "bg-accent-gold/15 text-accent-gold",
  Qualified: "bg-accent-blue/15 text-accent-blue",
  Design: "bg-accent-teal/15 text-accent-teal",
  Done: "bg-stale-fresh/15 text-stale-fresh",
  Closed: "bg-stale-fresh/15 text-stale-fresh",
  Removed: "bg-stale-ancient/15 text-stale-ancient",
};

function getStateColor(state: string): string {
  return stateColors[state] ?? "bg-text-muted/15 text-text-muted";
}

export function StateSelector({ currentState, availableStates, onStateChange }: StateSelectorProps) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        left: rect.right,
      });
    }
  }, [open]);

  // Close on scroll so dropdown doesn't float in wrong position (but not when scrolling inside the dropdown itself)
  useEffect(() => {
    if (!open) return;
    const handleScroll = (e: Event) => {
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [open]);

  async function handleSelect(state: string) {
    if (state === currentState) {
      setOpen(false);
      return;
    }
    setUpdating(true);
    setOpen(false);
    try {
      await onStateChange(state);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        disabled={updating}
        className={clsx(
          "shrink-0 rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
          updating ? "animate-pulse bg-text-muted/15 text-text-muted" : getStateColor(currentState),
          "hover:ring-1 hover:ring-border-focus"
        )}
      >
        {updating ? "..." : currentState}
      </button>

      {open && createPortal(
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Dropdown */}
          <div
            ref={dropdownRef}
            className="fixed z-50 max-h-64 min-w-[140px] overflow-y-auto rounded-lg border border-border-default bg-bg-card py-1 shadow-2xl"
            style={{ top: pos.top, left: pos.left, transform: "translateX(-100%)" }}
          >
            {availableStates.map((state) => (
              <button
                key={state}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(state);
                }}
                className={clsx(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-bg-card-hover",
                  state === currentState ? "text-accent-blue font-medium" : "text-text-secondary"
                )}
              >
                <span className={clsx("inline-block h-2 w-2 rounded-full", getStateColor(state).split(" ")[0].replace("/15", ""))} />
                {state}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
