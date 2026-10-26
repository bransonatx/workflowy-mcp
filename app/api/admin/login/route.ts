import { NextRequest, NextResponse } from "next/server";
import {
  clearRateLimit,
  clientRateLimitKey,
  rateLimitAllows,
  recordRateLimitFailure,
} from "../../../lib/security";
import {
  adminSecretConfigurationError,
  adminSecretMatches,
  buildAdminStatus,
  rejectCrossSiteMutation,
  setAdminSessionCookie,
} from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 8;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const blocked = rejectCrossSiteMutation(request);
  if (blocked) {
    return blocked;
  }

  const configurationError = adminSecretConfigurationError();
  if (configurationError) {
    return NextResponse.json(
      { error: configurationError },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rateKey = clientRateLimitKey(request, "admin-login");
  if (!rateLimitAllows(rateKey, LOGIN_FAILURE_LIMIT, LOGIN_WINDOW_MS)) {
    return NextResponse.json(
      { error: "Too many login attempts." },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 4096) {
    return NextResponse.json(
      { error: "Request body too large." },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { secret?: unknown };
  const secret = typeof body.secret === "string" ? body.secret : "";

  if (!adminSecretMatches(secret)) {
    recordRateLimitFailure(rateKey, LOGIN_WINDOW_MS);
    return NextResponse.json(
      { error: "Invalid admin secret." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  clearRateLimit(rateKey);

  const response = NextResponse.json(buildAdminStatus(request, true), {
    headers: { "Cache-Control": "no-store" },
  });
  setAdminSessionCookie(response);
  return response;
}
