import { NextRequest, NextResponse } from "next/server";
import { queryWorkItems, queryPBIsWithChildren, querySprintPlanningItems, queryUnfinishedSprintItems, queryCompletedSprintItems, queryRefinementItems, queryCleanupItems, queryBacklogHealth, getProjectMetadata, deleteWorkItem, deleteWorkItems, updateWorkItemState, fetchWorkItemDetails, fetchIterations, updateWorkItemFields, createChildTask, addComment, bulkUpdateIterationPath, fetchSprintCapacity, fetchVelocityData, fetchCarryOverItems, fetchMemberComparison, fetchPbiTaskStructure, fetchDailyStandupData } from "@/lib/devops-client";
import { getGoalForSprint, setGoalForSprint, getSprintGoals } from "@/lib/sprint-goals";
import { rateLimit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/auth/user";

export async function GET(request: NextRequest) {
  const { response: authResponse } = await requireUser();
  if (authResponse) return authResponse;

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { allowed, remaining, resetMs } = rateLimit(ip);

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(resetMs / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get("action");

  try {
    if (action === "metadata") {
      const metadata = await getProjectMetadata();
      return NextResponse.json(metadata, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "details") {
      const id = Number(searchParams.get("id"));
      if (!id || !Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: "Invalid work item ID" }, { status: 400 });
      }
      const details = await fetchWorkItemDetails(id);
      return NextResponse.json(details, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "iterations") {
      const iterations = await fetchIterations();
      return NextResponse.json(iterations, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "velocity") {
      const idsParam = searchParams.get("iterationIds");
      if (!idsParam) {
        return NextResponse.json({ error: "Missing iterationIds" }, { status: 400 });
      }
      const iterationIds = idsParam.split(",").filter(Boolean);
      if (iterationIds.length === 0 || iterationIds.length > 12) {
        return NextResponse.json({ error: "Provide 1-12 iteration IDs" }, { status: 400 });
      }
      const data = await fetchVelocityData(iterationIds);
      return NextResponse.json(data, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "carry-over") {
      const fromId = searchParams.get("fromIterationId");
      const toId = searchParams.get("toIterationId");
      if (!fromId || !toId) {
        return NextResponse.json({ error: "Missing fromIterationId or toIterationId" }, { status: 400 });
      }
      const items = await fetchCarryOverItems(fromId, toId);
      return NextResponse.json({ items, total: items.length }, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "member-comparison") {
      const idsParam = searchParams.get("iterationIds");
      if (!idsParam) {
        return NextResponse.json({ error: "Missing iterationIds" }, { status: 400 });
      }
      const iterationIds = idsParam.split(",").filter(Boolean);
      if (iterationIds.length === 0 || iterationIds.length > 12) {
        return NextResponse.json({ error: "Provide 1-12 iteration IDs" }, { status: 400 });
      }
      const data = await fetchMemberComparison(iterationIds);
      return NextResponse.json(data, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "pbi-task-structure") {
      const id = Number(searchParams.get("id"));
      if (!id || !Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: "Invalid work item ID" }, { status: 400 });
      }
      const tasks = await fetchPbiTaskStructure(id);
      return NextResponse.json(tasks, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "sprint-goals") {
      const iterationId = searchParams.get("iterationId");
      if (iterationId) {
        const goal = await getGoalForSprint(iterationId);
        return NextResponse.json(goal, {
          headers: { "X-RateLimit-Remaining": String(remaining) },
        });
      }
      const config = await getSprintGoals();
      return NextResponse.json(config, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "sprint-capacity") {
      const iterationId = searchParams.get("iterationId");
      if (!iterationId) {
        return NextResponse.json({ error: "Missing iterationId" }, { status: 400 });
      }
      const capacity = await fetchSprintCapacity(iterationId);
      return NextResponse.json(capacity, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "standup") {
      const iterationId = searchParams.get("iterationId");
      if (!iterationId) {
        return NextResponse.json({ error: "Missing iterationId" }, { status: 400 });
      }
      const stuckDays = Number(searchParams.get("stuckDays")) || 3;
      const data = await fetchDailyStandupData(iterationId, stuckDays);
      return NextResponse.json(data, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "sprint-planning") {
      const items = await querySprintPlanningItems();
      return NextResponse.json(
        { items, total: items.length },
        { headers: { "X-RateLimit-Remaining": String(remaining) } }
      );
    }

    if (action === "unfinished-sprint") {
      const iterationPath = searchParams.get("iterationPath");
      if (!iterationPath) {
        return NextResponse.json({ error: "iterationPath is required" }, { status: 400 });
      }
      const items = await queryUnfinishedSprintItems(iterationPath);
      return NextResponse.json(
        { items, total: items.length },
        { headers: { "X-RateLimit-Remaining": String(remaining) } }
      );
    }

    if (action === "completed-sprint") {
      const iterationPath = searchParams.get("iterationPath");
      if (!iterationPath) {
        return NextResponse.json({ error: "iterationPath is required" }, { status: 400 });
      }
      const items = await queryCompletedSprintItems(iterationPath);
      return NextResponse.json(
        { items, total: items.length },
        { headers: { "X-RateLimit-Remaining": String(remaining) } }
      );
    }

    if (action === "backlog-health") {
      const health = await queryBacklogHealth();
      return NextResponse.json(health, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "refinement") {
      const items = await queryRefinementItems();
      return NextResponse.json(
        { items, total: items.length },
        { headers: { "X-RateLimit-Remaining": String(remaining) } }
      );
    }

    if (action === "cleanup-analysis") {
      const minAgeDays = Number(searchParams.get("minAgeDays")) || 30;
      const items = await queryCleanupItems(minAgeDays);
      return NextResponse.json(
        { items, total: items.length },
        { headers: { "X-RateLimit-Remaining": String(remaining) } }
      );
    }

    if (action === "pbi-tree") {
      const maxAgeDays = Number(searchParams.get("maxAgeDays")) || undefined;
      const ageField = (searchParams.get("ageField") === "created" ? "created" : "updated") as "updated" | "created";
      const states = searchParams.get("states")?.split(",").filter(Boolean) ?? [];
      const types = searchParams.get("types")?.split(",").filter(Boolean) ?? [];
      const assignedTo = searchParams.get("assignedTo") || null;

      const pbis = await queryPBIsWithChildren({ maxAgeDays, ageField, states, types, assignedTo });
      return NextResponse.json(
        { items: pbis, total: pbis.length },
        { headers: { "X-RateLimit-Remaining": String(remaining) } }
      );
    }

    // Default: query work items
    const maxAgeDays = Number(searchParams.get("maxAgeDays")) || 90;
    const ageField = (searchParams.get("ageField") === "created" ? "created" : "updated") as "updated" | "created";
    const states = searchParams.get("states")?.split(",").filter(Boolean) ?? [];
    const types = searchParams.get("types")?.split(",").filter(Boolean) ?? [];
    const assignedTo = searchParams.get("assignedTo") || null;

    const items = await queryWorkItems({ maxAgeDays, ageField, states, types, assignedTo });

    return NextResponse.json(
      { items, total: items.length },
      { headers: { "X-RateLimit-Remaining": String(remaining) } }
    );
  } catch (error) {
    console.error("Azure DevOps API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const { response: authResponse } = await requireUser();
  if (authResponse) return authResponse;

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { allowed } = rateLimit(ip);

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429 }
    );
  }

  const body = await request.json();

  // Sprint goal update: { sprintGoal: { iterationId, text } }
  if (body.sprintGoal && typeof body.sprintGoal === "object") {
    const { iterationId, text } = body.sprintGoal;
    if (!iterationId || typeof iterationId !== "string") {
      return NextResponse.json({ error: "Missing iterationId" }, { status: 400 });
    }
    try {
      const goal = await setGoalForSprint(iterationId, text || "");
      return NextResponse.json(goal);
    } catch (error) {
      console.error("Sprint goal save error:", error);
      return NextResponse.json({ error: "Failed to save sprint goal" }, { status: 500 });
    }
  }

  // Bulk iteration path update: { ids: number[], iterationPath: string }
  if (Array.isArray(body.ids) && body.iterationPath) {
    if (!body.ids.every((id: unknown) => typeof id === "number" && Number.isInteger(id) && id > 0)) {
      return NextResponse.json({ error: "Invalid IDs" }, { status: 400 });
    }
    try {
      const result = await bulkUpdateIterationPath(body.ids, body.iterationPath);
      return NextResponse.json(result);
    } catch (error) {
      console.error("Bulk iteration update error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Bulk update failed" },
        { status: 502 }
      );
    }
  }

  const { id } = body;

  if (!id || typeof id !== "number") {
    return NextResponse.json({ error: "Missing work item ID" }, { status: 400 });
  }

  try {
    // Add comment
    if (body.comment && typeof body.comment === "string") {
      const comment = await addComment(id, body.comment);
      return NextResponse.json(comment);
    }

    // State change
    if (body.state && typeof body.state === "string") {
      const updated = await updateWorkItemState(id, body.state);
      return NextResponse.json(updated);
    }

    // Field updates (iterationPath, description, assignedTo, etc.)
    if (body.fields && typeof body.fields === "object") {
      await updateWorkItemFields(id, body.fields, body.workItemType);
      return NextResponse.json({ success: true, id });
    }

    return NextResponse.json({ error: "No update operation specified" }, { status: 400 });
  } catch (error) {
    console.error("Update work item error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update work item" },
      { status: 502 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { response: authResponse } = await requireUser();
  if (authResponse) return authResponse;

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { allowed } = rateLimit(ip);

  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  const body = await request.json();
  const { parentId, title, iterationPath, remainingWork, activity, tags, assignedTo } = body;

  if (!parentId || typeof parentId !== "number") {
    return NextResponse.json({ error: "Missing parent ID" }, { status: 400 });
  }
  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "Missing title" }, { status: 400 });
  }
  if (!iterationPath || typeof iterationPath !== "string") {
    return NextResponse.json({ error: "Missing iteration path" }, { status: 400 });
  }

  try {
    const task = await createChildTask(parentId, title.trim(), iterationPath, { remainingWork, activity, tags, assignedTo });
    return NextResponse.json(task);
  } catch (error) {
    console.error("Create task error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create task" },
      { status: 502 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const { response: authResponse } = await requireUser();
  if (authResponse) return authResponse;

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { allowed } = rateLimit(ip);

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429 }
    );
  }

  const body = await request.json();

  // Bulk delete: { ids: number[] }
  if (Array.isArray(body.ids)) {
    if (body.ids.length === 0) {
      return NextResponse.json({ error: "No IDs provided" }, { status: 400 });
    }
    if (body.ids.length > 200) {
      return NextResponse.json({ error: "Max 200 work items per request" }, { status: 400 });
    }
    if (!body.ids.every((id: unknown) => typeof id === "number" && Number.isInteger(id) && id > 0)) {
      return NextResponse.json({ error: "Invalid IDs" }, { status: 400 });
    }

    try {
      const result = await deleteWorkItems(body.ids);
      return NextResponse.json(result);
    } catch (error) {
      console.error("Bulk delete error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Bulk delete failed" },
        { status: 502 }
      );
    }
  }

  // Single delete: { id: number }
  const { id } = body;
  if (!id || typeof id !== "number") {
    return NextResponse.json({ error: "Missing work item ID" }, { status: 400 });
  }

  try {
    await deleteWorkItem(id);
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("Delete work item error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete" },
      { status: 502 }
    );
  }
}
