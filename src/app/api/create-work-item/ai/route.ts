import { NextRequest, NextResponse } from "next/server";
import { transformTopdeskInput, transformTopdeskImage, transformTopdeskTicket } from "@/lib/topdesk-ai";
import { fetchTicketByNumber, isTopdeskConfigured, TopdeskApiError } from "@/lib/topdesk-client";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { allowed } = rateLimit(ip);

  if (!allowed) {
    return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  }

  const body = await request.json();
  const { rawText, images, topdeskNumber } = body;

  // TOPdesk ticket mode: fetch the ticket then run structured AI transformation
  if (typeof topdeskNumber === "string" && topdeskNumber.trim().length > 0) {
    if (!isTopdeskConfigured()) {
      return NextResponse.json(
        { error: "TOPdesk is not configured. Set TOPDESK_URL, TOPDESK_API_USER, and TOPDESK_APP_TOKEN in .env.local." },
        { status: 503 }
      );
    }
    try {
      const ticket = await fetchTicketByNumber(topdeskNumber.trim());
      const result = await transformTopdeskTicket(ticket);
      const hasAiKey = !!process.env.OPENAI_API_KEY;
      return NextResponse.json({ ...result, aiAvailable: hasAiKey, topdeskTicket: ticket });
    } catch (error) {
      if (error instanceof TopdeskApiError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      console.error("TOPdesk ticket fetch + transform error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "TOPdesk lookup failed" },
        { status: 502 }
      );
    }
  }

  // Image mode: array of base64 data URLs (optionally with accompanying text)
  if (Array.isArray(images) && images.length > 0) {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Image analysis requires OPENAI_API_KEY" }, { status: 400 });
    }
    if (images.length > 5) {
      return NextResponse.json({ error: "Maximum 5 images allowed" }, { status: 400 });
    }
    try {
      const accompanyingText = typeof rawText === "string" && rawText.trim().length >= 10 ? rawText.trim() : undefined;
      const result = await transformTopdeskImage(images, accompanyingText);
      return NextResponse.json({ ...result, aiAvailable: true });
    } catch (error) {
      console.error("TOPdesk image AI analysis error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Image analysis failed" },
        { status: 502 }
      );
    }
  }

  // Text mode
  if (!rawText || typeof rawText !== "string" || rawText.trim().length < 10) {
    return NextResponse.json({ error: "Input text must be at least 10 characters" }, { status: 400 });
  }

  try {
    const result = await transformTopdeskInput(rawText.trim());
    const hasAiKey = !!process.env.OPENAI_API_KEY;
    return NextResponse.json({ ...result, aiAvailable: hasAiKey });
  } catch (error) {
    console.error("TOPdesk AI analysis error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 502 }
    );
  }
}
