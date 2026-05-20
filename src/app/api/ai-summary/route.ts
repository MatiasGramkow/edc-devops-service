import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/user";
import { rateLimit } from "@/lib/rate-limit";
import { isCodebaseAvailable, generateAISummary } from "@/lib/ai-summary";

export async function POST(req: NextRequest) {
  const { response: authResponse } = await requireUser();
  if (authResponse) return authResponse;

  const ip = req.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const { allowed } = rateLimit(ip);
  if (!allowed) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  if (!isCodebaseAvailable()) {
    return NextResponse.json(
      { error: "Codebase search not configured. Set RELATED_CODEBASE_PATH in .env.local" },
      { status: 503 }
    );
  }

  try {
    const body = await req.json();
    const { workItemId, title, description, acceptanceCriteria } = body;

    if (!workItemId || typeof workItemId !== "number" || workItemId <= 0) {
      return NextResponse.json({ error: "Invalid workItemId" }, { status: 400 });
    }
    if (!title || typeof title !== "string") {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const result = await generateAISummary({
      workItemId,
      title,
      description: description ?? "",
      acceptanceCriteria: acceptanceCriteria ?? "",
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("AI Summary error:", err);
    return NextResponse.json({ error: "Failed to generate summary" }, { status: 502 });
  }
}
