import type { WorkItem, WorkItemWithChildren, WorkItemDetails, WorkItemComment, Iteration, SprintCapacityData, SprintCapacityMember, SprintWorkItem, MemberAnalytics, MemberSprintStats, SprintAnalyticsData, VacationOverviewData, SprintVacationData, DaysOffPeriod, SprintVelocity, CarryOverItem, MemberSprintComparison, BacklogHealthData, WorkItemStateChange, BlockedItem, MemberStandupData, SprintPulse, DailyStandupData } from "@/types/devops";
import { getCached, setCache } from "@/lib/cache";

const ORG = process.env.AZURE_DEVOPS_ORG!;
const PROJECT = process.env.AZURE_DEVOPS_PROJECT!;
const PAT = process.env.AZURE_DEVOPS_PAT!;

const API_VERSION = "7.1";
const AREA_PATH = "Relaunch - Charlie Tango";

function getAuthHeader(): string {
  return `Basic ${Buffer.from(`:${PAT}`).toString("base64")}`;
}

function apiUrl(path: string): string {
  const encodedProject = encodeURIComponent(PROJECT);
  return `https://dev.azure.com/${ORG}/${encodedProject}/_apis/${path}`;
}

function orgApiUrl(path: string): string {
  return `https://dev.azure.com/${ORG}/_apis/${path}`;
}

interface WiqlResponse {
  workItems: { id: number; url: string }[];
}

interface WorkItemRaw {
  id: number;
  fields: {
    "System.Title": string;
    "System.State": string;
    "System.WorkItemType": string;
    "System.AssignedTo"?: { displayName: string };
    "System.CreatedDate": string;
    "System.ChangedDate": string;
    "System.Tags": string;
    "System.IterationPath": string;
    "System.AreaPath": string;
    "Microsoft.VSTS.Common.Priority": number;
  };
  relations?: {
    rel: string;
    url: string;
    attributes: Record<string, unknown>;
  }[];
  _links: { html: { href: string } };
}

interface WorkItemFieldsResponse {
  value: WorkItemRaw[];
}

const FIELDS = [
  "System.Title",
  "System.State",
  "System.WorkItemType",
  "System.AssignedTo",
  "System.CreatedDate",
  "System.ChangedDate",
  "System.Tags",
  "System.IterationPath",
  "System.AreaPath",
  "Microsoft.VSTS.Common.Priority",
  "Microsoft.VSTS.Scheduling.RemainingWork",
  "Custom.SprintPlanning",
  "Custom.Refinement",
].join(",");

function mapWorkItem(wi: WorkItemRaw): WorkItem {
  const f = wi.fields as Record<string, unknown>;
  return {
    id: wi.id,
    title: wi.fields["System.Title"],
    state: wi.fields["System.State"],
    type: wi.fields["System.WorkItemType"],
    assignedTo: wi.fields["System.AssignedTo"]?.displayName ?? null,
    createdDate: wi.fields["System.CreatedDate"],
    changedDate: wi.fields["System.ChangedDate"],
    tags: wi.fields["System.Tags"] ?? "",
    iterationPath: wi.fields["System.IterationPath"],
    areaPath: wi.fields["System.AreaPath"],
    priority: wi.fields["Microsoft.VSTS.Common.Priority"] ?? 4,
    remainingWork: f["Microsoft.VSTS.Scheduling.RemainingWork"] as number | null ?? null,
    sprintPlanning: (f["Custom.SprintPlanning"] as boolean) ?? false,
    refinement: (f["Custom.Refinement"] as boolean) ?? false,
    url: wi._links?.html?.href ?? `https://dev.azure.com/${ORG}/${encodeURIComponent(PROJECT)}/_workitems/edit/${wi.id}`,
  };
}

function extractChildIds(wi: WorkItemRaw): number[] {
  if (!wi.relations) return [];
  return wi.relations
    .filter((r) => r.rel === "System.LinkTypes.Hierarchy-Forward")
    .map((r) => {
      const match = r.url.match(/\/workItems\/(\d+)$/);
      return match ? Number(match[1]) : 0;
    })
    .filter((id) => id > 0);
}

function extractParentId(wi: WorkItemRaw): number | null {
  if (!wi.relations) return null;
  const parentRel = wi.relations.find((r) => r.rel === "System.LinkTypes.Hierarchy-Reverse");
  if (!parentRel) return null;
  const match = parentRel.url.match(/\/workItems\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function fetchWorkItemsBatch(ids: number[], expand: boolean = false): Promise<WorkItemRaw[]> {
  const all: WorkItemRaw[] = [];
  const batchSize = 200;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batchIds = ids.slice(i, i + batchSize);
    const idsParam = batchIds.join(",");

    // Azure DevOps API does not allow $expand and fields together
    const query = expand
      ? `wit/workitems?ids=${idsParam}&$expand=all&api-version=${API_VERSION}`
      : `wit/workitems?ids=${idsParam}&fields=${FIELDS}&api-version=${API_VERSION}`;

    const res = await fetch(apiUrl(query), {
      headers: { Authorization: getAuthHeader() },
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Work items fetch failed (${res.status}): ${error}`);
    }

    const data: WorkItemFieldsResponse = await res.json();
    all.push(...data.value);
  }

  return all;
}

export async function queryWorkItems(options: {
  maxAgeDays?: number;
  ageField?: "updated" | "created";
  states?: string[];
  types?: string[];
  assignedTo?: string | null;
}): Promise<WorkItem[]> {
  const { maxAgeDays = 90, ageField = "updated", states, types, assignedTo } = options;

  const dateField = ageField === "created" ? "System.CreatedDate" : "System.ChangedDate";

  // Build WIQL query
  const conditions: string[] = [
    `[System.TeamProject] = @project`,
    `[System.AreaPath] = '${AREA_PATH}'`,
    `[${dateField}] < @today - ${maxAgeDays}`,
  ];

  if (states && states.length > 0) {
    const stateConditions = states.map((s) => `[System.State] = '${s}'`).join(" OR ");
    conditions.push(`(${stateConditions})`);
  } else {
    // Default: exclude closed/done/removed
    conditions.push(`[System.State] NOT IN ('Closed', 'Done', 'Removed')`);
  }

  if (types && types.length > 0) {
    const typeConditions = types.map((t) => `[System.WorkItemType] = '${t}'`).join(" OR ");
    conditions.push(`(${typeConditions})`);
  }

  if (assignedTo) {
    conditions.push(`[System.AssignedTo] = '${assignedTo}'`);
  }

  const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${conditions.join(" AND ")} ORDER BY [System.ChangedDate] ASC`;

  // Step 1: Execute WIQL query to get work item IDs
  const wiqlRes = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: wiql }),
  });

  if (!wiqlRes.ok) {
    const error = await wiqlRes.text();
    throw new Error(`WIQL query failed (${wiqlRes.status}): ${error}`);
  }

  const wiqlData: WiqlResponse = await wiqlRes.json();

  if (wiqlData.workItems.length === 0) {
    return [];
  }

  // Step 2: Fetch work item details in batches
  const ids = wiqlData.workItems.map((wi) => wi.id);
  const rawItems = await fetchWorkItemsBatch(ids);
  return rawItems.map(mapWorkItem);
}

export interface TopdeskLinkedWorkItem {
  id: number;
  type: string;
  title: string;
  state: string;
  assignedTo: string | null;
  iterationPath: string;
  tags: string;
  url: string;
}

// For System.Tags, WIQL's CONTAINS operator is an EXACT tag match (not substring),
// so we build one OR clause per ticket number we want to look up. Batches the
// numbers into chunks to keep the WIQL string under the 32KB limit.
export async function findWorkItemsByTopdeskTags(
  ticketNumbers: string[]
): Promise<Map<string, TopdeskLinkedWorkItem[]>> {
  const result = new Map<string, TopdeskLinkedWorkItem[]>();
  if (ticketNumbers.length === 0) return result;

  const CHUNK_SIZE = 50;
  const allIds: number[] = [];

  for (let i = 0; i < ticketNumbers.length; i += CHUNK_SIZE) {
    const chunk = ticketNumbers.slice(i, i + CHUNK_SIZE);
    const tagConditions = chunk
      .map((n) => `[System.Tags] CONTAINS 'TOPdesk:${n}'`)
      .join(" OR ");
    const wiql = `SELECT [System.Id] FROM WorkItems
      WHERE [System.TeamProject] = @project
        AND (${tagConditions})
      ORDER BY [System.ChangedDate] DESC`;

    const wiqlRes = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
      method: "POST",
      headers: { Authorization: getAuthHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ query: wiql }),
    });

    if (!wiqlRes.ok) {
      const error = await wiqlRes.text();
      throw new Error(`WIQL query failed (${wiqlRes.status}): ${error}`);
    }

    const wiqlData: WiqlResponse = await wiqlRes.json();
    for (const wi of wiqlData.workItems) allIds.push(wi.id);
  }

  if (allIds.length === 0) return result;

  const rawItems = await fetchWorkItemsBatch(allIds);
  const numberSet = new Set(ticketNumbers);
  const tagRe = /TOPdesk:\s*(\d{4}-\d{4})/gi;

  for (const wi of rawItems) {
    const item: TopdeskLinkedWorkItem = {
      id: wi.id,
      type: wi.fields["System.WorkItemType"],
      title: wi.fields["System.Title"],
      state: wi.fields["System.State"],
      assignedTo: wi.fields["System.AssignedTo"]?.displayName ?? null,
      iterationPath: wi.fields["System.IterationPath"],
      tags: wi.fields["System.Tags"] ?? "",
      url: wi._links?.html?.href ?? `https://dev.azure.com/${ORG}/${encodeURIComponent(PROJECT)}/_workitems/edit/${wi.id}`,
    };

    for (const m of item.tags.matchAll(tagRe)) {
      const ticketNumber = m[1];
      if (!numberSet.has(ticketNumber)) continue;
      const existing = result.get(ticketNumber);
      if (existing) {
        if (!existing.some((e) => e.id === item.id)) existing.push(item);
      } else {
        result.set(ticketNumber, [item]);
      }
    }
  }

  return result;
}

export interface LinkResult {
  id: number;
  title: string;
  type: string;
  state: string;
  url: string;
  alreadyLinked: boolean;
}

// Parses an Azure DevOps work item URL or a plain integer. Accepts:
//   • https://dev.azure.com/<org>/<project>/_workitems/edit/12345
//   • https://<org>.visualstudio.com/<project>/_workitems/edit/12345
//   • Anything with ?workitem=12345 or ?id=12345
//   • Plain integer like "12345"
//   • "#12345" or "AB#12345" (mention syntax)
export function parseWorkItemInput(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/workitems\/edit\/(\d+)/i);
  if (urlMatch) return Number(urlMatch[1]);

  const qsMatch = trimmed.match(/[?&](?:workitem|id|witd)=(\d+)/i);
  if (qsMatch) return Number(qsMatch[1]);

  const hashMatch = trimmed.match(/#(\d+)/);
  if (hashMatch) return Number(hashMatch[1]);

  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

export async function linkWorkItemToTopdesk(
  workItemId: number,
  topdeskNumber: string
): Promise<LinkResult> {
  if (!Number.isInteger(workItemId) || workItemId <= 0) {
    throw new Error("Invalid work item ID");
  }
  if (!/^\d{4}-\d{4}$/.test(topdeskNumber)) {
    throw new Error(`Invalid TOPdesk ticket number format: ${topdeskNumber}`);
  }

  const rawItems = await fetchWorkItemsBatch([workItemId]);
  if (rawItems.length === 0) {
    throw new Error(`Work item ${workItemId} not found`);
  }
  const wi = rawItems[0];
  const currentTags = (wi.fields["System.Tags"] ?? "")
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean);

  const expectedTag = `TOPdesk:${topdeskNumber}`;
  const alreadyLinked = currentTags.some((t) => t.toLowerCase() === expectedTag.toLowerCase());

  if (!alreadyLinked) {
    currentTags.push(expectedTag);
    await updateWorkItemFields(workItemId, { tags: currentTags.join("; ") });
  }

  return {
    id: wi.id,
    title: wi.fields["System.Title"],
    type: wi.fields["System.WorkItemType"],
    state: wi.fields["System.State"],
    url: wi._links?.html?.href ?? `https://dev.azure.com/${ORG}/${encodeURIComponent(PROJECT)}/_workitems/edit/${wi.id}`,
    alreadyLinked,
  };
}

export async function queryPBIsWithChildren(options: {
  maxAgeDays?: number;
  ageField?: "updated" | "created";
  states?: string[];
  types?: string[];
  assignedTo?: string | null;
}): Promise<WorkItemWithChildren[]> {
  const { maxAgeDays, ageField = "updated", states, types, assignedTo } = options;

  const dateField = ageField === "created" ? "System.CreatedDate" : "System.ChangedDate";

  // Step 1: Query PBIs
  const conditions: string[] = [
    `[System.TeamProject] = @project`,
    `[System.AreaPath] = '${AREA_PATH}'`,
  ];

  // Type filter — default to PBI only
  if (types && types.length > 0) {
    const typeConditions = types.map((t) => `[System.WorkItemType] = '${t}'`).join(" OR ");
    conditions.push(`(${typeConditions})`);
  } else {
    conditions.push(`[System.WorkItemType] = 'Product Backlog Item'`);
  }

  if (maxAgeDays) {
    conditions.push(`[${dateField}] < @today - ${maxAgeDays}`);
  }

  if (states && states.length > 0) {
    const stateConditions = states.map((s) => `[System.State] = '${s}'`).join(" OR ");
    conditions.push(`(${stateConditions})`);
  } else {
    conditions.push(`[System.State] NOT IN ('Closed', 'Done', 'Removed')`);
  }

  if (assignedTo) {
    conditions.push(`[System.AssignedTo] = '${assignedTo}'`);
  }

  const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${conditions.join(" AND ")} ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC`;

  const wiqlRes = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: wiql }),
  });

  if (!wiqlRes.ok) {
    const error = await wiqlRes.text();
    throw new Error(`WIQL query failed (${wiqlRes.status}): ${error}`);
  }

  const wiqlData: WiqlResponse = await wiqlRes.json();

  if (wiqlData.workItems.length === 0) {
    return [];
  }

  // Step 2: Fetch PBIs with relations to get child links
  const pbiIds = wiqlData.workItems.map((wi) => wi.id);
  const rawPBIs = await fetchWorkItemsBatch(pbiIds, true);

  // Step 3: Collect all unique child IDs
  const childIdsByPbi = new Map<number, number[]>();
  const allChildIds = new Set<number>();

  for (const pbi of rawPBIs) {
    const childIds = extractChildIds(pbi);
    childIdsByPbi.set(pbi.id, childIds);
    for (const id of childIds) {
      allChildIds.add(id);
    }
  }

  // Step 4: Fetch all child work items in one batch
  const childMap = new Map<number, WorkItem>();
  if (allChildIds.size > 0) {
    const rawChildren = await fetchWorkItemsBatch([...allChildIds]);
    for (const raw of rawChildren) {
      childMap.set(raw.id, mapWorkItem(raw));
    }
  }

  // Step 5: Assemble PBI tree
  return rawPBIs.map((rawPbi) => {
    const pbi = mapWorkItem(rawPbi);
    const childIds = childIdsByPbi.get(rawPbi.id) ?? [];
    const children = childIds
      .map((id) => childMap.get(id))
      .filter((c): c is WorkItem => c !== undefined);

    return {
      ...pbi,
      children,
      childCount: childIds.length,
    };
  });
}

async function getStatesForWorkItemType(workItemType: string): Promise<string[]> {
  const encodedType = encodeURIComponent(workItemType);
  const res = await fetch(
    apiUrl(`wit/workitemtypes/${encodedType}/states?api-version=${API_VERSION}`),
    { headers: { Authorization: getAuthHeader() } }
  );

  if (!res.ok) return [];

  const data: { value: { name: string; category: string }[] } = await res.json();
  return data.value.map((s) => s.name);
}

export async function getProjectMetadata(): Promise<{
  states: string[];
  allStates: string[];
  types: string[];
  assignees: string[];
}> {
  // Use a broad WIQL to get unique states, types, and assignees
  const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AreaPath] = '${AREA_PATH}' AND [System.State] NOT IN ('Closed', 'Done', 'Removed') ORDER BY [System.ChangedDate] DESC`;

  const wiqlRes = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: wiql }),
  });

  if (!wiqlRes.ok) {
    return { states: [], allStates: [], types: [], assignees: [] };
  }

  const wiqlData: WiqlResponse = await wiqlRes.json();

  if (wiqlData.workItems.length === 0) {
    return { states: [], allStates: [], types: [], assignees: [] };
  }

  // Fetch a sample of items to extract metadata
  const sampleIds = wiqlData.workItems.slice(0, 200).map((wi) => wi.id);
  const idsParam = sampleIds.join(",");

  const fields = ["System.State", "System.WorkItemType", "System.AssignedTo"].join(",");

  const detailsRes = await fetch(
    apiUrl(`wit/workitems?ids=${idsParam}&fields=${fields}&api-version=${API_VERSION}`),
    { headers: { Authorization: getAuthHeader() } }
  );

  if (!detailsRes.ok) {
    return { states: [], allStates: [], types: [], assignees: [] };
  }

  const detailsData: WorkItemFieldsResponse = await detailsRes.json();

  const states = new Set<string>();
  const types = new Set<string>();
  const assignees = new Set<string>();

  for (const wi of detailsData.value) {
    states.add(wi.fields["System.State"]);
    types.add(wi.fields["System.WorkItemType"]);
    if (wi.fields["System.AssignedTo"]?.displayName) {
      assignees.add(wi.fields["System.AssignedTo"].displayName);
    }
  }

  // Fetch all valid states from the work item type definitions
  const typesList = [...types];
  const statesByType = await Promise.all(typesList.map(getStatesForWorkItemType));
  const allStates = new Set<string>();
  for (const typeStates of statesByType) {
    for (const s of typeStates) allStates.add(s);
  }

  return {
    states: [...states].sort(),
    allStates: [...allStates].sort(),
    types: typesList.sort(),
    assignees: [...assignees].sort(),
  };
}

export async function updateWorkItemState(id: number, state: string): Promise<{ id: number; state: string }> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid work item ID");
  }

  const res = await fetch(
    apiUrl(`wit/workitems/${id}?api-version=${API_VERSION}`),
    {
      method: "PATCH",
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json-patch+json",
      },
      body: JSON.stringify([
        {
          op: "replace",
          path: "/fields/System.State",
          value: state,
        },
      ]),
    }
  );

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`State update failed (${res.status}): ${error}`);
  }

  const data = await res.json();
  return { id: data.id, state: data.fields["System.State"] };
}

export async function deleteWorkItem(id: number): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid work item ID");
  }

  const res = await fetch(
    apiUrl(`wit/workitems/${id}?api-version=${API_VERSION}`),
    {
      method: "DELETE",
      headers: { Authorization: getAuthHeader() },
    }
  );

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Delete failed (${res.status}): ${error}`);
  }
}

export interface BulkDeleteResult {
  succeeded: number[];
  failed: { id: number; error: string }[];
}

export async function deleteWorkItems(ids: number[], concurrency = 5): Promise<BulkDeleteResult> {
  const result: BulkDeleteResult = { succeeded: [], failed: [] };

  // Validate all IDs upfront
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) {
      result.failed.push({ id, error: "Invalid ID" });
    }
  }

  const validIds = ids.filter((id) => Number.isInteger(id) && id > 0);

  // Process in batches with concurrency limit
  for (let i = 0; i < validIds.length; i += concurrency) {
    const batch = validIds.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (id) => {
        await deleteWorkItem(id);
        return id;
      })
    );

    for (const [index, res] of results.entries()) {
      if (res.status === "fulfilled") {
        result.succeeded.push(res.value);
      } else {
        result.failed.push({
          id: batch[index],
          error: res.reason instanceof Error ? res.reason.message : "Unknown error",
        });
      }
    }
  }

  return result;
}

// --- PBI Detail APIs ---

export async function fetchWorkItemDetails(id: number): Promise<WorkItemDetails> {
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid work item ID");

  const fields = [
    ...FIELDS.split(","),
    "System.Description",
    "Microsoft.VSTS.TCM.ReproSteps",
    "Microsoft.VSTS.Common.AcceptanceCriteria",
    "Microsoft.VSTS.Scheduling.StoryPoints",
    "Microsoft.VSTS.Scheduling.RemainingWork",
    "Microsoft.VSTS.Scheduling.OriginalEstimate",
    "Microsoft.VSTS.Scheduling.CompletedWork",
    "System.BoardColumn",
  ].join(",");

  const [itemRes, commentsRes] = await Promise.all([
    fetch(apiUrl(`wit/workitems/${id}?fields=${fields}&api-version=${API_VERSION}`), {
      headers: { Authorization: getAuthHeader() },
    }),
    fetch(apiUrl(`wit/workitems/${id}/comments?api-version=7.1-preview.4`), {
      headers: { Authorization: getAuthHeader() },
    }),
  ]);

  if (!itemRes.ok) {
    const error = await itemRes.text();
    throw new Error(`Failed to fetch work item (${itemRes.status}): ${error}`);
  }

  const wi: WorkItemRaw = await itemRes.json();
  const base = mapWorkItem(wi);

  let comments: WorkItemComment[] = [];
  if (commentsRes.ok) {
    const commentsData = await commentsRes.json();
    comments = (commentsData.comments ?? [])
      .filter((c: { isDeleted?: boolean }) => !c.isDeleted)
      .map((c: { id: number; text: string; createdDate: string; createdBy: { displayName: string } }) => ({
        id: c.id,
        text: c.text,
        createdDate: c.createdDate,
        createdBy: c.createdBy.displayName,
      }));
  }

  return {
    ...base,
    description: (wi.fields["System.Description" as keyof typeof wi.fields] as string | null)
      ?? (wi.fields as Record<string, unknown>)["Microsoft.VSTS.TCM.ReproSteps"] as string | null
      ?? null,
    acceptanceCriteria: wi.fields["Microsoft.VSTS.Common.AcceptanceCriteria" as keyof typeof wi.fields] as string | null ?? null,
    storyPoints: (wi.fields as Record<string, unknown>)["Microsoft.VSTS.Scheduling.StoryPoints"] as number | null ?? null,
    remainingWork: (wi.fields as Record<string, unknown>)["Microsoft.VSTS.Scheduling.RemainingWork"] as number | null ?? null,
    originalEstimate: (wi.fields as Record<string, unknown>)["Microsoft.VSTS.Scheduling.OriginalEstimate"] as number | null ?? null,
    completedWork: (wi.fields as Record<string, unknown>)["Microsoft.VSTS.Scheduling.CompletedWork"] as number | null ?? null,
    boardColumn: (wi.fields as Record<string, unknown>)["System.BoardColumn"] as string | null ?? null,
    comments,
  };
}

export async function fetchIterations(): Promise<Iteration[]> {
  const cached = getCached<Iteration[]>("iterations");
  if (cached) return cached;

  const res = await fetch(
    apiUrl(`work/teamsettings/iterations?api-version=${API_VERSION}`),
    { headers: { Authorization: getAuthHeader() } }
  );

  if (!res.ok) return [];

  const data = await res.json();
  const iterations = (data.value ?? []).map((i: { id: string; name: string; path: string; attributes?: { startDate?: string; finishDate?: string } }) => ({
    id: i.id,
    name: i.name,
    path: i.path,
    startDate: i.attributes?.startDate ?? null,
    finishDate: i.attributes?.finishDate ?? null,
  }));

  setCache("iterations", iterations, 5 * 60_000);
  return iterations;
}

// --- Unfinished sprint items (carry-over candidates) ---

export async function queryUnfinishedSprintItems(iterationPath: string): Promise<WorkItemWithChildren[]> {
  const conditions: string[] = [
    `[System.TeamProject] = @project`,
    `[System.AreaPath] = '${AREA_PATH}'`,
    `([System.WorkItemType] = 'Product Backlog Item' OR [System.WorkItemType] = 'Bug' OR [System.WorkItemType] = 'User Story')`,
    `[System.IterationPath] = '${iterationPath}'`,
    `[System.State] NOT IN ('Closed', 'Done', 'Removed')`,
  ];

  const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${conditions.join(" AND ")} ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC`;

  const wiqlRes = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: wiql }),
  });

  if (!wiqlRes.ok) {
    const error = await wiqlRes.text();
    throw new Error(`WIQL query failed (${wiqlRes.status}): ${error}`);
  }

  const wiqlData: WiqlResponse = await wiqlRes.json();
  if (wiqlData.workItems.length === 0) return [];

  const pbiIds = wiqlData.workItems.map((wi) => wi.id);
  const rawPBIs = await fetchWorkItemsBatch(pbiIds, true);

  const childIdsByPbi = new Map<number, number[]>();
  const allChildIds = new Set<number>();

  for (const pbi of rawPBIs) {
    const childIds = extractChildIds(pbi);
    childIdsByPbi.set(pbi.id, childIds);
    for (const id of childIds) allChildIds.add(id);
  }

  // Collect parent IDs
  const allParentIds = new Set<number>();
  const parentIdByPbi = new Map<number, number>();
  for (const pbi of rawPBIs) {
    const parentId = extractParentId(pbi);
    if (parentId) {
      allParentIds.add(parentId);
      parentIdByPbi.set(pbi.id, parentId);
    }
  }

  // Fetch children + parents in parallel
  const [childMap, parentMap] = await Promise.all([
    (async () => {
      const map = new Map<number, WorkItem>();
      if (allChildIds.size > 0) {
        const rawChildren = await fetchWorkItemsBatch([...allChildIds]);
        for (const raw of rawChildren) map.set(raw.id, mapWorkItem(raw));
      }
      return map;
    })(),
    (async () => {
      const map = new Map<number, { id: number; title: string }>();
      if (allParentIds.size > 0) {
        const rawParents = await fetchWorkItemsBatch([...allParentIds]);
        for (const raw of rawParents) {
          map.set(raw.id, { id: raw.id, title: raw.fields["System.Title"] });
        }
      }
      return map;
    })(),
  ]);

  return rawPBIs.map((rawPbi) => {
    const pbi = mapWorkItem(rawPbi);
    const childIds = childIdsByPbi.get(rawPbi.id) ?? [];
    const children = childIds
      .map((id) => childMap.get(id))
      .filter((c): c is WorkItem => c !== undefined);
    const parentId = parentIdByPbi.get(rawPbi.id) ?? null;
    const parent = parentId ? parentMap.get(parentId) : undefined;
    return {
      ...pbi,
      children,
      childCount: childIds.length,
      parentId: parent?.id ?? null,
      parentTitle: parent?.title ?? null,
    };
  });
}

export async function querySprintPlanningItems(): Promise<WorkItemWithChildren[]> {
  const conditions: string[] = [
    `[System.TeamProject] = @project`,
    `[System.AreaPath] = '${AREA_PATH}'`,
    `([System.WorkItemType] = 'Product Backlog Item' OR [System.WorkItemType] = 'Bug')`,
    `[Custom.SprintPlanning] = true`,
    `[System.IterationPath] = '${AREA_PATH}'`,
    `[System.State] = 'Approved'`,
  ];

  const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${conditions.join(" AND ")} ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC`;

  const wiqlRes = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: wiql }),
  });

  if (!wiqlRes.ok) {
    const error = await wiqlRes.text();
    throw new Error(`WIQL query failed (${wiqlRes.status}): ${error}`);
  }

  const wiqlData: WiqlResponse = await wiqlRes.json();

  if (wiqlData.workItems.length === 0) {
    return [];
  }

  const pbiIds = wiqlData.workItems.map((wi) => wi.id);
  const rawPBIs = await fetchWorkItemsBatch(pbiIds, true);

  const childIdsByPbi = new Map<number, number[]>();
  const allChildIds = new Set<number>();

  for (const pbi of rawPBIs) {
    const childIds = extractChildIds(pbi);
    childIdsByPbi.set(pbi.id, childIds);
    for (const id of childIds) allChildIds.add(id);
  }

  // Collect parent IDs
  const allParentIds = new Set<number>();
  const parentIdByPbi = new Map<number, number>();
  for (const pbi of rawPBIs) {
    const parentId = extractParentId(pbi);
    if (parentId) {
      allParentIds.add(parentId);
      parentIdByPbi.set(pbi.id, parentId);
    }
  }

  // Fetch children + parents in parallel
  const [childMap, parentMap] = await Promise.all([
    (async () => {
      const map = new Map<number, WorkItem>();
      if (allChildIds.size > 0) {
        const rawChildren = await fetchWorkItemsBatch([...allChildIds]);
        for (const raw of rawChildren) map.set(raw.id, mapWorkItem(raw));
      }
      return map;
    })(),
    (async () => {
      const map = new Map<number, { id: number; title: string }>();
      if (allParentIds.size > 0) {
        const rawParents = await fetchWorkItemsBatch([...allParentIds]);
        for (const raw of rawParents) {
          map.set(raw.id, { id: raw.id, title: raw.fields["System.Title"] });
        }
      }
      return map;
    })(),
  ]);

  return rawPBIs.map((rawPbi) => {
    const pbi = mapWorkItem(rawPbi);
    const childIds = childIdsByPbi.get(rawPbi.id) ?? [];
    const children = childIds
      .map((id) => childMap.get(id))
      .filter((c): c is WorkItem => c !== undefined);
    const parentId = parentIdByPbi.get(rawPbi.id) ?? null;
    const parent = parentId ? parentMap.get(parentId) : undefined;
    return {
      ...pbi,
      children,
      childCount: childIds.length,
      parentId: parent?.id ?? null,
      parentTitle: parent?.title ?? null,
    };
  });
}

export async function queryRefinementItems(): Promise<WorkItemWithChildren[]> {
  const conditions: string[] = [
    `[System.TeamProject] = @project`,
    `[System.AreaPath] = '${AREA_PATH}'`,
    `([System.WorkItemType] = 'Product Backlog Item' OR [System.WorkItemType] = 'Bug')`,
    `[Custom.Refinement] = true`,
    `[System.State] = 'Team Grooming'`,
  ];

  const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${conditions.join(" AND ")} ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC`;

  const wiqlRes = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: wiql }),
  });

  if (!wiqlRes.ok) {
    const error = await wiqlRes.text();
    throw new Error(`WIQL query failed (${wiqlRes.status}): ${error}`);
  }

  const wiqlData: WiqlResponse = await wiqlRes.json();

  if (wiqlData.workItems.length === 0) {
    return [];
  }

  const pbiIds = wiqlData.workItems.map((wi) => wi.id);
  const rawPBIs = await fetchWorkItemsBatch(pbiIds, true);

  const childIdsByPbi = new Map<number, number[]>();
  const allChildIds = new Set<number>();

  for (const pbi of rawPBIs) {
    const childIds = extractChildIds(pbi);
    childIdsByPbi.set(pbi.id, childIds);
    for (const id of childIds) allChildIds.add(id);
  }

  const allParentIds = new Set<number>();
  const parentIdByPbi = new Map<number, number>();
  for (const pbi of rawPBIs) {
    const parentId = extractParentId(pbi);
    if (parentId) {
      allParentIds.add(parentId);
      parentIdByPbi.set(pbi.id, parentId);
    }
  }

  const [childMap, parentMap] = await Promise.all([
    (async () => {
      const map = new Map<number, WorkItem>();
      if (allChildIds.size > 0) {
        const rawChildren = await fetchWorkItemsBatch([...allChildIds]);
        for (const raw of rawChildren) map.set(raw.id, mapWorkItem(raw));
      }
      return map;
    })(),
    (async () => {
      const map = new Map<number, { id: number; title: string }>();
      if (allParentIds.size > 0) {
        const rawParents = await fetchWorkItemsBatch([...allParentIds]);
        for (const raw of rawParents) {
          map.set(raw.id, { id: raw.id, title: raw.fields["System.Title"] });
        }
      }
      return map;
    })(),
  ]);

  return rawPBIs.map((rawPbi) => {
    const pbi = mapWorkItem(rawPbi);
    const childIds = childIdsByPbi.get(rawPbi.id) ?? [];
    const children = childIds
      .map((id) => childMap.get(id))
      .filter((c): c is WorkItem => c !== undefined);
    const parentId = parentIdByPbi.get(rawPbi.id) ?? null;
    const parent = parentId ? parentMap.get(parentId) : undefined;
    return {
      ...pbi,
      children,
      childCount: childIds.length,
      parentId: parent?.id ?? null,
      parentTitle: parent?.title ?? null,
    };
  });
}

export async function queryCleanupItems(minAgeDays: number = 30): Promise<WorkItemWithChildren[]> {
  const conditions: string[] = [
    `[System.TeamProject] = @project`,
    `[System.AreaPath] = '${AREA_PATH}'`,
    `([System.WorkItemType] = 'Product Backlog Item' OR [System.WorkItemType] = 'Bug' OR [System.WorkItemType] = 'User Story')`,
    `[System.State] NOT IN ('Closed', 'Done', 'Removed')`,
    `[System.ChangedDate] < @today - ${minAgeDays}`,
  ];

  const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${conditions.join(" AND ")} ORDER BY [System.ChangedDate] ASC`;

  const wiqlRes = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: wiql }),
  });

  if (!wiqlRes.ok) {
    const error = await wiqlRes.text();
    throw new Error(`WIQL query failed (${wiqlRes.status}): ${error}`);
  }

  const wiqlData: WiqlResponse = await wiqlRes.json();

  if (wiqlData.workItems.length === 0) {
    return [];
  }

  // Fetch with expand=all to get child relations
  const ids = wiqlData.workItems.map((wi) => wi.id);
  const rawItems = await fetchWorkItemsBatch(ids, true);

  return rawItems.map((raw) => {
    const item = mapWorkItem(raw);
    const childIds = extractChildIds(raw);
    return {
      ...item,
      children: [],
      childCount: childIds.length,
    };
  });
}

export async function updateWorkItemFields(
  id: number,
  fields: { iterationPath?: string; description?: string; acceptanceCriteria?: string; assignedTo?: string | null; storyPoints?: number | null; remainingWork?: number | null; originalEstimate?: number | null; tags?: string; sprintPlanning?: boolean; refinement?: boolean; priority?: number; state?: string },
  workItemType?: string,
): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid work item ID");

  const ops: { op: string; path: string; value: unknown }[] = [];

  if (fields.state !== undefined) {
    ops.push({ op: "replace", path: "/fields/System.State", value: fields.state });
  }
  if (fields.iterationPath !== undefined) {
    ops.push({ op: "replace", path: "/fields/System.IterationPath", value: fields.iterationPath });
  }
  if (fields.description !== undefined) {
    const descField = workItemType === "Bug" ? "/fields/Microsoft.VSTS.TCM.ReproSteps" : "/fields/System.Description";
    ops.push({ op: "replace", path: descField, value: fields.description });
  }
  if (fields.acceptanceCriteria !== undefined) {
    ops.push({ op: "replace", path: "/fields/Microsoft.VSTS.Common.AcceptanceCriteria", value: fields.acceptanceCriteria });
  }
  if (fields.assignedTo !== undefined) {
    ops.push({ op: "replace", path: "/fields/System.AssignedTo", value: fields.assignedTo ?? "" });
  }
  if (fields.storyPoints !== undefined) {
    ops.push({ op: "replace", path: "/fields/Microsoft.VSTS.Scheduling.StoryPoints", value: fields.storyPoints });
  }
  if (fields.remainingWork !== undefined) {
    ops.push({ op: "replace", path: "/fields/Microsoft.VSTS.Scheduling.RemainingWork", value: fields.remainingWork });
  }
  if (fields.originalEstimate !== undefined) {
    ops.push({ op: "replace", path: "/fields/Microsoft.VSTS.Scheduling.OriginalEstimate", value: fields.originalEstimate });
  }
  if (fields.tags !== undefined) {
    ops.push({ op: "replace", path: "/fields/System.Tags", value: fields.tags });
  }
  if (fields.sprintPlanning !== undefined) {
    ops.push({ op: "replace", path: "/fields/Custom.SprintPlanning", value: fields.sprintPlanning });
  }
  if (fields.refinement !== undefined) {
    ops.push({ op: "replace", path: "/fields/Custom.Refinement", value: fields.refinement });
  }
  if (fields.priority !== undefined) {
    ops.push({ op: "replace", path: "/fields/Microsoft.VSTS.Common.Priority", value: fields.priority });
  }

  if (ops.length === 0) return;

  const res = await fetch(apiUrl(`wit/workitems/${id}?api-version=${API_VERSION}`), {
    method: "PATCH",
    headers: { Authorization: getAuthHeader(), "Content-Type": "application/json-patch+json" },
    body: JSON.stringify(ops),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Update failed (${res.status}): ${error}`);
  }
}

export async function addComment(id: number, text: string): Promise<WorkItemComment> {
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid work item ID");
  if (!text.trim()) throw new Error("Comment text is required");

  const res = await fetch(apiUrl(`wit/workitems/${id}/comments?api-version=7.1-preview.4`), {
    method: "POST",
    headers: { Authorization: getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.trim() }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Add comment failed (${res.status}): ${error}`);
  }

  const c = await res.json();
  return {
    id: c.id,
    text: c.text,
    createdDate: c.createdDate,
    createdBy: c.createdBy.displayName,
  };
}

export async function bulkUpdateIterationPath(ids: number[], iterationPath: string): Promise<{ succeeded: number[]; failed: { id: number; error: string }[] }> {
  const result: { succeeded: number[]; failed: { id: number; error: string }[] } = { succeeded: [], failed: [] };

  const ops = [{ op: "replace", path: "/fields/System.IterationPath", value: iterationPath }];

  await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await fetch(apiUrl(`wit/workitems/${id}?api-version=${API_VERSION}`), {
          method: "PATCH",
          headers: { Authorization: getAuthHeader(), "Content-Type": "application/json-patch+json" },
          body: JSON.stringify(ops),
        });
        if (!res.ok) {
          const error = await res.text();
          result.failed.push({ id, error });
        } else {
          result.succeeded.push(id);
        }
      } catch (e) {
        result.failed.push({ id, error: e instanceof Error ? e.message : "Unknown error" });
      }
    })
  );

  return result;
}

// --- Sprint Capacity ---

interface CapacityApiResponse {
  teamMembers: {
    teamMember: { displayName: string };
    activities: { name: string; capacityPerDay: number }[];
    daysOff: { start: string; end: string }[];
  }[];
}

interface TeamDaysOffResponse {
  daysOff: { start: string; end: string }[];
}

function countWeekdays(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);
  while (d <= e) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function countDaysOffInRange(daysOff: { start: string; end: string }[], rangeStart: Date, rangeEnd: Date): number {
  let total = 0;
  for (const period of daysOff) {
    const offStart = new Date(Math.max(new Date(period.start).getTime(), rangeStart.getTime()));
    const offEnd = new Date(Math.min(new Date(period.end).getTime(), rangeEnd.getTime()));
    offStart.setHours(0, 0, 0, 0);
    offEnd.setHours(0, 0, 0, 0);
    if (offStart <= offEnd) {
      total += countWeekdays(offStart, offEnd);
    }
  }
  return total;
}

async function fetchSprintWorkload(iterationPath: string): Promise<Map<string, number>> {
  const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AreaPath] = '${AREA_PATH}' AND [System.WorkItemType] = 'Task' AND [System.IterationPath] = '${iterationPath}' AND [System.State] NOT IN ('Closed', 'Done', 'Removed')`;

  const wiqlRes = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
    method: "POST",
    headers: { Authorization: getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ query: wiql }),
  });

  if (!wiqlRes.ok) return new Map();

  const wiqlData: WiqlResponse = await wiqlRes.json();
  if (wiqlData.workItems.length === 0) return new Map();

  const fields = "System.AssignedTo,Microsoft.VSTS.Scheduling.RemainingWork,Microsoft.VSTS.Common.Activity";
  const ids = wiqlData.workItems.map((wi) => wi.id);
  const batchSize = 200;

  const workload = new Map<string, number>();

  for (let i = 0; i < ids.length; i += batchSize) {
    const batchIds = ids.slice(i, i + batchSize).join(",");
    const res = await fetch(apiUrl(`wit/workitems?ids=${batchIds}&fields=${fields}&api-version=${API_VERSION}`), {
      headers: { Authorization: getAuthHeader() },
    });
    if (!res.ok) continue;

    const data: WorkItemFieldsResponse = await res.json();
    for (const wi of data.value) {
      const f = wi.fields as Record<string, unknown>;
      const assignee = (f["System.AssignedTo"] as { displayName: string } | undefined)?.displayName;
      const activity = (f["Microsoft.VSTS.Common.Activity"] as string) || "Development";
      const hours = (f["Microsoft.VSTS.Scheduling.RemainingWork"] as number) || 0;

      if (assignee && hours > 0) {
        const key = `${assignee}::${activity}`;
        workload.set(key, (workload.get(key) ?? 0) + hours);
      }
    }
  }

  return workload;
}

export async function fetchSprintCapacity(iterationId: string): Promise<SprintCapacityData> {
  // Find iteration details
  const iterations = await fetchIterations();
  const iteration = iterations.find((i) => i.id === iterationId);
  if (!iteration || !iteration.startDate || !iteration.finishDate) {
    throw new Error("Iteration not found or has no dates");
  }

  // Fetch capacities + team days off + workload in parallel
  const [capacityRes, teamDaysOffRes, workload] = await Promise.all([
    fetch(apiUrl(`work/teamsettings/iterations/${iterationId}/capacities?api-version=${API_VERSION}`), {
      headers: { Authorization: getAuthHeader() },
    }),
    fetch(apiUrl(`work/teamsettings/iterations/${iterationId}/teamdaysoff?api-version=${API_VERSION}`), {
      headers: { Authorization: getAuthHeader() },
    }),
    fetchSprintWorkload(iteration.path),
  ]);

  if (!capacityRes.ok) {
    throw new Error(`Capacity API failed (${capacityRes.status})`);
  }

  const capacityData: CapacityApiResponse = await capacityRes.json();
  const teamDaysOff: TeamDaysOffResponse = teamDaysOffRes.ok ? await teamDaysOffRes.json() : { daysOff: [] };

  const start = new Date(iteration.startDate);
  const end = new Date(iteration.finishDate);

  const totalWeekdays = countWeekdays(start, end);
  const teamDaysOffCount = countDaysOffInRange(teamDaysOff.daysOff, start, end);
  const sprintWorkDays = totalWeekdays - teamDaysOffCount;

  const members: SprintCapacityMember[] = capacityData.teamMembers.map((tm) => {
    const personalDaysOff = countDaysOffInRange(tm.daysOff, start, end);
    const memberWorkDays = Math.max(0, sprintWorkDays - personalDaysOff);

    const activities = tm.activities
      .filter((a) => a.capacityPerDay > 0)
      .map((a) => {
        const capacityHours = Math.round(a.capacityPerDay * memberWorkDays * 10) / 10;
        const assignedHours = Math.round((workload.get(`${tm.teamMember.displayName}::${a.name}`) ?? 0) * 10) / 10;
        return { name: a.name, capacityHours, assignedHours };
      });

    return {
      displayName: tm.teamMember.displayName,
      activities,
      totalCapacity: activities.reduce((s, a) => s + a.capacityHours, 0),
      totalAssigned: activities.reduce((s, a) => s + a.assignedHours, 0),
    };
  });

  members.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return { members, sprintWorkDays };
}

// --- Sprint Analytics ---

const DONE_STATES = new Set(["Done", "Closed"]);
const REMOVED_STATES = new Set(["Removed"]);
const ACTIVE_STATES = new Set(["Active", "In Progress", "Ready for Test", "In Review"]);

function mapSprintWorkItem(
  wi: WorkItemRaw,
  parentInfo: Map<number, { id: number; title: string }>
): SprintWorkItem {
  const f = wi.fields as Record<string, unknown>;
  const parentId = extractParentId(wi);
  const parent = parentId ? parentInfo.get(parentId) : null;

  return {
    id: wi.id,
    title: wi.fields["System.Title"],
    state: wi.fields["System.State"],
    type: wi.fields["System.WorkItemType"],
    assignedTo: wi.fields["System.AssignedTo"]?.displayName ?? null,
    changedDate: wi.fields["System.ChangedDate"],
    remainingWork: (f["Microsoft.VSTS.Scheduling.RemainingWork"] as number | null) ?? null,
    completedWork: (f["Microsoft.VSTS.Scheduling.CompletedWork"] as number | null) ?? null,
    originalEstimate: (f["Microsoft.VSTS.Scheduling.OriginalEstimate"] as number | null) ?? null,
    storyPoints: (f["Microsoft.VSTS.Scheduling.StoryPoints"] as number | null) ?? null,
    activity: (f["Microsoft.VSTS.Common.Activity"] as string | null) ?? null,
    priority: wi.fields["Microsoft.VSTS.Common.Priority"] ?? 4,
    tags: wi.fields["System.Tags"] ?? "",
    parentId: parent?.id ?? null,
    parentTitle: parent?.title ?? null,
    url: wi._links?.html?.href ?? `https://dev.azure.com/${ORG}/${encodeURIComponent(PROJECT)}/_workitems/edit/${wi.id}`,
  };
}

function computeMemberStats(items: SprintWorkItem[]): MemberSprintStats {
  let completed = 0, active = 0, newItems = 0, removed = 0;
  let completedHours = 0, remainingHours = 0, originalEstimateHours = 0;

  for (const item of items) {
    if (DONE_STATES.has(item.state)) completed++;
    else if (REMOVED_STATES.has(item.state)) removed++;
    else if (ACTIVE_STATES.has(item.state)) active++;
    else newItems++;

    completedHours += item.completedWork ?? 0;
    remainingHours += item.remainingWork ?? 0;
    originalEstimateHours += item.originalEstimate ?? 0;
  }

  return {
    total: items.length,
    completed,
    active,
    newItems,
    removed,
    completedHours: Math.round(completedHours * 10) / 10,
    remainingHours: Math.round(remainingHours * 10) / 10,
    originalEstimateHours: Math.round(originalEstimateHours * 10) / 10,
  };
}

export async function fetchSprintAnalytics(iterationId: string): Promise<SprintAnalyticsData> {
  // 1. Get iteration details
  const iterations = await fetchIterations();
  const iteration = iterations.find((i) => i.id === iterationId);
  if (!iteration || !iteration.startDate || !iteration.finishDate) {
    throw new Error("Iteration not found or has no dates");
  }

  // 2. Fetch capacity + all sprint items in parallel
  const [capacityData, sprintItems] = await Promise.all([
    fetchSprintCapacity(iterationId),
    (async () => {
      // Query ALL items in sprint (including Done/Closed/Removed)
      const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AreaPath] = '${AREA_PATH}' AND [System.IterationPath] = '${iteration.path}' ORDER BY [System.AssignedTo] ASC, [Microsoft.VSTS.Common.Priority] ASC`;

      const wiqlRes = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
        method: "POST",
        headers: { Authorization: getAuthHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ query: wiql }),
      });

      if (!wiqlRes.ok) throw new Error(`WIQL failed (${wiqlRes.status})`);
      const wiqlData: WiqlResponse = await wiqlRes.json();
      if (wiqlData.workItems.length === 0) return [];

      // Fetch with $expand=all to get relations (parent links)
      const ids = wiqlData.workItems.map((wi) => wi.id);
      const rawItems = await fetchWorkItemsBatch(ids, true);

      // Collect parent IDs for title resolution
      const allParentIds = new Set<number>();
      for (const wi of rawItems) {
        const pid = extractParentId(wi);
        if (pid && !ids.includes(pid)) allParentIds.add(pid);
      }

      // Fetch parent titles
      const parentInfo = new Map<number, { id: number; title: string }>();
      if (allParentIds.size > 0) {
        const rawParents = await fetchWorkItemsBatch([...allParentIds]);
        for (const p of rawParents) {
          parentInfo.set(p.id, { id: p.id, title: p.fields["System.Title"] });
        }
      }
      // Also add items that are parents within the sprint
      for (const wi of rawItems) {
        if (!parentInfo.has(wi.id)) {
          parentInfo.set(wi.id, { id: wi.id, title: wi.fields["System.Title"] });
        }
      }

      return rawItems.map((wi) => mapSprintWorkItem(wi, parentInfo));
    })(),
  ]);

  // 3. Group items by assignee
  const memberMap = new Map<string, SprintWorkItem[]>();
  const unassignedItems: SprintWorkItem[] = [];

  for (const item of sprintItems) {
    if (!item.assignedTo) {
      unassignedItems.push(item);
    } else {
      const list = memberMap.get(item.assignedTo) ?? [];
      list.push(item);
      memberMap.set(item.assignedTo, list);
    }
  }

  // Include capacity-only members (members with capacity but no items in sprint)
  for (const cm of capacityData.members) {
    if (!memberMap.has(cm.displayName)) {
      memberMap.set(cm.displayName, []);
    }
  }

  // 4. Build member analytics
  const capacityMap = new Map(capacityData.members.map((m) => [m.displayName, m]));

  const members: MemberAnalytics[] = [...memberMap.entries()]
    .map(([name, items]) => ({
      displayName: name,
      items,
      capacity: capacityMap.get(name) ?? null,
      stats: computeMemberStats(items),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    members,
    unassignedItems,
    sprintWorkDays: capacityData.sprintWorkDays,
    sprintName: iteration.name,
  };
}

export async function createChildTask(
  parentId: number,
  title: string,
  iterationPath: string,
  options?: { remainingWork?: number; activity?: string; tags?: string; assignedTo?: string }
): Promise<WorkItem> {
  if (!Number.isInteger(parentId) || parentId <= 0) throw new Error("Invalid parent ID");
  if (!title.trim()) throw new Error("Title is required");

  const ops: { op: string; path: string; value: unknown; from?: null }[] = [
    { op: "add", path: "/fields/System.Title", value: title },
    { op: "add", path: "/fields/System.WorkItemType", value: "Task" },
    { op: "add", path: "/fields/System.AreaPath", value: AREA_PATH },
    { op: "add", path: "/fields/System.IterationPath", value: iterationPath },
    {
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: `https://dev.azure.com/${ORG}/_apis/wit/workItems/${parentId}`,
        attributes: { name: "Parent" },
      },
    },
  ];

  if (options?.remainingWork != null && options.remainingWork > 0) {
    ops.push({ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.RemainingWork", value: options.remainingWork });
  }
  if (options?.activity) {
    ops.push({ op: "add", path: "/fields/Microsoft.VSTS.Common.Activity", value: options.activity });
  }
  if (options?.tags) {
    ops.push({ op: "add", path: "/fields/System.Tags", value: options.tags });
  }
  if (options?.assignedTo) {
    ops.push({ op: "add", path: "/fields/System.AssignedTo", value: options.assignedTo });
  }

  const res = await fetch(apiUrl(`wit/workitems/$Task?api-version=${API_VERSION}`), {
    method: "POST",
    headers: { Authorization: getAuthHeader(), "Content-Type": "application/json-patch+json" },
    body: JSON.stringify(ops),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Create task failed (${res.status}): ${error}`);
  }

  const wi: WorkItemRaw = await res.json();
  return mapWorkItem(wi);
}

export async function createWorkItem(
  type: "Product Backlog Item" | "Bug",
  title: string,
  options?: {
    description?: string;
    acceptanceCriteria?: string;
    priority?: number;
    tags?: string;
    iterationPath?: string;
    assignedTo?: string;
    refinement?: boolean;
    sprintPlanning?: boolean;
    parentId?: number;
  }
): Promise<WorkItem> {
  if (!title.trim()) throw new Error("Title is required");

  const ops: { op: string; path: string; value: unknown; from?: null }[] = [
    { op: "add", path: "/fields/System.Title", value: title },
    { op: "add", path: "/fields/System.AreaPath", value: AREA_PATH },
  ];

  if (options?.iterationPath) {
    ops.push({ op: "add", path: "/fields/System.IterationPath", value: options.iterationPath });
  }
  if (options?.description) {
    const descField = type === "Bug" ? "/fields/Microsoft.VSTS.TCM.ReproSteps" : "/fields/System.Description";
    ops.push({ op: "add", path: descField, value: options.description });
  }
  if (options?.acceptanceCriteria) {
    ops.push({ op: "add", path: "/fields/Microsoft.VSTS.Common.AcceptanceCriteria", value: options.acceptanceCriteria });
  }
  if (options?.priority != null) {
    ops.push({ op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: options.priority });
  }
  if (options?.tags) {
    ops.push({ op: "add", path: "/fields/System.Tags", value: options.tags });
  }
  if (options?.assignedTo) {
    ops.push({ op: "add", path: "/fields/System.AssignedTo", value: options.assignedTo });
  }
  if (options?.refinement != null) {
    ops.push({ op: "add", path: "/fields/Custom.Refinement", value: options.refinement });
  }
  if (options?.sprintPlanning != null) {
    ops.push({ op: "add", path: "/fields/Custom.SprintPlanning", value: options.sprintPlanning });
  }
  if (options?.parentId != null && Number.isInteger(options.parentId) && options.parentId > 0) {
    ops.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: `https://dev.azure.com/${ORG}/_apis/wit/workItems/${options.parentId}`,
        attributes: { name: "Parent" },
      },
    });
  }

  const typeSlug = encodeURIComponent(type);
  const res = await fetch(apiUrl(`wit/workitems/$${typeSlug}?api-version=${API_VERSION}`), {
    method: "POST",
    headers: { Authorization: getAuthHeader(), "Content-Type": "application/json-patch+json" },
    body: JSON.stringify(ops),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Create ${type} failed (${res.status}): ${error}`);
  }

  const wi: WorkItemRaw = await res.json();
  return mapWorkItem(wi);
}

// --- Vacation Overview ---

export async function fetchVacationOverview(iterationIds: string[]): Promise<VacationOverviewData> {
  const iterations = await fetchIterations();
  const iterationMap = new Map(iterations.map((i) => [i.id, i]));

  const results = await Promise.all(
    iterationIds.map(async (iterationId): Promise<SprintVacationData | null> => {
      const iteration = iterationMap.get(iterationId);
      if (!iteration || !iteration.startDate || !iteration.finishDate) {
        return null;
      }

      const [capacityRes, teamDaysOffRes] = await Promise.all([
        fetch(apiUrl(`work/teamsettings/iterations/${iterationId}/capacities?api-version=${API_VERSION}`), {
          headers: { Authorization: getAuthHeader() },
        }),
        fetch(apiUrl(`work/teamsettings/iterations/${iterationId}/teamdaysoff?api-version=${API_VERSION}`), {
          headers: { Authorization: getAuthHeader() },
        }),
      ]);

      const capacityData: CapacityApiResponse = capacityRes.ok
        ? await capacityRes.json()
        : { teamMembers: [] };
      const teamDaysOff: TeamDaysOffResponse = teamDaysOffRes.ok
        ? await teamDaysOffRes.json()
        : { daysOff: [] };

      const start = new Date(iteration.startDate!);
      const end = new Date(iteration.finishDate!);

      const totalWeekdays = countWeekdays(start, end);
      const teamDaysOffCount = countDaysOffInRange(teamDaysOff.daysOff, start, end);
      const totalWorkDays = totalWeekdays - teamDaysOffCount;

      const members = capacityData.teamMembers.map((tm) => {
        const daysOff: DaysOffPeriod[] = tm.daysOff.map((d) => ({
          start: d.start,
          end: d.end,
        }));
        const totalDaysOff = countDaysOffInRange(tm.daysOff, start, end);
        return {
          displayName: tm.teamMember.displayName,
          daysOff,
          totalDaysOff,
        };
      });

      members.sort((a, b) => a.displayName.localeCompare(b.displayName));

      const membersOnVacation = members.filter((m) => m.totalDaysOff > 0).length;
      const totalMembers = members.length;

      // Capacity: sum of each member's effective work days / (totalMembers * totalWorkDays)
      let effectiveDaysSum = 0;
      for (const m of members) {
        effectiveDaysSum += Math.max(0, totalWorkDays - m.totalDaysOff);
      }
      const maxDays = totalMembers * totalWorkDays;
      const capacityPercent = maxDays > 0 ? Math.round((effectiveDaysSum / maxDays) * 100) : 100;

      return {
        iterationId,
        sprintName: iteration.name,
        startDate: iteration.startDate!,
        finishDate: iteration.finishDate!,
        totalWorkDays,
        teamDaysOff: teamDaysOff.daysOff.map((d) => ({ start: d.start, end: d.end })),
        members,
        membersOnVacation,
        totalMembers,
        capacityPercent,
      };
    })
  );

  return { sprints: results.filter((s): s is SprintVacationData => s !== null) };
}

// --- Team Members from Azure DevOps ---

export async function fetchTeamMembers(): Promise<{ displayName: string; email: string; avatarUrl: string }[]> {
  const encodedProject = encodeURIComponent(PROJECT);

  // Step 1: Get teams for the project
  const teamsRes = await fetch(
    orgApiUrl(`projects/${encodedProject}/teams?api-version=${API_VERSION}`),
    { headers: { Authorization: getAuthHeader() } }
  );

  if (!teamsRes.ok) {
    throw new Error(`Teams API failed (${teamsRes.status}): ${await teamsRes.text()}`);
  }

  const teamsData: { value: { id: string; name: string }[] } = await teamsRes.json();
  if (teamsData.value.length === 0) return [];

  // Step 2: Fetch members from all teams
  const seen = new Map<string, { displayName: string; email: string; avatarUrl: string }>();

  for (const team of teamsData.value) {
    const membersRes = await fetch(
      orgApiUrl(`projects/${encodedProject}/teams/${encodeURIComponent(team.id)}/members?api-version=${API_VERSION}`),
      { headers: { Authorization: getAuthHeader() } }
    );

    if (!membersRes.ok) continue;

    const membersData: { value: { identity: { displayName: string; uniqueName: string; imageUrl?: string } }[] } = await membersRes.json();

    for (const m of membersData.value) {
      if (!seen.has(m.identity.displayName)) {
        seen.set(m.identity.displayName, {
          displayName: m.identity.displayName,
          email: m.identity.uniqueName ?? "",
          avatarUrl: m.identity.imageUrl ?? "",
        });
      }
    }
  }

  return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// --- Retrospective: Velocity ---

export async function fetchVelocityData(iterationIds: string[]): Promise<SprintVelocity[]> {
  const iterations = await fetchIterations();
  const iterationMap = new Map(iterations.map((i) => [i.id, i]));

  const results = await Promise.all(
    iterationIds.map(async (iterationId): Promise<SprintVelocity | null> => {
      const iteration = iterationMap.get(iterationId);
      if (!iteration || !iteration.startDate || !iteration.finishDate) return null;

      const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AreaPath] = '${AREA_PATH}' AND [System.IterationPath] = '${iteration.path}'`;

      const wiqlRes = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
        method: "POST",
        headers: { Authorization: getAuthHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ query: wiql }),
      });

      if (!wiqlRes.ok) return null;
      const wiqlData: WiqlResponse = await wiqlRes.json();

      if (wiqlData.workItems.length === 0) {
        return {
          iterationId, sprintName: iteration.name, startDate: iteration.startDate!, finishDate: iteration.finishDate!,
          completedPoints: 0, totalPoints: 0, completedItems: 0, totalItems: 0,
          completedHours: 0, remainingHours: 0, originalEstimateHours: 0,
        };
      }

      const fields = "System.State,System.WorkItemType,Microsoft.VSTS.Scheduling.StoryPoints,Microsoft.VSTS.Scheduling.RemainingWork,Microsoft.VSTS.Scheduling.CompletedWork,Microsoft.VSTS.Scheduling.OriginalEstimate";
      const ids = wiqlData.workItems.map((wi) => wi.id);

      let completedPoints = 0, totalPoints = 0, completedItems = 0, totalItems = 0;
      let completedHours = 0, remainingHours = 0, originalEstimateHours = 0;

      for (let i = 0; i < ids.length; i += 200) {
        const batchIds = ids.slice(i, i + 200).join(",");
        const res = await fetch(apiUrl(`wit/workitems?ids=${batchIds}&fields=${fields}&api-version=${API_VERSION}`), {
          headers: { Authorization: getAuthHeader() },
        });
        if (!res.ok) continue;
        const data: WorkItemFieldsResponse = await res.json();

        for (const wi of data.value) {
          const f = wi.fields as Record<string, unknown>;
          const state = f["System.State"] as string;
          const type = f["System.WorkItemType"] as string;
          const sp = (f["Microsoft.VSTS.Scheduling.StoryPoints"] as number) || 0;
          const cw = (f["Microsoft.VSTS.Scheduling.CompletedWork"] as number) || 0;
          const rw = (f["Microsoft.VSTS.Scheduling.RemainingWork"] as number) || 0;
          const oe = (f["Microsoft.VSTS.Scheduling.OriginalEstimate"] as number) || 0;

          if (type !== "Task") {
            totalItems++;
            totalPoints += sp;
            if (DONE_STATES.has(state)) {
              completedItems++;
              completedPoints += sp;
            }
          }

          completedHours += cw;
          remainingHours += rw;
          originalEstimateHours += oe;
        }
      }

      return {
        iterationId, sprintName: iteration.name, startDate: iteration.startDate!, finishDate: iteration.finishDate!,
        completedPoints: Math.round(completedPoints * 10) / 10,
        totalPoints: Math.round(totalPoints * 10) / 10,
        completedItems, totalItems,
        completedHours: Math.round(completedHours * 10) / 10,
        remainingHours: Math.round(remainingHours * 10) / 10,
        originalEstimateHours: Math.round(originalEstimateHours * 10) / 10,
      };
    })
  );

  return results.filter((r): r is SprintVelocity => r !== null);
}

// --- Retrospective: Carry-over ---

export async function fetchCarryOverItems(fromIterationId: string, toIterationId: string): Promise<CarryOverItem[]> {
  const iterations = await fetchIterations();
  const fromIteration = iterations.find((i) => i.id === fromIterationId);
  const toIteration = iterations.find((i) => i.id === toIterationId);
  if (!fromIteration || !toIteration) return [];

  // Items in "to" sprint that were also in "from" sprint → carried over
  // Strategy: query items in "to" sprint, then check which ones have changeDate before the "to" sprint started
  // Simpler: query incomplete items in "from" sprint (items that didn't finish there)
  const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AreaPath] = '${AREA_PATH}' AND [System.IterationPath] = '${toIteration.path}' AND ([System.WorkItemType] = 'Product Backlog Item' OR [System.WorkItemType] = 'Bug' OR [System.WorkItemType] = 'User Story') AND [System.State] NOT IN ('Removed') AND [System.CreatedDate] < '${toIteration.startDate}'`;

  const wiqlRes = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
    method: "POST",
    headers: { Authorization: getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ query: wiql }),
  });

  if (!wiqlRes.ok) return [];
  const wiqlData: WiqlResponse = await wiqlRes.json();
  if (wiqlData.workItems.length === 0) return [];

  const fields = "System.Title,System.State,System.WorkItemType,System.AssignedTo,Microsoft.VSTS.Scheduling.StoryPoints,Microsoft.VSTS.Scheduling.RemainingWork";
  const ids = wiqlData.workItems.map((wi) => wi.id);

  const items: CarryOverItem[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const batchIds = ids.slice(i, i + 200).join(",");
    const res = await fetch(apiUrl(`wit/workitems?ids=${batchIds}&fields=${fields}&api-version=${API_VERSION}`), {
      headers: { Authorization: getAuthHeader() },
    });
    if (!res.ok) continue;
    const data: WorkItemFieldsResponse = await res.json();

    for (const wi of data.value) {
      const f = wi.fields as Record<string, unknown>;
      items.push({
        id: wi.id,
        title: wi.fields["System.Title"],
        type: wi.fields["System.WorkItemType"],
        state: wi.fields["System.State"],
        assignedTo: wi.fields["System.AssignedTo"]?.displayName ?? null,
        storyPoints: (f["Microsoft.VSTS.Scheduling.StoryPoints"] as number) || null,
        remainingWork: (f["Microsoft.VSTS.Scheduling.RemainingWork"] as number) || null,
        fromSprint: fromIteration.name,
        toSprint: toIteration.name,
        url: wi._links?.html?.href ?? `https://dev.azure.com/${ORG}/${encodeURIComponent(PROJECT)}/_workitems/edit/${wi.id}`,
      });
    }
  }

  return items;
}

// --- Retrospective: Member comparison across sprints ---

export async function fetchMemberComparison(iterationIds: string[]): Promise<MemberSprintComparison[]> {
  // Fetch sprint analytics for each sprint (reuses existing function)
  const analyticsResults = await Promise.all(
    iterationIds.map(async (id) => {
      try {
        return await fetchSprintAnalytics(id);
      } catch {
        return null;
      }
    })
  );

  // Build per-member comparison
  const memberMap = new Map<string, MemberSprintComparison>();

  for (const analytics of analyticsResults) {
    if (!analytics) continue;
    for (const member of analytics.members) {
      if (!memberMap.has(member.displayName)) {
        memberMap.set(member.displayName, { displayName: member.displayName, sprints: [] });
      }
      const pbiItems = member.items.filter((i) => i.type !== "Task");
      const completedPbiItems = pbiItems.filter((i) => DONE_STATES.has(i.state));
      const completedPoints = completedPbiItems.reduce((s, i) => s + (i.storyPoints ?? 0), 0);

      memberMap.get(member.displayName)!.sprints.push({
        iterationId: analyticsResults.indexOf(analytics) < iterationIds.length ? iterationIds[analyticsResults.indexOf(analytics)] : "",
        sprintName: analytics.sprintName,
        completedItems: member.stats.completed,
        totalItems: member.stats.total,
        completedHours: member.stats.completedHours,
        remainingHours: member.stats.remainingHours,
        capacityHours: member.capacity?.totalCapacity ?? 0,
        completedPoints,
      });
    }
  }

  return [...memberMap.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// --- Sprint Planning: fetch PBI with its task structure (for copy) ---

export async function fetchPbiTaskStructure(pbiId: number): Promise<{ title: string; activity: string | null; remainingWork: number | null; tags: string }[]> {
  if (!Number.isInteger(pbiId) || pbiId <= 0) throw new Error("Invalid PBI ID");

  const rawItems = await fetchWorkItemsBatch([pbiId], true);
  if (rawItems.length === 0) return [];

  const childIds = extractChildIds(rawItems[0]);
  if (childIds.length === 0) return [];

  const fields = "System.Title,Microsoft.VSTS.Common.Activity,Microsoft.VSTS.Scheduling.RemainingWork,System.Tags,System.WorkItemType";
  const tasks: { title: string; activity: string | null; remainingWork: number | null; tags: string }[] = [];

  for (let i = 0; i < childIds.length; i += 200) {
    const batchIds = childIds.slice(i, i + 200).join(",");
    const res = await fetch(apiUrl(`wit/workitems?ids=${batchIds}&fields=${fields}&api-version=${API_VERSION}`), {
      headers: { Authorization: getAuthHeader() },
    });
    if (!res.ok) continue;
    const data: WorkItemFieldsResponse = await res.json();

    for (const wi of data.value) {
      if (wi.fields["System.WorkItemType"] !== "Task") continue;
      const f = wi.fields as Record<string, unknown>;
      tasks.push({
        title: wi.fields["System.Title"],
        activity: (f["Microsoft.VSTS.Common.Activity"] as string) || null,
        remainingWork: (f["Microsoft.VSTS.Scheduling.RemainingWork"] as number) || null,
        tags: (wi.fields["System.Tags"] as string) ?? "",
      });
    }
  }

  return tasks;
}

// --- Sprint Review: completed items in a sprint ---

export async function queryCompletedSprintItems(iterationPath: string): Promise<WorkItemWithChildren[]> {
  const conditions: string[] = [
    `[System.TeamProject] = @project`,
    `[System.AreaPath] = '${AREA_PATH}'`,
    `([System.WorkItemType] = 'Product Backlog Item' OR [System.WorkItemType] = 'Bug' OR [System.WorkItemType] = 'User Story')`,
    `[System.IterationPath] = '${iterationPath}'`,
    `[System.State] IN ('Done', 'Closed')`,
  ];

  const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${conditions.join(" AND ")} ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC`;

  const wiqlRes = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: wiql }),
  });

  if (!wiqlRes.ok) {
    const error = await wiqlRes.text();
    throw new Error(`WIQL query failed (${wiqlRes.status}): ${error}`);
  }

  const wiqlData: WiqlResponse = await wiqlRes.json();
  if (wiqlData.workItems.length === 0) return [];

  const pbiIds = wiqlData.workItems.map((wi) => wi.id);
  const rawPBIs = await fetchWorkItemsBatch(pbiIds, true);

  const childIdsByPbi = new Map<number, number[]>();
  const allChildIds = new Set<number>();

  for (const pbi of rawPBIs) {
    const childIds = extractChildIds(pbi);
    childIdsByPbi.set(pbi.id, childIds);
    for (const id of childIds) allChildIds.add(id);
  }

  const allParentIds = new Set<number>();
  const parentIdByPbi = new Map<number, number>();
  for (const pbi of rawPBIs) {
    const parentId = extractParentId(pbi);
    if (parentId) {
      allParentIds.add(parentId);
      parentIdByPbi.set(pbi.id, parentId);
    }
  }

  const [childMap, parentMap] = await Promise.all([
    (async () => {
      const map = new Map<number, WorkItem>();
      if (allChildIds.size > 0) {
        const rawChildren = await fetchWorkItemsBatch([...allChildIds]);
        for (const raw of rawChildren) map.set(raw.id, mapWorkItem(raw));
      }
      return map;
    })(),
    (async () => {
      const map = new Map<number, { id: number; title: string }>();
      if (allParentIds.size > 0) {
        const rawParents = await fetchWorkItemsBatch([...allParentIds]);
        for (const raw of rawParents) {
          map.set(raw.id, { id: raw.id, title: raw.fields["System.Title"] });
        }
      }
      return map;
    })(),
  ]);

  return rawPBIs.map((rawPbi) => {
    const pbi = mapWorkItem(rawPbi);
    const childIds = childIdsByPbi.get(rawPbi.id) ?? [];
    const children = childIds
      .map((id) => childMap.get(id))
      .filter((c): c is WorkItem => c !== undefined);
    const parentId = parentIdByPbi.get(rawPbi.id) ?? null;
    const parent = parentId ? parentMap.get(parentId) : undefined;
    return {
      ...pbi,
      children,
      childCount: childIds.length,
      parentId: parent?.id ?? null,
      parentTitle: parent?.title ?? null,
    };
  });
}

// --- Backlog Health Score ---

export async function queryBacklogHealth(): Promise<BacklogHealthData> {
  const conditions: string[] = [
    `[System.TeamProject] = @project`,
    `[System.AreaPath] = '${AREA_PATH}'`,
    `([System.WorkItemType] = 'Product Backlog Item' OR [System.WorkItemType] = 'Bug' OR [System.WorkItemType] = 'User Story')`,
    `[System.State] NOT IN ('Closed', 'Done', 'Removed')`,
  ];

  const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${conditions.join(" AND ")} ORDER BY [System.ChangedDate] DESC`;

  const wiqlRes = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
    method: "POST",
    headers: { Authorization: getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ query: wiql }),
  });

  if (!wiqlRes.ok) throw new Error(`WIQL query failed: ${wiqlRes.status}`);
  const wiqlData: WiqlResponse = await wiqlRes.json();

  const emptyResult: BacklogHealthData = {
    totalItems: 0, withEstimates: 0, withoutEstimates: 0,
    withAssignee: 0, withoutAssignee: 0, averageAgeDays: 0,
    refinementReady: 0, inRefinement: 0, sprintPlanning: 0, needsAttention: 0,
    byState: {}, byType: {},
    oldestItems: [], healthScore: 100,
  };

  if (wiqlData.workItems.length === 0) return emptyResult;

  const ids = wiqlData.workItems.map((wi) => wi.id);
  const rawItems = await fetchWorkItemsBatch(ids, true);

  const now = Date.now();
  let totalAge = 0;
  let withEstimates = 0;
  let withAssignee = 0;
  let inRefinement = 0;
  let sprintPlanning = 0;
  let needsAttention = 0;
  const byState: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const itemsWithAge: Array<{ id: number; title: string; type: string; state: string; ageDays: number; url: string }> = [];

  for (const raw of rawItems) {
    const f = raw.fields;
    const type = f["System.WorkItemType"];
    const state = f["System.State"];
    const assignedTo = f["System.AssignedTo"]?.displayName ?? null;
    const changedDate = f["System.ChangedDate"];
    const ageDays = Math.floor((now - new Date(changedDate).getTime()) / (1000 * 60 * 60 * 24));
    const childIds = extractChildIds(raw);
    const fa = f as Record<string, unknown>;
    const isRefinement = fa["Custom.Refinement"] === true;
    const isSP = fa["Custom.SprintPlanning"] === true;

    totalAge += ageDays;
    byState[state] = (byState[state] ?? 0) + 1;
    byType[type] = (byType[type] ?? 0) + 1;

    // Has estimates = has at least one child task (we can't check child hours without fetching them, so we approximate by having children)
    if (childIds.length > 0) withEstimates++;
    if (assignedTo) withAssignee++;
    if (isRefinement) inRefinement++;
    if (isSP) sprintPlanning++;

    // Needs attention: no assignee + no children + old (>30 days)
    if (!assignedTo && childIds.length === 0 && ageDays > 30) needsAttention++;

    itemsWithAge.push({
      id: raw.id,
      title: f["System.Title"],
      type,
      state,
      ageDays,
      url: raw._links?.html?.href ?? `https://dev.azure.com/${ORG}/${encodeURIComponent(PROJECT)}/_workitems/edit/${raw.id}`,
    });
  }

  const totalItems = rawItems.length;
  const averageAgeDays = totalItems > 0 ? Math.round(totalAge / totalItems) : 0;

  // Sort by age descending, take top 10
  itemsWithAge.sort((a, b) => b.ageDays - a.ageDays);
  const oldestItems = itemsWithAge.slice(0, 10);

  // Health score (0-100)
  // Components:
  // 1. Estimate coverage (30%): % of items with children/tasks
  const estimatePct = totalItems > 0 ? withEstimates / totalItems : 1;
  // 2. Assignee coverage (20%): % of items with assignee
  const assigneePct = totalItems > 0 ? withAssignee / totalItems : 1;
  // 3. Age health (25%): penalize for old items (0-30d = 100%, 30-90d = 50%, 90+ = 0%)
  const ageScore = averageAgeDays <= 30 ? 1 : averageAgeDays <= 90 ? 1 - (averageAgeDays - 30) / 120 : 0.1;
  // 4. Pipeline health (25%): items in refinement or sprint planning vs total
  const pipelinePct = totalItems > 0 ? (inRefinement + sprintPlanning) / totalItems : 0;

  const healthScore = Math.round(
    estimatePct * 30 + assigneePct * 20 + ageScore * 25 + Math.min(pipelinePct * 2, 1) * 25
  );

  return {
    totalItems,
    withEstimates,
    withoutEstimates: totalItems - withEstimates,
    withAssignee,
    withoutAssignee: totalItems - withAssignee,
    averageAgeDays,
    refinementReady: inRefinement + sprintPlanning,
    inRefinement,
    sprintPlanning,
    needsAttention,
    byState,
    byType,
    oldestItems,
    healthScore: Math.max(0, Math.min(100, healthScore)),
  };
}

// --- Fetch basic work item summaries by IDs ---

export async function fetchWorkItemSummaries(
  ids: number[]
): Promise<{ id: number; title: string; state: string; type: string; url: string }[]> {
  if (ids.length === 0) return [];
  const rawItems = await fetchWorkItemsBatch(ids);
  return rawItems.map((raw) => ({
    id: raw.id,
    title: raw.fields["System.Title"],
    state: raw.fields["System.State"],
    type: raw.fields["System.WorkItemType"],
    url:
      raw._links?.html?.href ??
      `https://dev.azure.com/${ORG}/${encodeURIComponent(PROJECT)}/_workitems/edit/${raw.id}`,
  }));
}

// --- Daily Standup ---

interface WorkItemUpdateRaw {
  id: number;
  workItemId: number;
  rev: number;
  revisedBy: { displayName: string };
  revisedDate: string;
  fields?: Record<string, { oldValue?: unknown; newValue?: unknown }>;
}

async function fetchWorkItemUpdates(
  id: number,
  sinceDate: Date,
  itemInfo: { title: string; type: string; url: string }
): Promise<WorkItemStateChange[]> {
  const res = await fetch(
    apiUrl(`wit/workitems/${id}/updates?$top=50&api-version=${API_VERSION}`),
    { headers: { Authorization: getAuthHeader() } }
  );
  if (!res.ok) return [];

  const data: { value: WorkItemUpdateRaw[] } = await res.json();
  const changes: WorkItemStateChange[] = [];

  for (const update of data.value) {
    if (!update.fields?.["System.State"]) continue;
    const stateField = update.fields["System.State"];
    if (!stateField.oldValue || !stateField.newValue) continue;
    if (stateField.oldValue === stateField.newValue) continue;

    const revisedDate = new Date(update.revisedDate);
    if (revisedDate < sinceDate) continue;

    changes.push({
      workItemId: id,
      title: itemInfo.title,
      type: itemInfo.type,
      oldState: stateField.oldValue as string,
      newState: stateField.newValue as string,
      changedDate: update.revisedDate,
      changedBy: update.revisedBy.displayName,
      url: itemInfo.url,
    });
  }

  return changes;
}

async function fetchRecentlyChangedIds(iterationPath: string, lookbackDays: number): Promise<number[]> {
  const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AreaPath] = '${AREA_PATH}' AND [System.IterationPath] = '${iterationPath}' AND [System.ChangedDate] >= @today - ${lookbackDays} ORDER BY [System.ChangedDate] DESC`;

  const res = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
    method: "POST",
    headers: { Authorization: getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ query: wiql }),
  });
  if (!res.ok) return [];

  const data: WiqlResponse = await res.json();
  return data.workItems.map((wi) => wi.id);
}

async function fetchAllSprintItems(iterationPath: string): Promise<WorkItem[]> {
  const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.AreaPath] = '${AREA_PATH}' AND [System.IterationPath] = '${iterationPath}' AND [System.State] NOT IN ('Closed', 'Done', 'Removed') ORDER BY [Microsoft.VSTS.Common.Priority] ASC, [System.ChangedDate] DESC`;

  const res = await fetch(apiUrl(`wit/wiql?api-version=${API_VERSION}`), {
    method: "POST",
    headers: { Authorization: getAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ query: wiql }),
  });
  if (!res.ok) return [];

  const data: WiqlResponse = await res.json();
  if (data.workItems.length === 0) return [];

  const rawItems = await fetchWorkItemsBatch(data.workItems.map((wi) => wi.id));
  return rawItems.map(mapWorkItem);
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

export async function fetchDailyStandupData(
  iterationId: string,
  stuckThresholdDays: number = 3
): Promise<DailyStandupData> {
  const cacheKey = `standup-${iterationId}`;
  const cached = getCached<DailyStandupData>(cacheKey);
  if (cached) return cached;

  // Resolve iteration
  const iterations = await fetchIterations();
  const iteration = iterations.find((i) => i.id === iterationId);
  if (!iteration || !iteration.startDate || !iteration.finishDate) {
    throw new Error("Iteration not found or has no dates");
  }

  // Monday lookback: cover Fri-Sun
  const now = new Date();
  const dayOfWeek = now.getDay();
  const lookbackDays = dayOfWeek === 1 ? 3 : 1;
  const lookbackHours = lookbackDays * 24;
  const sinceDate = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);

  // Parallel fetch: capacity, all sprint items, recently changed IDs
  const [capacityData, allItems, recentlyChangedIds] = await Promise.all([
    fetchSprintCapacity(iterationId),
    fetchAllSprintItems(iteration.path),
    fetchRecentlyChangedIds(iteration.path, lookbackDays),
  ]);

  // Build map of all sprint items for quick lookup
  const itemMap = new Map<number, WorkItem>();
  for (const item of allItems) {
    itemMap.set(item.id, item);
  }

  // Fetch state changes for recently changed items (concurrency=5)
  const stateChanges: WorkItemStateChange[] = [];
  const changedItemIds = recentlyChangedIds.filter((id) => true); // all IDs, including done items
  const concurrency = 5;

  for (let i = 0; i < changedItemIds.length; i += concurrency) {
    const batch = changedItemIds.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (id) => {
        // Use item from sprint items map, or fetch minimal info
        const item = itemMap.get(id);
        const info = item
          ? { title: item.title, type: item.type, url: item.url }
          : { title: `#${id}`, type: "Unknown", url: `https://dev.azure.com/${ORG}/${encodeURIComponent(PROJECT)}/_workitems/edit/${id}` };
        return fetchWorkItemUpdates(id, sinceDate, info);
      })
    );
    stateChanges.push(...results.flat());
  }

  // If we have IDs not in sprint items map (e.g. items that became Done), fetch their basic info
  const missingIds = changedItemIds.filter((id) => !itemMap.has(id));
  if (missingIds.length > 0) {
    const rawMissing = await fetchWorkItemsBatch(missingIds);
    for (const raw of rawMissing) {
      itemMap.set(raw.id, mapWorkItem(raw));
    }
    // Re-map state changes that had placeholder info
    for (const change of stateChanges) {
      const item = itemMap.get(change.workItemId);
      if (item && change.title === `#${change.workItemId}`) {
        change.title = item.title;
        change.type = item.type;
        change.url = item.url;
      }
    }
  }

  // Detect blockers from all active sprint items
  const allBlockers: BlockedItem[] = [];
  for (const item of allItems) {
    const isTaggedBlocked = item.tags.toLowerCase().includes("blocked");
    const isStuck =
      (item.state === "Active" || item.state === "In Progress") &&
      daysSince(item.changedDate) >= stuckThresholdDays;

    if (isTaggedBlocked || isStuck) {
      allBlockers.push({
        id: item.id,
        title: item.title,
        type: item.type,
        state: item.state,
        assignedTo: item.assignedTo,
        reason: isTaggedBlocked ? "tagged" : "stuck",
        daysSinceChange: daysSince(item.changedDate),
        remainingWork: item.remainingWork,
        url: item.url,
      });
    }
  }

  // Sprint pulse calculations
  const start = new Date(iteration.startDate);
  const end = new Date(iteration.finishDate);
  const totalDays = countWeekdays(start, end);
  const daysElapsed = Math.max(0, countWeekdays(start, now > end ? end : now));
  const daysRemaining = Math.max(0, totalDays - daysElapsed);

  // Capacity risk: % of members over 90% utilization
  const overloadedMembers = capacityData.members.filter(
    (m) => m.totalCapacity > 0 && m.totalAssigned / m.totalCapacity > 0.9
  );
  const capacityRisk = capacityData.members.length > 0
    ? Math.round((overloadedMembers.length / capacityData.members.length) * 100)
    : 0;

  // Stuck risk: ratio of stuck items to active items
  const activeItems = allItems.filter((i) => i.state !== "New");
  const stuckRisk = activeItems.length > 0
    ? Math.round((allBlockers.filter((b) => b.reason === "stuck").length / activeItems.length) * 100)
    : 0;

  // Time risk: sprint progress vs work progress gap
  const timeProgress = totalDays > 0 ? daysElapsed / totalDays : 0;
  // We don't have completed item count here, approximate from capacity
  const totalHours = capacityData.members.reduce((s, m) => s + m.totalCapacity, 0);
  const assignedHours = capacityData.members.reduce((s, m) => s + m.totalAssigned, 0);
  const workRemaining = totalHours > 0 ? assignedHours / totalHours : 0;
  const timeRisk = Math.round(Math.max(0, Math.min(100, (timeProgress - (1 - workRemaining)) * 150)));

  // Overall risk score (weighted)
  const riskScore = Math.round(capacityRisk * 0.35 + stuckRisk * 0.35 + timeRisk * 0.3);
  const trajectory: SprintPulse["trajectory"] =
    riskScore <= 35 ? "on-track" : riskScore <= 65 ? "at-risk" : "behind";

  const pulse: SprintPulse = {
    riskScore,
    trajectory,
    stuckItems: allBlockers.filter((b) => b.reason === "stuck"),
    capacityRisk,
    timeRisk,
    stuckRisk,
    daysRemaining,
    daysElapsed,
    totalDays,
  };

  // Group data by member
  const capacityMap = new Map<string, SprintCapacityMember>();
  for (const m of capacityData.members) {
    capacityMap.set(m.displayName, m);
  }

  // Collect all unique member names (from capacity + items + state changes)
  const memberNames = new Set<string>();
  for (const m of capacityData.members) memberNames.add(m.displayName);
  for (const item of allItems) if (item.assignedTo) memberNames.add(item.assignedTo);

  const members: MemberStandupData[] = [];
  for (const name of [...memberNames].sort()) {
    const memberYesterday = stateChanges.filter((c) => {
      const item = itemMap.get(c.workItemId);
      return item?.assignedTo === name || c.changedBy === name;
    });

    const memberToday = allItems.filter(
      (item) => item.assignedTo === name && item.state !== "New"
    );

    const memberBlockers = allBlockers.filter((b) => b.assignedTo === name);

    const remainingHours = memberToday.reduce((s, i) => s + (i.remainingWork ?? 0), 0);

    members.push({
      displayName: name,
      yesterday: memberYesterday,
      today: memberToday,
      blockers: memberBlockers,
      stats: {
        changesYesterday: memberYesterday.length,
        activeItems: memberToday.length,
        blockerCount: memberBlockers.length,
        remainingHours: Math.round(remainingHours * 10) / 10,
      },
      capacity: capacityMap.get(name) ?? null,
    });
  }

  const unassignedBlockers = allBlockers.filter((b) => !b.assignedTo);

  const result: DailyStandupData = {
    members,
    unassignedBlockers,
    pulse,
    sprintName: iteration.name,
    sprintDaysRemaining: daysRemaining,
    lookbackHours,
    generatedAt: new Date().toISOString(),
  };

  setCache(cacheKey, result, 2 * 60 * 1000); // 2 min TTL
  return result;
}
