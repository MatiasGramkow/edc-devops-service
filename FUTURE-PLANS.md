# Future Plans — edc-devops-service

Ideas and planned features for the sprint planning dashboard.

## Team Setup — DONE
- ~~**Team configuration page** — define team members, their default activities (Dev/QA/Release), and default capacity per day~~
- ~~Store team config locally (or sync from Azure DevOps team settings)~~
- **Sprint analytics dashboard** — per-member capacity vs assigned hours, work items grouped by parent PBI, activity breakdown (Dev/QA/Release), completed vs remaining hours
- Support multiple teams / sub-teams
- Role-based views (e.g., "Show only my items")

## Ferieplan (Vacation Planner) — DONE
- ~~**Visual vacation calendar** — overview of team days off per sprint~~
- ~~Import days off from Azure DevOps Capacity API~~
- ~~Highlight sprints with reduced capacity~~
- ~~Show impact on sprint capacity (e.g., "Sprint 27: 3 of 5 members on vacation, 40% capacity")~~
- ~~Export vacation plan (CSV)~~

## Refinement Meeting Support — DONE
- ~~**Refinement tab** — filter items where `Custom.Refinement = true`~~
- ~~Refinement checklist: description complete, acceptance criteria defined, tasks created, tasks estimated (hours)~~
- ~~Track refinement status per item (Not Refined → In Progress → Ready)~~
- ~~Meeting mode: present items one by one with large readable view~~
- ~~**Inline editing** in both list mode and meeting mode: editable description/AC, task creation (Dev/QA/Release/Other presets), inline hours editing~~
- ~~**Mark Ready** → sets `SprintPlanning = true` + `Refinement = false` (moves to sprint planning queue)~~
- ~~Bug support: reads/writes `ReproSteps` field for Bugs instead of `Description`~~

## Cleanup Analysis (Oprydningsanalyse) — DONE
- ~~**Stale item analysis** — scan backlog for items that should be cleaned up~~
- ~~Criteria for flagging items:~~
  - ~~Age: items not updated in X days (configurable: 30/60/90/180/365 days)~~
  - ~~State: items stuck in "New" or "Active" for too long~~
  - ~~No assignee + old~~
  - ~~No children/tasks + old~~
  - Tags: items with specific tags that indicate they're outdated (tags visible in list + CSV, but no auto-flag yet)
- ~~**Dashboard view:**~~
  - ~~Summary: total stale items, breakdown by age bucket~~
  - ~~Sorted list with filters (by state, type, age, assignee)~~
  - ~~Quick actions: open in DevOps, mark for review, add tag~~
- ~~Manual delete only (no auto-delete) — present items, user decides~~
- ~~Batch selection for review/tagging (e.g., tag as "Needs Review")~~
- ~~Export list of flagged items (CSV)~~

## Sprint Retrospective Data — DONE
- ~~Sprint velocity chart (story points completed per sprint)~~
- ~~Burndown data visualization (hours breakdown: completed vs remaining vs estimate)~~
- ~~Carry-over tracking (items that didn't finish and moved to next sprint)~~
- ~~Cross-sprint comparison per team member~~
- ~~Summary cards (avg velocity, total points, items done, carry-over count)~~

## Improved Sprint Planning — DONE
- ~~Drag-and-drop reordering of backlog items~~
- ~~"What-if" planning: preview capacity impact before committing~~
- ~~Sprint goal tracking (text, saved locally per sprint)~~
- ~~Copy task structure from previous similar PBI~~
- ~~Carry-over from current sprint: unfinished items shown in sidebar with batch move to next sprint~~
- ~~**Meeting mode** — area-based picker, fullscreen overlay, area breadcrumbs, progress bar, keyboard nav (m/j/k/Enter/Esc)~~
- ~~**Meeting mode interactivity** — editable assignee, interactive tasks (state/hours/delete), task creation, capacity with what-if~~
- ~~**Meeting mode visual hierarchy** — title 3xl, description/AC primary (text-base white), metadata quiet (text-xs muted), inline assignee~~

## AI Code Summary — DONE
- ~~**AI-powered code summary** in Sprint Planning meeting mode~~
- ~~Searches related codebase (`EDC.EDCDK.Website`) via grep for keywords extracted from work item~~
- ~~GPT-4o-mini generates 3-5 bullet points: what, where in code, approach, risks~~
- ~~Falls back to rule-based summary (file matching + module inference) if no OpenAI API key~~
- ~~"Add to Description" button appends summary to Azure DevOps work item description~~
- ~~Cached 30min server-side + per-session client-side~~

## Sprint Dashboard/Overview — DONE
- ~~**Sprint status dashboard** — current sprint name, dates, days remaining progress bar~~
- ~~Summary cards: capacity %, items progress, hours done, carry-over count~~
- ~~Capacity overview per team member~~
- ~~Carry-over warning banner when sprint ending soon with unfinished work~~
- ~~Unfinished items list from current sprint~~
- ~~**Backlog health score** (0-100) — composite metric: estimate coverage, assignee coverage, average age, pipeline status~~
- ~~Health breakdown: estimates %, assigned %, avg age, pipeline %, oldest items, needs-attention count~~

## Sprint Review — DONE
- ~~**Sprint review tab** — view completed items in a sprint grouped by parent~~
- ~~Meeting/presentation mode (full-width, keyboard nav, like refinement)~~
- ~~**Sprint report export** — self-contained print-friendly HTML in new window~~
- ~~Report includes: sprint summary, sprint goal, completed items grouped by parent, task breakdown, hours totals~~

## Notifications & Alerts
- Capacity overload warnings (when assigning work exceeding capacity)
- Items without estimates alert
- ~~Sprint about to end with unfinished work (carry-over warning in dashboard)~~

## Technical Improvements — DONE
- ~~Server-side caching for iterations API (5min TTL)~~
- ~~Polling for real-time updates (30s auto-refresh toggle)~~
- ~~Keyboard shortcuts reference panel (? key)~~
- ~~Dark/light theme toggle (t key, persisted in localStorage)~~
- ~~Mobile-responsive layout (sprint planning 3-col collapses on mobile)~~
- ~~Tab switching via number keys (1-9)~~
