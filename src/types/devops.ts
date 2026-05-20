export interface WorkItem {
  id: number;
  title: string;
  state: string;
  type: string;
  assignedTo: string | null;
  createdDate: string;
  changedDate: string;
  tags: string;
  iterationPath: string;
  areaPath: string;
  priority: number;
  remainingWork: number | null;
  sprintPlanning: boolean;
  refinement: boolean;
  url: string;
}

export interface WorkItemsResponse {
  items: WorkItem[];
  total: number;
}

export interface WorkItemFilters {
  maxAgeDays: number;
  states: string[];
  types: string[];
  assignedTo: string | null;
}

export interface WorkItemWithChildren extends WorkItem {
  children: WorkItem[];
  childCount: number;
  parentId?: number | null;
  parentTitle?: string | null;
}

export interface WorkItemComment {
  id: number;
  text: string;
  createdDate: string;
  createdBy: string;
}

export interface Iteration {
  id: string;
  name: string;
  path: string;
  startDate: string | null;
  finishDate: string | null;
}

export interface WorkItemDetails extends WorkItem {
  description: string | null;
  acceptanceCriteria: string | null;
  storyPoints: number | null;
  remainingWork: number | null;
  originalEstimate: number | null;
  completedWork: number | null;
  boardColumn: string | null;
  comments: WorkItemComment[];
}

export interface SprintCapacityActivity {
  name: string;
  capacityHours: number;
  assignedHours: number;
}

export interface SprintCapacityMember {
  displayName: string;
  activities: SprintCapacityActivity[];
  totalCapacity: number;
  totalAssigned: number;
}

export interface SprintCapacityData {
  members: SprintCapacityMember[];
  sprintWorkDays: number;
}

export type ViewMode = "flat" | "tree";
export type SortField = "changedDate" | "createdDate" | "priority" | "state" | "assignedTo";
export type SortDirection = "asc" | "desc";

// --- Team Setup types ---

export type Activity = "Development" | "QA" | "Release";

export interface TeamMember {
  id: string;
  displayName: string;
  defaultActivity: Activity;
  capacityPerDay: number;
  active: boolean;
  email?: string;
  avatarUrl?: string;
  addedDate: string;
}

export interface TeamConfig {
  version: 1;
  lastModified: string;
  members: TeamMember[];
}

// --- Sprint Analytics types ---

export interface SprintWorkItem {
  id: number;
  title: string;
  state: string;
  type: string;
  assignedTo: string | null;
  changedDate: string;
  remainingWork: number | null;
  completedWork: number | null;
  originalEstimate: number | null;
  storyPoints: number | null;
  activity: string | null;
  priority: number;
  tags: string;
  parentId: number | null;
  parentTitle: string | null;
  url: string;
}

export interface MemberSprintStats {
  total: number;
  completed: number;
  active: number;
  newItems: number;
  removed: number;
  completedHours: number;
  remainingHours: number;
  originalEstimateHours: number;
}

export interface MemberAnalytics {
  displayName: string;
  items: SprintWorkItem[];
  capacity: SprintCapacityMember | null;
  stats: MemberSprintStats;
}

export interface SprintAnalyticsData {
  members: MemberAnalytics[];
  unassignedItems: SprintWorkItem[];
  sprintWorkDays: number;
  sprintName: string;
}

// --- Vacation Planner types ---

export interface DaysOffPeriod {
  start: string;
  end: string;
}

export interface MemberVacation {
  displayName: string;
  daysOff: DaysOffPeriod[];
  totalDaysOff: number;
}

export interface SprintVacationData {
  iterationId: string;
  sprintName: string;
  startDate: string;
  finishDate: string;
  totalWorkDays: number;
  teamDaysOff: DaysOffPeriod[];
  members: MemberVacation[];
  membersOnVacation: number;
  totalMembers: number;
  capacityPercent: number;
}

export interface VacationOverviewData {
  sprints: SprintVacationData[];
}

// --- Retrospective types ---

export interface SprintVelocity {
  iterationId: string;
  sprintName: string;
  startDate: string;
  finishDate: string;
  completedPoints: number;
  totalPoints: number;
  completedItems: number;
  totalItems: number;
  completedHours: number;
  remainingHours: number;
  originalEstimateHours: number;
}

export interface CarryOverItem {
  id: number;
  title: string;
  type: string;
  state: string;
  assignedTo: string | null;
  storyPoints: number | null;
  remainingWork: number | null;
  fromSprint: string;
  toSprint: string;
  url: string;
}

export interface MemberSprintComparisonEntry {
  iterationId: string;
  sprintName: string;
  completedItems: number;
  totalItems: number;
  completedHours: number;
  remainingHours: number;
  capacityHours: number;
  completedPoints: number;
}

export interface MemberSprintComparison {
  displayName: string;
  sprints: MemberSprintComparisonEntry[];
}

// --- Backlog Health types ---

export interface BacklogHealthData {
  totalItems: number;
  withEstimates: number;
  withoutEstimates: number;
  withAssignee: number;
  withoutAssignee: number;
  averageAgeDays: number;
  refinementReady: number;
  inRefinement: number;
  sprintPlanning: number;
  needsAttention: number;
  byState: Record<string, number>;
  byType: Record<string, number>;
  oldestItems: Array<{ id: number; title: string; type: string; state: string; ageDays: number; url: string }>;
  healthScore: number;
}

// --- Sprint Goals types ---

export interface SprintGoal {
  iterationId: string;
  text: string;
  lastModified: string;
}

export interface SprintGoalsConfig {
  version: 1;
  goals: SprintGoal[];
}

// --- Roadmap types ---

export type RoadmapPlanType = "technical" | "commercial";

export type RoadmapStepStatus = "todo" | "in-progress" | "done";

export type RoadmapEffort = "S" | "M" | "L" | "XL";

export interface RoadmapStep {
  id: string;
  title: string;
  status: RoadmapStepStatus;
  sortOrder: number;
  /** Phase grouping within initiative, e.g. "Foundation" */
  phase?: string;
  /** Effort/complexity estimate */
  effort?: RoadmapEffort;
  /** Optional linked Azure DevOps work item */
  linkedWorkItemId?: number;
  /** Cached from Azure DevOps on load */
  linkedWorkItemTitle?: string;
  linkedWorkItemState?: string;
  linkedWorkItemType?: string;
}

export interface RoadmapItem {
  id: string;
  title: string;
  description: string;
  planType: RoadmapPlanType;
  /** Year label, e.g. "2026" */
  quarter: string;
  sortOrder: number;
  /** Rough time estimate, e.g. "3-5 uger" */
  estimate?: string;
  steps: RoadmapStep[];
  createdDate: string;
  lastModified: string;
}

export interface RoadmapConfig {
  version: 1;
  items: RoadmapItem[];
}

// --- Daily Standup types ---

export interface WorkItemStateChange {
  workItemId: number;
  title: string;
  type: string;
  oldState: string;
  newState: string;
  changedDate: string;
  changedBy: string;
  url: string;
}

export interface BlockedItem {
  id: number;
  title: string;
  type: string;
  state: string;
  assignedTo: string | null;
  reason: "tagged" | "stuck";
  daysSinceChange: number;
  remainingWork: number | null;
  url: string;
}

export interface MemberStandupData {
  displayName: string;
  yesterday: WorkItemStateChange[];
  today: WorkItem[];
  blockers: BlockedItem[];
  stats: {
    changesYesterday: number;
    activeItems: number;
    blockerCount: number;
    remainingHours: number;
  };
  capacity: SprintCapacityMember | null;
}

export interface SprintPulse {
  riskScore: number;
  trajectory: "on-track" | "at-risk" | "behind";
  stuckItems: BlockedItem[];
  capacityRisk: number;
  timeRisk: number;
  stuckRisk: number;
  daysRemaining: number;
  daysElapsed: number;
  totalDays: number;
}

export interface DailyStandupData {
  members: MemberStandupData[];
  unassignedBlockers: BlockedItem[];
  pulse: SprintPulse;
  sprintName: string;
  sprintDaysRemaining: number;
  lookbackHours: number;
  generatedAt: string;
}

// --- Smart Assignee types ---

export interface AssigneeSuggestion {
  displayName: string;
  availableHours: number;
  capacityPercent: number;
  isSuggested: boolean;
}

// --- AI Summary types ---

export interface AISummaryRelevantFile {
  path: string;
  snippet: string;
}

export interface AISummaryResult {
  workItemId: number;
  summary: string[];
  relevantFiles: AISummaryRelevantFile[];
  generatedAt: string;
}
