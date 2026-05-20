import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/user";
import { fetchTicketByNumber, listTickets, isTopdeskConfigured, TopdeskApiError, normalizeTicketNumber } from "@/lib/topdesk-client";
import { findWorkItemsByTopdeskTags, linkWorkItemToTopdesk, parseWorkItemInput } from "@/lib/devops-client";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const { response: authResponse } = await requireUser();
  if (authResponse) return authResponse;

  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { allowed } = rateLimit(ip);
  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  if (!isTopdeskConfigured()) {
    return NextResponse.json(
      { error: "TOPdesk is not configured. Set TOPDESK_URL, TOPDESK_API_USER, and TOPDESK_APP_TOKEN in .env.local." },
      { status: 503 }
    );
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  try {
    if (action === "ticket") {
      const number = searchParams.get("number");
      if (!number) {
        return NextResponse.json({ error: "Missing 'number' parameter" }, { status: 400 });
      }
      const ticket = await fetchTicketByNumber(number);
      return NextResponse.json(ticket);
    }

    if (action === "recent") {
      const pageSize = Number(searchParams.get("limit") ?? "25");
      const callerEmail = searchParams.get("callerEmail") ?? undefined;
      const openParam = searchParams.get("open");
      const open = openParam === "true" ? true : openParam === "false" ? false : undefined;
      const tickets = await listTickets({ pageSize, callerEmail, open });
      return NextResponse.json({ tickets });
    }

    if (action === "inbox") {
      const operatorName = searchParams.get("operatorName") ?? process.env.TOPDESK_OPERATOR_NAME ?? "";
      const operatorGroupName = searchParams.get("operatorGroupName") ?? undefined;
      const openParam = searchParams.get("open");
      const open = openParam === "false" ? false : openParam === "all" ? undefined : true;
      const pageSize = Number(searchParams.get("limit") ?? "100");

      const tickets = await listTickets({
        pageSize,
        operatorName: operatorName || undefined,
        operatorGroupName: operatorGroupName || undefined,
        open,
      });

      let linkedMap: Awaited<ReturnType<typeof findWorkItemsByTopdeskTags>> = new Map();
      if (tickets.length > 0) {
        try {
          linkedMap = await findWorkItemsByTopdeskTags(tickets.map((t) => t.number));
        } catch (e) {
          console.error("Failed to cross-reference DevOps work items:", e);
        }
      }

      const enriched = tickets.map((t) => ({
        ...t,
        devopsWorkItems: linkedMap.get(t.number) ?? [],
      }));

      return NextResponse.json({
        tickets: enriched,
        operatorName: operatorName || null,
        operatorGroupName: operatorGroupName ?? null,
        open: open ?? null,
      });
    }

    if (action === "ping") {
      return NextResponse.json({ ok: true, configured: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    if (error instanceof TopdeskApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("TOPdesk API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "TOPdesk request failed" },
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

  if (!isTopdeskConfigured()) {
    return NextResponse.json(
      { error: "TOPdesk is not configured. Set TOPDESK_URL, TOPDESK_API_USER, and TOPDESK_APP_TOKEN in .env.local." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const action = (body as { action?: string }).action;

  if (action === "link") {
    const { topdeskNumber, workItemInput } = body as { topdeskNumber?: string; workItemInput?: string };
    if (!topdeskNumber || !workItemInput) {
      return NextResponse.json({ error: "Missing topdeskNumber or workItemInput" }, { status: 400 });
    }
    const normalized = normalizeTicketNumber(topdeskNumber);
    if (!normalized) {
      return NextResponse.json({ error: `Invalid TOPdesk ticket number: ${topdeskNumber}` }, { status: 400 });
    }
    const workItemId = parseWorkItemInput(workItemInput);
    if (!workItemId) {
      return NextResponse.json(
        { error: "Could not extract a work item ID from the input. Paste a DevOps URL or numeric ID." },
        { status: 400 }
      );
    }
    try {
      const result = await linkWorkItemToTopdesk(workItemId, normalized);
      return NextResponse.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Linking failed";
      const status = msg.toLowerCase().includes("not found") ? 404 : 502;
      return NextResponse.json({ error: msg }, { status });
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
