import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

export interface CurrentUser {
  oid: string;
  upn: string;
  name: string;
}

const PRINCIPAL_HEADER = "x-ms-client-principal";

// In production, App Service Easy Auth injects x-ms-client-principal with
// a base64-encoded JSON blob of user claims. In dev, no Easy Auth is in
// front of the app, so we return a stub user — the app calls Azure DevOps
// with a server-side PAT and does not need a user-issued Graph token.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (process.env.NODE_ENV !== "production") {
    return {
      oid: "dev-user",
      upn: process.env.DEV_USER_UPN ?? "magr@edc.dk",
      name: process.env.DEV_USER_NAME ?? "Matias Gramkow (dev)",
    };
  }
  const h = await headers();
  const principal = h.get(PRINCIPAL_HEADER);
  return principal ? userFromPrincipal(principal) : null;
}

interface PrincipalClaim {
  typ: string;
  val: string;
}

interface ClientPrincipal {
  claims?: PrincipalClaim[];
}

function userFromPrincipal(b64: string): CurrentUser | null {
  let principal: ClientPrincipal;
  try {
    principal = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    return null;
  }
  const find = (...types: string[]): string | undefined =>
    principal.claims?.find((c) => types.includes(c.typ))?.val;

  const oid = find(
    "http://schemas.microsoft.com/identity/claims/objectidentifier",
    "oid",
  );
  if (!oid) return null;

  const upn =
    find(
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn",
      "preferred_username",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
    ) ?? "unknown";
  const name =
    find(
      "name",
      "http://schemas.microsoft.com/identity/claims/displayname",
    ) ?? upn;

  return { oid, upn, name };
}

export async function requireUser(): Promise<
  { user: CurrentUser; response: null } | { user: null; response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      user: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { user, response: null };
}
