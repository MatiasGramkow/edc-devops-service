# CLAUDE.md — EDC DevOps Service

## Expert Advisory Panel

**Read `AGENTS.md` before starting work.** It defines 4 expert agents (DevOps Expert, Scrum Master, UX Designer, Project Manager) with domain-specific findings and recommendations. Before responding to a prompt, evaluate which agents are relevant and consult their guidance. For feature work, spawn the relevant agents for fresh analysis. For simple fixes, use the documented findings as context without spawning.

## Project overview

Local Next.js 15 dashboard for Azure DevOps sprint planning and work item management (org: `edc-group`, project: `Relaunch - Charlie Tango`). PBI tree view with inline editing, task creation, sprint planning, team analytics, and cleanup of old/stale items.

**UI language: English.**

## Tech stack

- **Next.js 15** (App Router, React 19)
- **TypeScript 5.8**
- **Tailwind CSS 4** (via `@tailwindcss/postcss`)
- **Yarn** (classic)
- **Node 20** (`.nvmrc` — `npm run dev` auto-uses Node 20 via PATH override in package.json)

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server at http://localhost:3000 (auto-uses Node 20) |
| `yarn build` | Production build |
| `yarn lint` | ESLint check |

## Project structure

```
edc-devops-service/
├── .env.local                          # PAT + config (gitignored)
├── .nvmrc                              # Node 20
├── data/
│   ├── team-config.json                # Local team config (gitignored)
│   └── sprint-goals.json              # Sprint goals (gitignored)
├── next.config.ts                      # Security headers, poweredByHeader: false
├── package.json
├── tsconfig.json                       # Path alias: @/* -> ./src/*
├── postcss.config.mjs                  # Tailwind 4 plugin
└── src/
    ├── app/
    │   ├── layout.tsx                  # Root layout + theme init script
    │   ├── page.tsx                    # Main page — tabs: Dashboard, PBI tree, Sprint Planning, Refinement, Review, Team, Vacation, Cleanup, Retrospective, Create
    │   ├── globals.css                 # Tailwind @theme with dark EDC palette
    │   └── api/
    │       ├── work-items/
    │       │   └── route.ts            # GET/PATCH/POST/DELETE — full CRUD + comments
    │       ├── team/
    │       │   └── route.ts            # GET/PUT/PATCH/POST/DELETE — team config + sprint analytics
    │       ├── image-proxy/
    │       │   └── route.ts            # GET — proxies Azure DevOps images with PAT auth
    │       ├── ai-summary/
    │       │   └── route.ts            # POST — AI-powered code summary for work items
    │       └── create-work-item/
    │           ├── route.ts            # POST — create PBI/Bug with optional child tasks + parent link
    │           └── ai/
    │               └── route.ts        # POST — AI transformation of TOPdesk text into structured work item
    ├── components/
    │   ├── Header.tsx                  # Top header with project info
    │   ├── Filters.tsx                 # Age, state, type, assignee filters
    │   ├── PbiTreeView.tsx             # PBI cards with expand → detail panel + child tasks
    │   ├── PbiDetailPanel.tsx          # Inline PBI editing: description, comments, state, assignee, sprint, task creation
    │   ├── SprintPlanningView.tsx      # Sprint planning: 3-col layout (sidebar grouped by parent, detail, sticky capacity)
    │   ├── TeamSetupView.tsx           # Team analytics dashboard + team settings (collapsible)
    │   ├── StateSelector.tsx           # Portal-rendered state dropdown (color-coded)
    │   ├── ConfirmDialog.tsx           # Reusable confirmation dialog (<dialog>)
    │   ├── RefinementView.tsx           # Refinement meeting: list + meeting mode, inline editing (desc/AC/tasks/hours), checklist, assignee editing
    │   ├── RichHtmlContent.tsx          # Shared: rich HTML renderer with image proxy + lightbox (zoom/pan)
    │   ├── VacationPlannerView.tsx      # Vacation calendar: members × sprints grid, capacity impact, CSV export
    │   ├── CleanupAnalysisView.tsx      # Cleanup analysis: stale item scanning, flagging, bulk tag/delete, CSV export
    │   ├── RetrospectiveView.tsx       # Sprint retrospective: velocity chart, hours breakdown, carry-over, member comparison
    │   ├── SprintDashboardView.tsx    # Dashboard: sprint status, capacity, backlog health, carry-over warning
    │   ├── SprintReviewView.tsx       # Sprint review: completed items, meeting mode, HTML report export
    │   ├── KeyboardShortcutsPanel.tsx  # Keyboard shortcuts dialog (? key)
    │   ├── StaleIndicator.tsx          # Color-coded age indicator (fresh/aging/stale/ancient)
    │   ├── CreateWorkItemView.tsx       # Create PBI/Bug: paste TOPdesk text → AI analysis → review → create
    │   └── WorkItemTypeIcon.tsx        # Colored type icon (Bug/Task/Story/Feature/Epic)
    ├── lib/
    │   ├── devops-client.ts            # Azure DevOps REST API client (WIQL, CRUD, comments, iterations, team members, sprint analytics, velocity, carry-over)
    │   ├── team-config.ts              # Local team config file I/O (data/team-config.json)
    │   ├── sprint-goals.ts             # Sprint goals file I/O (data/sprint-goals.json)
    │   ├── ai-summary.ts                # AI code summary: keyword extraction, codebase grep, OpenAI GPT-4o-mini integration
    │   ├── topdesk-ai.ts               # TOPdesk → Azure DevOps AI transformation: rule-based + GPT-4o-mini
    │   ├── cache.ts                    # In-memory server-side cache with TTL
    │   ├── rate-limit.ts               # In-memory sliding window rate limiter
    │   └── utils.ts                    # daysSince, formatDate, stalenessLevel
    └── types/
        └── devops.ts                   # WorkItem, WorkItemWithChildren, WorkItemDetails, Iteration, TeamMember, TeamConfig, SprintWorkItem, MemberAnalytics, SprintAnalyticsData, etc.
```

## Architecture

### Security
- **PAT** lives in `.env.local` — never exposed to the client
- All Azure DevOps API calls go through **server-side route handlers** (`/api/work-items`)
- **Rate limiting**: sliding window, configurable via `RATE_LIMIT_RPM` env var (default 30/min)
- **Security headers**: X-Frame-Options DENY, X-Content-Type-Options nosniff, strict referrer policy
- **ID validation**: positive integers, server-side check before API calls
- Bulk delete max 200 per request server-side; client chunks in batches of 50

### API route (`/api/work-items`)

**GET:**
- `?action=metadata` — unique states, types, assignees + all valid states from process definitions
- `?action=pbi-tree&maxAgeDays=90&ageField=updated|created&states=...&types=...&assignedTo=...` — PBI tree with child tasks
- `?action=sprint-planning` — PBIs/Bugs with `Custom.SprintPlanning = true` in backlog, grouped by parent
- `?action=unfinished-sprint&iterationPath=...` — PBIs/Bugs/User Stories in a sprint that are NOT Done/Closed/Removed (carry-over candidates)
- `?action=completed-sprint&iterationPath=...` — PBIs/Bugs/User Stories in a sprint with state Done/Closed (for sprint review)
- `?action=backlog-health` — backlog health score + metrics (estimates, assignees, age, pipeline status)
- `?action=refinement` — PBIs/Bugs with `Custom.Refinement = true`, grouped by parent
- `?action=cleanup-analysis&minAgeDays=30` — PBIs/Bugs/User Stories not updated in X days, with child counts for stale item analysis
- `?action=sprint-capacity&iterationId=...` — team capacity + workload for a sprint (per-member, per-activity)
- `?action=details&id=123` — full work item details (description, acceptance criteria, comments, board column)
- `?action=iterations` — team sprint iterations (cached 5min server-side)
- `?action=velocity&iterationIds=id1,id2,...` — velocity data for multiple sprints (story points, items, hours)
- `?action=carry-over&fromIterationId=...&toIterationId=...` — carry-over items between sprints
- `?action=member-comparison&iterationIds=id1,id2,...` — per-member stats across multiple sprints
- `?action=pbi-task-structure&id=123` — child task structure of a PBI (for copy)
- `?action=sprint-goals&iterationId=...` — get sprint goal text

**PATCH:**
- `{ id, state }` — update work item state
- `{ id, comment }` — add a comment to a work item
- `{ id, fields: { iterationPath?, description?, acceptanceCriteria?, assignedTo?, sprintPlanning?, refinement?, tags?, storyPoints?, remainingWork?, originalEstimate? }, workItemType? }` — update work item fields (workItemType needed for Bug description → ReproSteps)
- `{ ids: [...], iterationPath }` — bulk update iteration path (for moving children with sprint)
- `{ sprintGoal: { iterationId, text } }` — save sprint goal text

**POST:**
- `{ parentId, title, iterationPath, remainingWork, activity, tags, assignedTo }` — create child task

**DELETE:**
- `{ id }` — delete single work item
- `{ ids: [...] }` — bulk delete (max 200)

### API route (`/api/team`)

**GET:**
- `?action=config` — full team config (all members + metadata)
- `?action=members` — active members only
- `?action=sync` — fetch team members from Azure DevOps Teams API (does not auto-save)
- `?action=sprint-analytics&iterationId=...` — per-member sprint analytics (capacity + all work items + stats)
- `?action=vacation-overview&iterationIds=id1,id2,...` — vacation data for multiple sprints (days off per member, capacity impact)
- `?action=vacation-export&iterationIds=id1,id2,...` — CSV export of vacation plan

**PUT:** `{ members: [...] }` — save entire team config

**PATCH:** `{ id, fields: { defaultActivity?, capacityPerDay?, active? } }` — update single member

**POST:** `{ displayName, email?, defaultActivity?, capacityPerDay? }` — add new member

**DELETE:** `{ id }` — remove member from config

### API route (`/api/image-proxy`)

**GET:**
- `?url=<encoded-azure-devops-url>` — proxies image requests to Azure DevOps with PAT auth
- Only allows URLs from the configured org (`dev.azure.com/{org}/` or `{org}.visualstudio.com/`)
- Returns image bytes with original content-type, cached 24h (`Cache-Control: public, max-age=86400, immutable`)

### Rich HTML content (`RichHtmlContent.tsx`)
- **Shared component** used by RefinementView, SprintPlanningView, and PbiDetailPanel
- Sanitizes HTML preserving safe tags (`p`, `img`, `a`, `ul`, `ol`, `table`, `strong`, `code`, etc.), strips `script`/`style`/event handlers
- Rewrites Azure DevOps `<img>` src URLs to go through `/api/image-proxy` for authenticated access
- **Image lightbox**: click any image to open fullscreen overlay with zoom (click/scroll to toggle 2.5x) and pan (drag when zoomed)
- Styled with `.prose-devops` CSS class in `globals.css`

### Team config storage (`team-config.ts`)
- Stored as JSON in `data/team-config.json` (gitignored — local per user)
- Created on first save; `data/` directory created automatically
- No database needed — single-user local tool

### Sprint goals storage (`sprint-goals.ts`)
- Stored as JSON in `data/sprint-goals.json` (gitignored)
- One goal per sprint (iterationId → text)
- Saved on blur from Sprint Planning's goal editor

### Azure DevOps API integration (`devops-client.ts`)
- Uses **WIQL** (Work Item Query Language) to find work items
- Fetches details in **batches of 200** (API limit)
- PBI tree: fetches PBIs with `$expand=all`, parses `System.LinkTypes.Hierarchy-Forward` relations (children), fetches children in separate batches
- Sprint planning: also parses `System.LinkTypes.Hierarchy-Reverse` relations (parent) for grouping by Feature/Epic
- Sprint capacity: fetches `work/teamsettings/iterations/{id}/capacities` + `teamdaysoff`, queries task workload via WIQL, calculates per-member capacity hours vs assigned hours
- Comments: uses `wit/workitems/{id}/comments` API (v7.1-preview.4)
- Iterations: uses `work/teamsettings/iterations` API
- Task creation: JSON Patch operations with parent link via `System.LinkTypes.Hierarchy-Reverse`
- Team members: fetches from `_apis/projects/{project}/teams/{teamId}/members` API, de-duplicates by displayName
- Sprint analytics: queries ALL items in sprint (including Done/Closed/Removed), fetches with `$expand=all` for parent relations, groups by assignee, merges with capacity data
- **Bug description field**: Bugs use `Microsoft.VSTS.TCM.ReproSteps` instead of `System.Description`. `fetchWorkItemDetails` reads both fields (ReproSteps as fallback), `updateWorkItemFields` writes to the correct field based on `workItemType` param
- Valid Activity values: `Development`, `QA`, `Release`
- Bulk delete: **concurrency 5** (5 parallel DELETE requests)
- `fetchWorkItemsBatch()` is the shared helper — `expand: true` uses `$expand=all` (no fields param), `expand: false` uses `fields` param

### Dashboard tab (default landing page)
- **Sprint status header**: current sprint name, date range, days remaining with progress bar
- **4 summary cards**: capacity utilization %, items progress (done/total), hours (completed/total), carry-over count
- **Capacity overview**: per-member horizontal bars showing assigned vs capacity hours
- **Backlog health score** (0-100): composite metric from estimate coverage (30%), assignee coverage (20%), average age (25%), pipeline health (25%)
  - Breakdown: estimates %, assigned %, avg age, in-pipeline %
  - Top 5 oldest items list
  - "Needs attention" badge for items without assignee + no children + >30 days old
- **Sprint goal**: read-only display from `data/sprint-goals.json`
- **Carry-over warning**: amber banner when ≤3 days remaining AND unfinished items exist
- **Unfinished items list**: collapsible, shows type icon, ID, title, state, remaining hours
- **Data sources**: sprint-capacity, unfinished-sprint, sprint-goals, backlog-health, velocity (all fetched in parallel)

### Sprint Review tab
- **Sprint selector**: dropdown, defaults to current sprint
- **Two modes**: List Mode (sidebar + detail) and Meeting Mode (full-width presentation, toggle with `m` key)
- **List Mode**: sidebar with completed items grouped by parent + detail panel showing selected item's tasks and hours
- **Meeting Mode**: full-screen presentation of each completed item, keyboard nav (j/k/arrows), Esc to exit
- **Summary bar**: completed count, total hours, meeting mode toggle, report button, refresh
- **Generate Report**: opens self-contained print-friendly HTML in new window with sprint summary, completed items grouped by parent, task breakdown, hours totals
- **Data source**: `?action=completed-sprint&iterationPath=...` + `?action=sprint-goals&iterationId=...`

### Sprint Planning tab
- **Two modes**: List Mode (3-column layout) and Meeting Mode (full-screen presentation)
- **Meeting Mode** (`m` key or "Meeting" button):
  - **Area picker**: select which parent groups (Features/Epics) and/or carry-over items to plan. If only one group, starts directly
  - **Full-screen overlay** with edge-to-edge two-column layout: description/AC (left, primary focus) + tasks/capacity (right, interactive)
  - **Area-scoped navigation**: j/k navigates within selected areas. Top bar shows current area name, position within area, and overall progress
  - **Area breadcrumbs**: visual trail of all selected areas with status (current/completed/pending)
  - **Visual hierarchy optimized for projection**: title `text-3xl`, description/AC `text-base text-text-primary`, metadata row `text-xs text-text-muted` with inline assignee
  - **Full interactivity**: editable assignee, interactive TaskRow (state/hours/delete), task creation (Dev/QA/Release/Other), capacity with what-if preview
  - **AI Code Summary**: "Generate AI Code Summary" button searches related codebase (`EDC.EDCDK.Website`) for relevant files, generates summary via GPT-4o-mini (or rule-based fallback). "Add to Description" appends summary to Azure DevOps description. Cached per session
  - **Bottom action bar**: sprint selector + "Done planning"/"Carry over" button. `Enter` key to commit
  - **Carry-over items**: gold left border + "Carry-over" badge + gold action button
- **List Mode**: edge-to-edge three-column layout: sticky sidebar (items grouped by parent) + center detail panel + sticky capacity sidebar
- **Capacity sidebar**: per-member capacity vs assigned hours broken down by activity (Development/QA/Release), color-coded progress bars (blue=ok, gold=>80%, red=over), team total
- **"Done planning"**: moves PBI + active children to target sprint, sets `Custom.SprintPlanning = false`, auto-selects next item, refreshes capacity
- **Sprint selectors**: show `(current)` and `(next)` labels, "Move to sprint" defaults to next sprint (current+1)
- **PBI assignee**: editable via `<select>` dropdown (saves immediately on change)
- **Rich HTML rendering**: description and AC render full HTML with embedded images (proxied + lightbox with zoom/pan)
- **Items grouped by parent**: sidebar groups items under their parent Feature/Epic title
- **Custom fields**: `Custom.SprintPlanning` (boolean), `Custom.Refinement` (boolean) on PBI/Bug work items
- **Carry-over section**: collapsible section at top of sidebar showing unfinished items from current sprint. Checkbox selection + batch "Move to [next sprint]" button. Moves items + active children to target sprint. Items can also be individually reviewed in the detail panel with "Carry over" action button (gold, vs teal "Done planning" for sprint-planning items)
- **Carry-over data source**: `?action=unfinished-sprint&iterationPath=...` — queries PBIs/Bugs/User Stories in current sprint that are NOT Done/Closed/Removed

### Team tab (analytics + settings)
- **Sprint analytics dashboard**: select sprint → shows per-member analysis with capacity, work items, and progress
- **Two-column layout**: member overview cards (left, 320px) + detail panel (right, flex)
- **Member overview cards**: avatar, capacity bar (color-coded: blue <80%, gold 80-100%, red >100%), item count badges (done/active/new)
- **Detail panel**: capacity breakdown per activity (Dev/QA/Release) with progress bars, hours summary (remaining/completed/estimated), work items grouped by parent
- **Work item grouping logic**: PBIs with tasks in sprint → PBI as group header + indented child tasks; standalone tasks with external parent → grouped under parent title header; items without parent → "Other items" section
- **Work item rows**: type icon, ID (links to Azure DevOps), title, activity badge, hours, story points, priority, state badge; done items shown with opacity + strikethrough
- **Unassigned items**: shown separately at bottom of member list
- **Team summary bar**: sprint selector, member count, total capacity vs assigned, items done vs total
- **Team settings** (gear icon, collapsible): add/edit/deactivate/remove team members, sync from Azure DevOps, inline editing of default activity + capacity/day
- **Assignee integration**: team members are merged with work-item-derived assignees across all tabs (PBI tree, Sprint Planning, Filters)
- **Local storage**: `data/team-config.json` (gitignored), auto-created on first save

### Refinement tab
- **Two modes**: List Mode (sidebar + detail panel) and Meeting Mode (full-width presentation)
- **Both modes support full editing**: editable description/AC, task creation, inline hours editing, state changes, task deletion, assignee editing
- **List Mode**: left sidebar (items grouped by parent) + center detail panel
- **Meeting Mode**: full-width, one item at a time, large text, keyboard nav (j/k/arrows, Esc to exit)
- **Meeting area picker**: "Start Meeting" opens a checkbox picker to select which parent categories (Features/Epics) to include. Meeting mode then only navigates items in selected areas. If only one group exists, starts directly without picker
- **PBI/Bug assignee**: editable via `<select>` dropdown in both list and meeting mode (saves immediately on change)
- **Editable description**: click Edit → textarea → save. Bugs use `Microsoft.VSTS.TCM.ReproSteps` field (label: "Repro Steps / Description"), PBIs use `System.Description`
- **Editable acceptance criteria**: same pattern, saves to `Microsoft.VSTS.Common.AcceptanceCriteria`
- **Rich HTML rendering**: description and AC render full HTML (lists, tables, bold, links) with embedded images proxied through `/api/image-proxy`. Click any image to open lightbox with zoom (click/scroll) and pan (drag)
- **Task creation**: preset buttons (Dev/QA/Release/Other), hours (required), assignee autocomplete. No sprint selector — tasks inherit PBI's iteration path (sprint assignment happens in Sprint Planning)
- **Inline hours editing**: on each task in both task list and Task Hours sidebar (saves on blur/Enter)
- **Refinement checklist** (computed, not stored): description ok, acceptance criteria ok, tasks created, tasks estimated (remaining hours). Updates in real-time as edits are made
- **Refinement status** (derived): Not Refined → In Progress → Ready (all 4 checks must pass for Ready)
- **"Mark Ready"**: always clickable (green when checklist complete, gold/amber when overriding incomplete checklist). Sets `Custom.SprintPlanning = true` + `Custom.Refinement = false`, removes from list, auto-advances to next
- **Workflow**: Refinement → estimate & create tasks → Mark Ready → item appears in Sprint Planning tab
- **Data source**: `?action=refinement` queries `Custom.Refinement = true` (no iteration filter, any sprint)

### Vacation tab
- **Members × sprints grid**: rows = team members (from capacity API), columns = selected sprints (default: current + 3)
- **Days-off bars**: positioned within sprint cell relative to sprint date range, labeled with total days off
- **Capacity summary row**: per-sprint capacity percentage, color-coded (green ≥80%, gold 50-79%, red <50%), progress bar
- **Sprint impact cards**: shown below grid for sprints with reduced capacity, lists members on vacation with days off count
- **Sprint range selector**: pick start sprint + number of sprints (2-6)
- **CSV export**: downloads vacation plan with per-member days off + sprint summary
- **Data source**: Azure DevOps Capacity API (`work/teamsettings/iterations/{id}/capacities` + `teamdaysoff`), fetched in parallel for all selected sprints
- Current sprint column highlighted with `bg-accent-blue/5`

### Retrospective tab
- **New tab**: Sprint retrospective with velocity charts, hours breakdown, carry-over tracking, member comparison
- **Sprint range selector**: choose how many past sprints to analyze (3-10, default 6)
- **Velocity chart**: SVG bar chart of story points completed per sprint, with average line
- **Items completed chart**: SVG bar chart of PBI/Bug items completed per sprint
- **Hours breakdown**: Stacked bar chart showing completed hours, remaining hours, with original estimate outline
- **Carry-over section**: Items created before the current sprint that are still active — shows type, state, story points, assignee
- **Member comparison table**: Cross-sprint stats table with selectable metric (completed items, hours, story points), mini bar charts, per-member averages
- **Summary cards**: Average velocity (SP), total points, items done, carry-over count
- **Data source**: `?action=velocity`, `?action=carry-over`, `?action=member-comparison`

### Create tab
- **Three-phase flow**: Input → Review/Edit → Success
- **Input phase**: Paste TOPdesk ticket text or describe work item manually. Type toggle (PBI/Bug). "Analyze with AI" button
- **AI analysis** (`/api/create-work-item/ai`): GPT-4o-mini transforms Danish TOPdesk text into structured English PBI/Bug (title, description, AC, priority, tags). Fallback: rule-based parsing if no OPENAI_API_KEY
- **TOPdesk priority mapping**: TOPdesk 1-2→P1, 3→P2, 4→P3, 5→P4
- **Review phase**: All fields editable — title, type, description (with HTML preview toggle), AC, priority (1-4), tags, sprint, assignee
- **Workflow flags**: Checkboxes for Refinement=true or SprintPlanning=true (mutually exclusive)
- **Parent linking**: Enter Feature/Epic ID → resolves and shows parent title
- **Child tasks**: Collapsible section to queue Dev/QA/Release tasks with hours and assignee before creation
- **Creation** (`/api/create-work-item`): Creates PBI/Bug via `createWorkItem()` + optional child tasks via `createChildTask()`
- **Success phase**: Shows created work item ID + link to Azure DevOps, "Create Another" button
- **Bug vs PBI**: Bugs use `Microsoft.VSTS.TCM.ReproSteps` for description, PBIs use `System.Description`
- **Data source**: POST `/api/create-work-item` (creation), POST `/api/create-work-item/ai` (AI analysis)

### Sprint Planning enhancements
- **Drag-and-drop reordering**: Toggle drag mode with button or `d` key — items in sidebar become draggable, reorder visually
- **What-if capacity preview**: Shows projected capacity impact for the selected item in the right sidebar — how much each team member's hours would change
- **Sprint goal editor**: Text area in right sidebar (above capacity), saved per-sprint to local file (`data/sprint-goals.json`)
- **Copy task structure**: Input a PBI ID → copies its child tasks (type, hours, activity) to the current item. Useful for recurring patterns

### Cleanup tab
- **Server-side query criteria** (all must match):
  - Type: `Product Backlog Item`, `Bug`, or `User Story` (not Tasks — they're managed as children)
  - State: NOT `Closed`, `Done`, or `Removed`
  - Area: `Relaunch - Charlie Tango` (exact match)
  - `System.ChangedDate` older than X days (configurable: 30/60/90/180/365, default 90)
  - Fetched with `$expand=all` to count child relations
- **Summary cards**: total stale items + breakdown by staleness level (aging/stale/ancient), clickable to filter
- **Flag detection** (computed client-side from loaded data):
  - `no-assignee`: `assignedTo` is null
  - `no-children`: 0 child work items (from relation count)
  - `stuck-new`: state is `New` AND not updated in 60+ days
  - `stuck-active`: state is `Active` AND not updated in 90+ days
- **Flag summary buttons**: show count per flag, clickable to filter
- **Filters**: minimum age (30/60/90/180/365d), state, type, assignee (including "Unassigned" option)
- **Sortable columns**: type, state, assignee, age, task count, priority
- **Batch selection**: checkbox per row + select-all, with sticky action bar
- **Batch actions**: "Tag Needs Review" (appends `Needs Review` tag via PATCH), bulk delete (chunks of 50)
- **CSV export**: exports filtered list with all fields (ID, type, title, state, assignee, dates, age, staleness, children, flags, sprint, tags, URL)
- **Open in DevOps**: hover-visible external link icon per row
- **Data source**: `?action=cleanup-analysis&minAgeDays=30`
- Uses `ConfirmDialog` for bulk delete confirmation

### API route (`/api/ai-summary`)

**POST:**
- `{ workItemId, title, description, acceptanceCriteria }` — generates AI code summary
- Searches `RELATED_CODEBASE_PATH` codebase with grep for keywords extracted from title/description/AC
- If `OPENAI_API_KEY` is set: sends file context + work item info to GPT-4o-mini for 3-5 bullet point summary
- If no API key: generates rule-based summary from file matches (module inference, frontend/backend split, key files)
- Returns `{ workItemId, summary: string[], relevantFiles: { path, snippet }[], generatedAt }`
- Cached server-side 30 minutes per work item
- Rate limited via existing rate limiter

### API route (`/api/create-work-item`)

**POST:**
- `{ type, title, description?, acceptanceCriteria?, priority?, tags?, iterationPath?, assignedTo?, refinement?, sprintPlanning?, parentId?, childTasks? }` — creates PBI or Bug
- `type`: `"Product Backlog Item"` or `"Bug"`
- `childTasks`: array of `{ title, activity, remainingWork, assignedTo? }` — creates child tasks after PBI/Bug
- `parentId`: links to parent Feature/Epic via `System.LinkTypes.Hierarchy-Reverse`
- Returns `{ id, url, type, title, childTaskIds }`
- Rate limited

### API route (`/api/create-work-item/ai`)

**POST:**
- `{ rawText }` — transforms TOPdesk ticket text or free-form description into structured work item fields
- Uses GPT-4o-mini if `OPENAI_API_KEY` set, otherwise rule-based parsing
- Returns `{ title, type, description, acceptanceCriteria, priority, tags, topdeskTicketNumber, confidence, aiAvailable }`
- Rate limited

### Client-side (PBI tree view only)
- **Expand PBI** → shows detail panel (description, comments, sprint, task creation) + child tasks with inline-editable remaining hours
- **Edit PBI inline**: description (click Edit), state (StateSelector), assignee (autocomplete from team), sprint (dropdown)
- **Rich HTML rendering**: description and AC render full HTML with embedded images (proxied + lightbox with zoom/pan)
- **Sprint change propagation**: changing PBI sprint auto-moves all non-Done/Closed/Removed children to the same sprint
- **Add comments**: text form below existing comments
- **Create child tasks**: 4 preset buttons (Development, QA, Release, Other) with sprint selector, hours (required), and assignee (defaults to PBI assignee, autocomplete)
- **State change**: click state badge on any item → portal-rendered dropdown with all valid states from process definitions
- **Bulk delete** with checkboxes → confirmation dialog → chunks in batches of 50 with progress
- **Filters**: age toggle (not updated since / created more than) × (30/60/90/180/365+ days), state, type, assigned to — all **persisted in URL** query params
- **Area filter**: only items in `Area: Relaunch - Charlie Tango` (exact match)
- `useSearchParams()` wrapped in `<Suspense>` boundary (required by Next.js 15)

### Theme support
- **Dark/light theme toggle**: `t` key or button in header
- Theme stored in `localStorage('theme')` and applied via `data-theme` attribute on `<html>`
- Light theme overrides CSS custom properties (same Tailwind utility classes work for both)
- Inline `<script>` in `<head>` prevents FOUC by applying theme before paint

### Keyboard shortcuts
- **`?`** — toggle keyboard shortcuts panel (dialog with all shortcuts)
- **`1`-`9`, `0`** — switch between tabs (0 = 10th tab)
- **`t`** — toggle dark/light theme
- **`p`** — toggle auto-refresh polling
- **`d`** — toggle drag-and-drop mode (Sprint Planning)
- **`j`/`k`/arrows** — navigate items (Sprint Planning, Refinement)
- **`m`** — toggle meeting mode (Sprint Planning, Refinement, Review)
- **`Enter`** — commit action in meeting mode (Done planning / Carry over)
- **`Esc`** — close panels/dialogs/meeting mode

### Auto-refresh / polling
- Toggle in header (refresh icon) or `p` key
- When active, refreshes current tab data every 30 seconds
- Green "Auto-refresh" indicator shown next to tab bar
- Polling callback changes based on active tab

### Caching
- **Server-side**: `lib/cache.ts` provides in-memory cache with TTL
- Iterations API cached for 5 minutes (called by many endpoints)
- AI summary cached for 30 minutes per work item
- Cache pattern: `getCached<T>(key)` → `setCache(key, data, ttlMs)` → `invalidateCache(pattern?)`

### Mobile responsive
- Sprint Planning 3-column layout collapses to single column on `max-width: 768px` via `.sprint-3col` CSS class
- Tab bar scrolls horizontally on small screens
- Summary cards use responsive grid (2 cols on mobile, 4 on desktop)

### Styling
- Dark theme with research-backed palette (Material Design + Linear approach)
- Background: `#101014` / `#1a1a22` (deep neutral)
- Cards: `#212130` / `#2a2a3a`
- Accents: blue (`#5b8def`), teal/green (`#34c772`), gold (`#e8a840`), red (`#e84858`)
- Work item type colors: Bug=red, Task=gold, Story=blue, Feature=purple, Epic=orange
- Staleness colors: fresh=green, aging=gold, stale=orange, ancient=red
- Custom scrollbar styling for dark theme
- `.prose-devops` class for rich HTML content (descriptions, AC) — images, lists, tables, code blocks

## Key conventions

- All UI text is in **English**
- Use `clsx` for conditional classes
- `ConfirmDialog` is always used for destructive actions
- Delete buttons are hidden and fade in on hover (opacity-0 → group-hover:opacity-100)
- Cancel is always focused by default in dialogs
- Task creation requires hours (validated client-side)
- Assignee fields use autocomplete with team members from metadata

## Gotchas

- **React 19 `useRef`**: requires an explicit initial value — `useRef<T>(undefined)` not `useRef<T>()`
- **`useSearchParams()` in Next.js 15**: must be wrapped in a `<Suspense>` boundary
- **URL-derived arrays as deps**: never use `url.getArray()` directly in `useCallback`/`useEffect` deps — it creates new array refs every render causing infinite loops. Use the raw string (`url.get("key", "")`) as the dep and derive the array inside the callback body or as a separate variable
- **Activity field values**: Only `Development`, `QA`, `Release` are valid (not Testing/Deployment)
- **Sprint move**: when changing PBI sprint, filter children by `!DONE_STATES.has(c.state)` where DONE_STATES = Done, Closed, Removed
- **Inline hours editing**: child task remaining hours are editable directly in the task list (saves on blur/Enter via PATCH fields)
- **StateSelector scroll fix**: scroll events inside the dropdown are ignored so the list doesn't close when scrolling
- **Bug description field**: Bugs store description in `Microsoft.VSTS.TCM.ReproSteps`, not `System.Description`. Always pass `workItemType` when updating description to write to the correct field

## Environment variables (.env.local)

```
AZURE_DEVOPS_ORG=edc-group
AZURE_DEVOPS_PROJECT=Relaunch - Charlie Tango
AZURE_DEVOPS_PAT=<personal access token>
RATE_LIMIT_RPM=30

# AI Code Summary (optional — feature works without these, falls back to rule-based)
RELATED_CODEBASE_PATH=/Users/matiasgramkow/Development/EDC.EDCDK.Website
OPENAI_API_KEY=<OpenAI API key for GPT-4o-mini summaries>
```
