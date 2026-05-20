import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/user";
import { rateLimit } from "@/lib/rate-limit";
import { getTeamConfig, saveTeamConfig, getActiveMembers } from "@/lib/team-config";
import { fetchTeamMembers, fetchSprintAnalytics, fetchVacationOverview } from "@/lib/devops-client";
import type { Activity, TeamMember } from "@/types/devops";

const VALID_ACTIVITIES: Activity[] = ["Development", "QA", "Release"];

export async function GET(request: NextRequest) {
  const { response: authResponse } = await requireUser();
  if (authResponse) return authResponse;

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { allowed, remaining, resetMs } = rateLimit(ip);

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) } }
    );
  }

  const action = request.nextUrl.searchParams.get("action");

  try {
    if (action === "config") {
      const config = await getTeamConfig();
      return NextResponse.json(config, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "members") {
      const members = await getActiveMembers();
      return NextResponse.json(members, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "sync") {
      const members = await fetchTeamMembers();
      return NextResponse.json(members, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "sprint-analytics") {
      const iterationId = request.nextUrl.searchParams.get("iterationId");
      if (!iterationId) {
        return NextResponse.json({ error: "Missing iterationId" }, { status: 400 });
      }
      const analytics = await fetchSprintAnalytics(iterationId);
      return NextResponse.json(analytics, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "vacation-overview") {
      const idsParam = request.nextUrl.searchParams.get("iterationIds");
      if (!idsParam) {
        return NextResponse.json({ error: "Missing iterationIds" }, { status: 400 });
      }
      const iterationIds = idsParam.split(",").filter(Boolean);
      if (iterationIds.length === 0 || iterationIds.length > 12) {
        return NextResponse.json({ error: "Provide 1-12 iteration IDs" }, { status: 400 });
      }
      const data = await fetchVacationOverview(iterationIds);
      return NextResponse.json(data, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "vacation-export") {
      const idsParam = request.nextUrl.searchParams.get("iterationIds");
      if (!idsParam) {
        return NextResponse.json({ error: "Missing iterationIds" }, { status: 400 });
      }
      const iterationIds = idsParam.split(",").filter(Boolean);
      if (iterationIds.length === 0 || iterationIds.length > 12) {
        return NextResponse.json({ error: "Provide 1-12 iteration IDs" }, { status: 400 });
      }
      const data = await fetchVacationOverview(iterationIds);

      const lines: string[] = ["Sprint,Member,Days Off Start,Days Off End,Weekdays Off"];
      for (const sprint of data.sprints) {
        for (const member of sprint.members) {
          if (member.daysOff.length === 0) continue;
          for (const period of member.daysOff) {
            const name = member.displayName.includes(",") ? `"${member.displayName}"` : member.displayName;
            lines.push(`${sprint.sprintName},${name},${period.start.split("T")[0]},${period.end.split("T")[0]},${member.totalDaysOff}`);
          }
        }
      }
      lines.push("");
      lines.push("Sprint Summary");
      lines.push("Sprint,Work Days,Members on Vacation,Total Members,Capacity %");
      for (const sprint of data.sprints) {
        lines.push(`${sprint.sprintName},${sprint.totalWorkDays},${sprint.membersOnVacation},${sprint.totalMembers},${sprint.capacityPercent}%`);
      }

      const csv = lines.join("\r\n");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"vacation-plan.csv\"",
          "X-RateLimit-Remaining": String(remaining),
        },
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Team API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const { response: authResponse } = await requireUser();
  if (authResponse) return authResponse;

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { allowed } = rateLimit(ip);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  try {
    const body = await request.json();

    if (!body.members || !Array.isArray(body.members)) {
      return NextResponse.json({ error: "Invalid config: members array required" }, { status: 400 });
    }

    const config = await saveTeamConfig({
      version: 1,
      lastModified: "",
      members: body.members,
    });

    return NextResponse.json(config);
  } catch (error) {
    console.error("Team save error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Save failed" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const { response: authResponse } = await requireUser();
  if (authResponse) return authResponse;

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { allowed } = rateLimit(ip);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { id, fields } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Missing member id" }, { status: 400 });
    }
    if (!fields || typeof fields !== "object") {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const config = await getTeamConfig();
    const member = config.members.find((m) => m.id === id);
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if (fields.defaultActivity !== undefined) {
      if (!VALID_ACTIVITIES.includes(fields.defaultActivity)) {
        return NextResponse.json({ error: "Invalid activity" }, { status: 400 });
      }
      member.defaultActivity = fields.defaultActivity;
    }
    if (fields.capacityPerDay !== undefined) {
      const cap = Number(fields.capacityPerDay);
      if (isNaN(cap) || cap < 0 || cap > 24) {
        return NextResponse.json({ error: "Invalid capacity (0-24)" }, { status: 400 });
      }
      member.capacityPerDay = cap;
    }
    if (fields.active !== undefined) {
      member.active = Boolean(fields.active);
    }

    await saveTeamConfig(config);
    return NextResponse.json(member);
  } catch (error) {
    console.error("Team patch error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { response: authResponse } = await requireUser();
  if (authResponse) return authResponse;

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { allowed } = rateLimit(ip);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { displayName, email, defaultActivity, capacityPerDay } = body;

    if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
      return NextResponse.json({ error: "Display name is required" }, { status: 400 });
    }

    const activity: Activity = VALID_ACTIVITIES.includes(body.defaultActivity)
      ? body.defaultActivity
      : "Development";

    const cap = typeof capacityPerDay === "number" && capacityPerDay >= 0 && capacityPerDay <= 24
      ? capacityPerDay
      : 6;

    const config = await getTeamConfig();

    if (config.members.some((m) => m.displayName === displayName.trim())) {
      return NextResponse.json({ error: "Member already exists" }, { status: 409 });
    }

    const member: TeamMember = {
      id: crypto.randomUUID(),
      displayName: displayName.trim(),
      defaultActivity: activity,
      capacityPerDay: cap,
      active: true,
      email: email || undefined,
      addedDate: new Date().toISOString(),
    };

    config.members.push(member);
    await saveTeamConfig(config);

    return NextResponse.json(member);
  } catch (error) {
    console.error("Team add error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Add failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const { response: authResponse } = await requireUser();
  if (authResponse) return authResponse;

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { allowed } = rateLimit(ip);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { id } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Missing member id" }, { status: 400 });
    }

    const config = await getTeamConfig();
    const idx = config.members.findIndex((m) => m.id === id);
    if (idx === -1) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    config.members.splice(idx, 1);
    await saveTeamConfig(config);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Team delete error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 500 }
    );
  }
}
