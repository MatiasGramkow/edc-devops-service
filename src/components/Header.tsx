"use client";

interface HeaderProps {
  theme: "dark" | "light";
  onThemeToggle: () => void;
  onShortcutsOpen: () => void;
  polling: boolean;
  onPollingToggle: () => void;
  userName?: string | null;
  onSignOut?: () => void;
}

export function Header({ theme, onThemeToggle, onShortcutsOpen, polling, onPollingToggle, userName, onSignOut }: HeaderProps) {
  return (
    <header className="border-b border-border-default bg-bg-secondary">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-blue font-bold text-white">
            E
          </div>
          <div>
            <h1 className="text-lg font-bold text-text-primary">
              EDC DevOps Service
            </h1>
            <p className="text-xs text-text-muted">
              edc-group / Relaunch - Charlie Tango
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Auto-refresh toggle */}
          <button
            onClick={onPollingToggle}
            className="rounded-lg p-2 text-text-muted transition-colors hover:bg-bg-card-hover hover:text-text-primary"
            title={polling ? "Auto-refresh ON (30s)" : "Auto-refresh OFF"}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {polling && (
              <span className="absolute -mt-4 ml-2 h-1.5 w-1.5 rounded-full bg-accent-teal animate-pulse" />
            )}
          </button>

          {/* Theme toggle */}
          <button
            onClick={onThemeToggle}
            className="rounded-lg p-2 text-text-muted transition-colors hover:bg-bg-card-hover hover:text-text-primary"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>

          {/* Keyboard shortcuts */}
          <button
            onClick={onShortcutsOpen}
            className="rounded-lg p-2 text-text-muted transition-colors hover:bg-bg-card-hover hover:text-text-primary"
            title="Keyboard shortcuts (?)"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
            </svg>
          </button>

          {/* User */}
          {userName && (
            <div className="ml-2 flex items-center gap-2 border-l border-border-default pl-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-blue/20 text-xs font-bold text-accent-blue">
                {userName.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs text-text-secondary">{userName}</span>
              {onSignOut && (
                <button
                  onClick={onSignOut}
                  className="rounded p-1 text-text-muted transition-colors hover:bg-bg-card-hover hover:text-text-primary"
                  title="Sign out"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
