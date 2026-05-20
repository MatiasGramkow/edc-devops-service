import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/user";
import { createWorkItem, createChildTask } from "@/lib/devops-client";
import { rateLimit } from "@/lib/rate-limit";
import { renderTopdeskBanner, stripTopdeskBanner, type TopdeskTicket } from "@/lib/topdesk-client";

export async function POST(request: NextRequest) {
  const { response: authResponse } = await requireUser();
  if (authResponse) return authResponse;

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { allowed } = rateLimit(ip);

  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  const body = await request.json();
  const {
    type, title, description, acceptanceCriteria, priority, tags,
    iterationPath, assignedTo, refinement, sprintPlanning, parentId, childTasks,
    topdeskTicket,
  } = body as {
    type?: string;
    title?: string;
    description?: string;
    acceptanceCriteria?: string;
    priority?: number;
    tags?: string;
    iterationPath?: string;
    assignedTo?: string;
    refinement?: boolean;
    sprintPlanning?: boolean;
    parentId?: number;
    childTasks?: Array<{ title: string; activity: string; remainingWork?: number; assignedTo?: string; tags?: string }>;
    topdeskTicket?: TopdeskTicket;
  };

  // Validate required fields
  if (!type || (type !== "Product Backlog Item" && type !== "Bug")) {
    return NextResponse.json({ error: "Type must be 'Product Backlog Item' or 'Bug'" }, { status: 400 });
  }
  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (parentId != null && (typeof parentId !== "number" || !Number.isInteger(parentId) || parentId <= 0)) {
    return NextResponse.json({ error: "Invalid parent ID" }, { status: 400 });
  }

  // If this came from TOPdesk, prepend an attribution banner and ensure the
  // TOPdesk:<number> tag is present so we can find related PBIs later.
  let finalDescription = description ?? "";
  let finalTags = tags ?? "";
  let finalTitle = title.trim();
  if (topdeskTicket && typeof topdeskTicket.number === "string" && typeof topdeskTicket.id === "string") {
    const banner = renderTopdeskBanner(topdeskTicket);
    finalDescription = banner + "\n" + stripTopdeskBanner(finalDescription);

    const tagList = finalTags.split(";").map((t) => t.trim()).filter(Boolean);
    const expectedTag = `TOPdesk:${topdeskTicket.number}`;
    if (!tagList.some((t) => t.toLowerCase() === expectedTag.toLowerCase())) {
      tagList.push(expectedTag);
    }
    finalTags = tagList.join("; ");

    // Prepend TOPdesk number to the title so it's scannable directly in lists
    if (!finalTitle.includes(topdeskTicket.number)) {
      finalTitle = `[${topdeskTicket.number}] ${finalTitle}`;
    }
  }

  try {
    // Create the PBI/Bug
    const workItem = await createWorkItem(type, finalTitle, {
      description: finalDescription || undefined,
      acceptanceCriteria: acceptanceCriteria || undefined,
      priority: typeof priority === "number" ? priority : undefined,
      tags: finalTags || undefined,
      iterationPath: iterationPath || undefined,
      assignedTo: assignedTo || undefined,
      refinement: typeof refinement === "boolean" ? refinement : undefined,
      sprintPlanning: typeof sprintPlanning === "boolean" ? sprintPlanning : undefined,
      parentId: parentId || undefined,
    });

    // Create child tasks if requested
    const childTaskIds: number[] = [];
    if (Array.isArray(childTasks) && childTasks.length > 0) {
      const taskIterationPath = iterationPath || "Relaunch - Charlie Tango";
      for (const ct of childTasks) {
        if (!ct.title || !ct.activity) continue;
        try {
          const task = await createChildTask(workItem.id, ct.title, taskIterationPath, {
            remainingWork: ct.remainingWork || undefined,
            activity: ct.activity,
            tags: ct.tags || undefined,
            assignedTo: ct.assignedTo || undefined,
          });
          childTaskIds.push(task.id);
        } catch (taskError) {
          console.error(`Failed to create child task "${ct.title}":`, taskError);
        }
      }
    }

    return NextResponse.json({
      id: workItem.id,
      url: workItem.url,
      type: workItem.type,
      title: workItem.title,
      childTaskIds,
      topdeskNumber: topdeskTicket?.number ?? null,
    });
  } catch (error) {
    console.error("Create work item error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create work item" },
      { status: 502 }
    );
  }
}
