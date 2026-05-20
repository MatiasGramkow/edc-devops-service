import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/user";
import { rateLimit } from "@/lib/rate-limit";
import { getRoadmap, upsertRoadmapItem, deleteRoadmapItem } from "@/lib/roadmap";
import type { RoadmapItem } from "@/types/devops";

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
    if (action === "items") {
      const config = await getRoadmap();
      return NextResponse.json({ items: config.items }, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    if (action === "resolve-links") {
      const idsParam = request.nextUrl.searchParams.get("ids");
      if (!idsParam) {
        return NextResponse.json({ summaries: [] });
      }
      const ids = idsParam.split(",").map(Number).filter((n) => n > 0);
      if (ids.length === 0) {
        return NextResponse.json({ summaries: [] });
      }

      // Dynamic import so the main items endpoint stays fast
      const { fetchWorkItemSummaries } = await import("@/lib/devops-client");
      const summaries = await fetchWorkItemSummaries(ids);
      return NextResponse.json({ summaries }, {
        headers: { "X-RateLimit-Remaining": String(remaining) },
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { response: authResponse } = await requireUser();
  if (authResponse) return authResponse;

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { allowed, resetMs } = rateLimit(ip);

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) } }
    );
  }

  try {
    const body = await request.json();
    const item = body as RoadmapItem;

    if (!item.id || !item.title || !item.planType || !item.quarter) {
      return NextResponse.json({ error: "Missing required fields: id, title, planType, quarter" }, { status: 400 });
    }

    const config = await upsertRoadmapItem(item);
    return NextResponse.json({ ok: true, items: config.items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const { response: authResponse } = await requireUser();
  if (authResponse) return authResponse;

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { allowed, resetMs } = rateLimit(ip);

  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) } }
    );
  }

  try {
    const body = await request.json();
    const { id } = body as { id: string };

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const config = await deleteRoadmapItem(id);
    return NextResponse.json({ ok: true, items: config.items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
