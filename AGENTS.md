# AGENTS.md — Expert Advisory Panel

## How to use this file

Before responding to a user prompt, evaluate whether one or more of the expert agents below would add value. **Consult an agent when the task touches their domain.** You do not need to spawn all agents every time — pick the relevant ones based on the task.

**When to consult agents:**
- Feature design/planning → PM + Scrum Master + UX Designer
- API/backend changes → DevOps Expert
- UI/component work → UX Designer
- Sprint workflow changes → Scrum Master + PM
- Performance/caching → DevOps Expert
- New tab/view → All four

**When NOT to consult agents:**
- Simple bug fixes with clear cause
- Copy/text changes
- Config/env changes
- User asked for a quick specific change

---

## Agent Definitions

### 1. DevOps Expert (Azure DevOps API & Infrastructure)

**Role:** Senior Azure DevOps specialist. Evaluates API integration, WIQL queries, caching, batch operations, and data architecture.

**Consult when:** API route changes, new data queries, caching strategy, performance optimization, Azure DevOps field usage, bulk operations, rate limiting concerns.

**Key findings from initial review:**

#### High Priority
- **Cache sprint capacity config** (not workload) with 2-3 min TTL — eliminates 2 API calls per refresh
- **Add concurrency limit to `bulkUpdateIterationPath`** — currently fires all requests simultaneously, should use concurrency=5 like `deleteWorkItems`
- **Combine sprint-planning + carry-over into single WIQL query** — saves one full round-trip
- **WIQL input sanitization** — `iterationPath` and `assignedTo` are interpolated directly into WIQL strings

#### Medium Priority
- **Delta refresh for polling** — query `System.ChangedDate > lastFetchTime` instead of re-fetching everything
- **Use `ASOF` WIQL clause** for accurate carry-over detection in retrospective
- **Extract shared tree-building function** — the WIQL→fetch→expand→tree pattern is repeated ~5 times (~200 lines duplication)
- **Activity-aware what-if preview** — match task activity type to member capacity per activity
- **Use `ORDER BY StackRank`** instead of `Priority ASC, ChangedDate DESC` to match Azure DevOps board ordering
- **Add retry logic with exponential backoff** for transient 429/503 errors

#### Underutilized Azure DevOps APIs
- **Work Item Revisions API** (`/revisions`) — for accurate carry-over tracking (count how many sprints an item has been carried over)
- **Work Item Updates API** (`/updates`) — for burndown data (timestamped state changes)
- **Team Settings API** (`/teamsettings`) — working days config (currently hardcodes Mon-Fri)
- **State Transitions API** (`/transitions`) — show only valid next states in StateSelector
- **Batch Work Item Update API** (`/workitemsbatch`) — true batch in single HTTP request

---

### 2. Scrum Master (Agile Process & Ceremonies)

**Role:** Experienced Scrum Master and Agile coach. Evaluates ceremony support, workflow effectiveness, sprint health metrics, and team dynamics.

**Consult when:** Sprint workflow changes, ceremony support, metrics/KPIs, team capacity planning, process improvements, new views that support Scrum events.

**Key findings from initial review:**

#### Critical Gaps
1. **No Daily Scrum/Standup support** — the most frequent ceremony has zero tooling. Need a "Today" view showing per-member: yesterday's state changes, today's active tasks, impediments
2. **No sprint burndown chart** — the most important in-sprint tracking artifact. Dashboard shows snapshot, not trajectory. Data available via Azure DevOps Updates API
3. **Retrospective is purely quantitative** — velocity charts and member comparisons exist, but no space for qualitative "what went well / what to improve / action items"

#### Sprint Planning Improvements
- **Add sprint commitment summary** — after planning: total hours committed vs capacity, per-member balance, per-activity balance
- **Surface hours comparison during planning** — summary bar should show committed hours vs capacity, flag when over
- **Show refinement readiness in planning sidebar** — the 4-check score from Refinement is invisible in Sprint Planning; items marked ready via override arrive without warning
- **Pre-populate by priority** — add "sort by priority" option (P1 first across all parents)
- **Batch capacity preview** — select multiple items, show aggregate capacity impact
- **Timer/timebox indicator** — visible countdown for meeting discipline
- **"Quick plan" mode** — for well-refined items (4/4 checklist): show only title, hours, assignee, confirm button

#### Missing Scrum Artifacts
- **Sprint Goal should be visible on every tab** — currently only in Planning + Dashboard + Review
- **Definition of Done checklist** — refinement has "Definition of Ready" (4 checks), but no equivalent DoD enforcement before marking items complete
- **Impediment/blocker tracking** — no way to flag blocked items, record impediments, or track resolution
- **Sprint goal achievement tracking** — goal is text-only, no way to link it to completed items or mark as achieved/partially achieved

#### Workflow Concerns
- **Refinement-to-Planning state machine is fragile** — two boolean fields (`Custom.Refinement`, `Custom.SprintPlanning`) can get out of sync if edited manually in Azure DevOps
- **Capacity model is task-hours based** — this is the team's primary estimation unit, which is good; ensure all views consistently use remaining hours as the metric
- **No automatic state transitions** — when all child tasks are Done, parent PBI stays in current state
- **Rate limit (30 RPM) may block planning meetings** — a "Done planning" action = 5+ requests; rapid planning easily hits limit

---

### 3. UX Designer (Frontend & Interaction Design)

**Role:** Senior Frontend UX Designer specializing in productivity tools and dashboards. Evaluates layout, interaction patterns, visual hierarchy, cognitive load, and accessibility.

**Consult when:** UI/component changes, new views/tabs, layout modifications, interaction pattern changes, meeting mode features, accessibility concerns.

**Key findings from initial review:**

#### Critical UX Gaps
1. **No meeting mode for Sprint Planning** — Refinement and Review have meeting mode, but Sprint Planning (the most meeting-oriented tab) does not. The 3-column layout with 10-11px text is too dense for a projected screen. Need full-width, one-item-at-a-time, large text, capacity as bottom bar
2. **Center panel content order is wrong** — description/AC is at the bottom, below task creation form. Should be: Header → Description/AC → Tasks → Create Task → Action bar (sticky bottom)
3. **No undo for "Done planning"** — once committed, item disappears; need a 5-second undo toast (Gmail pattern)

#### High Impact
- **"Done planning" action bar should be sticky bottom** — currently placed mid-panel, breaking the "review then decide" flow
- **Add session progress tracking** — "5 of 12 planned" counter with progress bar in summary bar
- **Add total hours to sidebar items** — `SidebarItem` component shows task count and hours but the hours breakdown (remaining vs completed) could be more prominent
- **Group tabs visually** — Sprint Lifecycle (Dashboard, Refinement, Planning, Review, Retro) vs Management (PBI Tree, Team, Vacation, Cleanup). Use a visual divider, not nested nav
- **Batch "Done planning"** — multi-select checkboxes + batch commit, matching the carry-over batch pattern

#### Medium Impact
- **Collapse task creation form by default** when tasks already exist
- **Minimum 11px text size** — several places use 9-10px (`text-[9px]`, `text-[10px]`) which is illegible on projectors
- **Implement `Enter` key for "Done planning"** — documented in shortcuts panel but not implemented
- **Add "Skip"/"Defer" action** — for items the team decides to postpone without committing
- **Sort StateSelector by workflow order** — group active states vs terminal states, not flat alphabetical list
- **Carry-over items need persistent visual distinction** — subtle gold left border, not just gold section header

#### Color & Feedback
- **Add icons to toast messages** — success/error distinguished by color only; needs checkmark/warning icon for color-blind users
- **Capacity bar thresholds need explanation** — no legend for blue/gold/red meaning
- **"Done planning" (teal) vs "Carry over" (gold)** appear in same position — add context label above button

---

### 4. Project Manager (Planning Efficiency & Stakeholder Visibility)

**Role:** Senior IT Project Manager focused on agile delivery, sprint commitments, risk identification, and reporting.

**Consult when:** Planning workflow changes, reporting features, risk/health metrics, cross-sprint planning, stakeholder-facing views, workload balancing, priority management.

**Key findings from initial review:**

#### Top 5 Highest-Impact Recommendations
1. **Show planned hours vs capacity in Sprint Planning sidebar** — the core PM question: "Can we deliver what we're committing to?"
2. **Add sprint burndown/burn-up chart to Dashboard** — snapshot data insufficient for trajectory-based decisions
3. **Surface dependency and blocker information** — `$expand=all` already returns dependency links (`System.LinkTypes.Dependency-Forward/Reverse`) but they're not parsed
4. **Persist drag-and-drop priority order** — team's planning decisions lost on refresh; save to `data/` like sprint goals
5. **Add activity-level team capacity totals** — "Dev: 120/140h | QA: 30/45h | Release: 8/15h" in capacity sidebar

#### Risk & Health
- **No blocker/impediment tracking** — Azure DevOps `System.Tags` "Blocked" and `Microsoft.VSTS.CMMI.Blocked` field not surfaced
- **No dependency visualization** — predecessor/successor links invisible during planning
- **No "unestimated items in sprint" warning** — items with tasks having null remaining hours not flagged on Dashboard
- **Overcommitment only visible after tasks assigned** — what-if preview requires child tasks with assignees and hours

#### Reporting Gaps
- **No "Sprint Commitment Report"** at planning time — snapshot of what was committed for stakeholder communication
- **No estimate accuracy tracking** — completed hours / original estimate ratio would improve future planning
- **No lead time / cycle time metrics** — available from Azure DevOps state change history
- **No utilization efficiency metric** — completed hours / capacity hours per member per sprint

#### Cross-Sprint Planning
- **No multi-sprint roadmap view** — PM managing a quarterly release needs Sprint N | N+1 | N+2 | Backlog columns
- **No way to compare capacity across future sprints** side-by-side in Sprint Planning
- **Sprint goals cannot be set for future sprints** from current planning view

#### Workload Balancing
- **No "suggested assignee"** based on remaining capacity per activity
- **No burnout risk indicator** — flag members at >90% utilization for 3+ consecutive sprints
- **No workload heatmap** — team-level activity imbalance not visible

---

## Completed Improvements

| # | Improvement | Status |
|---|------------|--------|
| 1 | **Meeting mode for Sprint Planning** | DONE — area-based picker, fullscreen overlay, breadcrumbs |
| 5 | **Reorder center panel (description above tasks)** | DONE — description/AC prominent, metadata quiet |
| 6 | **Sticky "Done planning" action bar** | DONE — bottom bar in meeting mode |
| 7 | **Session progress tracking** | DONE — progress bar + area breadcrumbs |
| + | **AI Code Summary** | DONE — grep EDC.EDCDK.Website + GPT-4o-mini, "Add to Description" |

## Remaining Priority Roadmap

| # | Improvement | Agents | Effort |
|---|------------|--------|--------|
| 2 | **Hours summary in planning sidebar + historical hours comparison** | PM, Scrum, UX | Medium |
| 3 | **Sprint burndown chart on Dashboard** | Scrum, PM, DevOps | Medium |
| 4 | **Sprint commitment summary** | Scrum, PM, UX | Medium |
| 8 | **Undo for "Done planning"** | UX, Scrum | Small |
| 9 | **Blocker/dependency visibility** | PM, DevOps, Scrum | Medium |
| 10 | **Cache capacity + delta refresh** | DevOps | Medium |
