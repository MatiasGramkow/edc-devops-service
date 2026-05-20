import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/user";

const ORG = process.env.AZURE_DEVOPS_ORG!;
const PAT = process.env.AZURE_DEVOPS_PAT!;
const AUTH = Buffer.from(`:${PAT}`).toString("base64");

export async function GET(request: NextRequest) {
  const { response: authResponse } = await requireUser();
  if (authResponse) return authResponse;

  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // Only proxy URLs from our Azure DevOps org
  const allowed =
    url.startsWith(`https://dev.azure.com/${ORG}/`) ||
    url.startsWith(`https://${ORG}.visualstudio.com/`);
  if (!allowed) {
    return NextResponse.json({ error: "URL not allowed" }, { status: 403 });
  }

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${AUTH}` },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to fetch image" }, { status: res.status });
    }

    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch image" }, { status: 502 });
  }
}
