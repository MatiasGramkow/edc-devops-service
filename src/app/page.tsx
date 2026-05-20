"use client";

import { Suspense, useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import clsx from "clsx";
import { Header } from "@/components/Header";
import { SprintPlanningView } from "@/components/SprintPlanningView";
import { RefinementView } from "@/components/RefinementView";
import { RetrospectiveView } from "@/components/RetrospectiveView";
import { CreateWorkItemView } from "@/components/CreateWorkItemView";
import { RoadmapView } from "@/components/RoadmapView";
import { DailyStandupView } from "@/components/DailyStandupView";
import { TopdeskInboxView } from "@/components/TopdeskInboxView";
import { KeyboardShortcutsPanel } from "@/components/KeyboardShortcutsPanel";
import type { Iteration, TeamMember } from "@/types/devops";

interface Metadata {
  states: string[];
  allStates: string[];
  types: string[];
  assignees: string[];
}

function useUrlState() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const get = useCallback(
    (key: string, fallback: string) => searchParams.get(key) ?? fallback,
    [searchParams]
  );

  const set = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  return { get, set };
}

export default function Home() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-bg-primary"><div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" /></div>}>
      <HomeContent />
    </Suspense>
  );
}

const TABS = [
  { key: "roadmap", label: "Roadmap" },
  { key: "standup", label: "Standup" },
  { key: "sprint-planning", label: "Sprint Planning" },
  { key: "refinement", label: "Refinement" },
  { key: "retrospective", label: "Retrospective" },
  { key: "topdesk-inbox", label: "TOPdesk Inbox" },
  { key: "create", label: "Create" },
] as const;

type TabKey = typeof TABS[number]["key"];

function HomeContent() {
  const url = useUrlState();

  const activeTab = (url.get("tab", "roadmap") as TabKey);

  const [metadata, setMetadata] = useState<Metadata>({
    states: [],
    allStates: [],
    types: [],
    assignees: [],
  });
  const [iterations, setIterations] = useState<Iteration[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  // Theme
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "light") setTheme("light");
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
      return next;
    });
  }, []);

  // Polling / auto-refresh
  const [polling, setPolling] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const pollCallback = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (polling) {
      pollingRef.current = setInterval(() => {
        pollCallback.current?.();
      }, 30_000);
    } else {
      clearInterval(pollingRef.current);
    }
    return () => clearInterval(pollingRef.current);
  }, [polling]);

  // Keyboard shortcuts panel
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
      }
      if (e.key === "t" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleTheme();
      }
      if (e.key === "p" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setPolling((p) => !p);
      }
      // Tab switching with number keys
      const num = Number(e.key);
      // 1-9 maps to tabs 1-9, 0 maps to tab 10
      const tabIndex = num === 0 ? 9 : num - 1;
      if ((num >= 1 && num <= Math.min(9, TABS.length)) || (num === 0 && TABS.length >= 10)) {
        e.preventDefault();
        const tab = TABS[tabIndex];
        url.set({ tab: tab.key === "roadmap" ? null : tab.key });
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleTheme, url]);


  // Load metadata + iterations + team members on mount
  useEffect(() => {
    fetch("/api/work-items?action=metadata")
      .then((r) => r.json())
      .then((data) => { if (!data.error) setMetadata(data); })
      .catch(() => {});
    fetch("/api/work-items?action=iterations")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setIterations(data); })
      .catch(() => {});
    fetch("/api/team?action=members")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setTeamMembers(data); })
      .catch(() => {});
  }, []);

  const allAssignees = useMemo(() => {
    const set = new Set([...metadata.assignees, ...teamMembers.map((m) => m.displayName)]);
    return [...set].sort();
  }, [metadata.assignees, teamMembers]);

  const [userName, setUserName] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUserName(d?.user?.name ?? null))
      .catch(() => setUserName(null));
  }, []);

  return (
    <div className="min-h-screen bg-bg-primary">
      <Header
        theme={theme}
        onThemeToggle={toggleTheme}
        onShortcutsOpen={() => setShortcutsOpen(true)}
        polling={polling}
        onPollingToggle={() => setPolling((p) => !p)}
        userName={userName}
        onSignOut={() => {
          window.location.href = "/.auth/logout?post_logout_redirect_uri=/";
        }}
      />

      <main className={clsx("space-y-6 py-8", activeTab === "sprint-planning" || activeTab === "refinement" || activeTab === "standup" ? "px-4" : "mx-auto max-w-7xl px-6")}>
        {/* Tab bar */}
        <div className="flex items-center gap-4 overflow-x-auto">
          <div className="flex gap-1 rounded-xl bg-bg-secondary p-1">
            {TABS.map((tab, i) => (
              <button
                key={tab.key}
                onClick={() => url.set({ tab: tab.key === "roadmap" ? null : tab.key })}
                className={clsx(
                  "whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  activeTab === tab.key
                    ? "bg-bg-card text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
                )}
                title={`${tab.label} (${i + 1})`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {polling && (
            <span className="flex items-center gap-1.5 text-[10px] text-accent-teal">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-teal animate-pulse" />
              Auto-refresh
            </span>
          )}
        </div>

        {/* Roadmap tab */}
        {activeTab === "roadmap" && (
          <RoadmapView />
        )}

        {/* Standup tab */}
        {activeTab === "standup" && (
          <DailyStandupView iterations={iterations} />
        )}

        {/* Sprint Planning tab */}
        {activeTab === "sprint-planning" && (
          <SprintPlanningView
            availableStates={metadata.allStates}
            availableAssignees={allAssignees}
            iterations={iterations}
          />
        )}
        {/* Refinement tab */}
        {activeTab === "refinement" && (
          <RefinementView
            availableStates={metadata.allStates}
            availableAssignees={allAssignees}
          />
        )}
        {/* Retrospective tab */}
        {activeTab === "retrospective" && (
          <RetrospectiveView iterations={iterations} />
        )}
        {/* TOPdesk Inbox tab */}
        {activeTab === "topdesk-inbox" && (
          <TopdeskInboxView />
        )}
        {/* Create tab */}
        {activeTab === "create" && (
          <CreateWorkItemView
            iterations={iterations}
            availableAssignees={allAssignees}
          />
        )}
      </main>

      <KeyboardShortcutsPanel
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}
