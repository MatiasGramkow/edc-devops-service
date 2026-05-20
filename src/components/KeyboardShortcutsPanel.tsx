"use client";

import { useEffect, useRef } from "react";

interface KeyboardShortcutsPanelProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { section: "Navigation", items: [
    { keys: ["j", "↓"], desc: "Next item" },
    { keys: ["k", "↑"], desc: "Previous item" },
    { keys: ["1-9", "0"], desc: "Switch tab (0 = 10th)" },
    { keys: ["?"], desc: "Toggle shortcuts panel" },
  ]},
  { section: "Sprint Planning", items: [
    { keys: ["m"], desc: "Toggle meeting mode" },
    { keys: ["Enter"], desc: "Done planning (meeting mode)" },
    { keys: ["d"], desc: "Toggle drag-and-drop mode" },
    { keys: ["Esc"], desc: "Exit meeting mode" },
  ]},
  { section: "Refinement / Review", items: [
    { keys: ["m"], desc: "Toggle meeting mode" },
    { keys: ["Esc"], desc: "Exit meeting mode" },
    { keys: ["r"], desc: "Mark item as ready (refinement)" },
  ]},
  { section: "General", items: [
    { keys: ["t"], desc: "Toggle theme (dark/light)" },
    { keys: ["p"], desc: "Toggle auto-refresh" },
    { keys: ["Esc"], desc: "Close panel / dialog" },
  ]},
];

export function KeyboardShortcutsPanel({ open, onClose }: KeyboardShortcutsPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleClose() { onClose(); }
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-auto max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border-default bg-bg-card p-0 shadow-2xl backdrop:bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="px-6 py-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-text-primary">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-card-hover hover:text-text-primary"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-5 space-y-6">
          {SHORTCUTS.map((section) => (
            <div key={section.section}>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-text-muted">{section.section}</h3>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <div key={item.desc} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-bg-primary">
                    <span className="text-sm text-text-secondary">{item.desc}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((key) => (
                        <kbd
                          key={key}
                          className="min-w-[24px] rounded-md border border-border-default bg-bg-secondary px-2 py-0.5 text-center text-xs font-mono text-text-primary shadow-sm"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </dialog>
  );
}
