import { NextRequest, NextResponse } from "next/server";
import { clearAdminSessionCookie, rejectCrossSiteMutation } from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const blocked = rejectCrossSiteMutation(request);
  if (blocked) {
    return blocked;
  }

  const response = NextResponse.json(
    { authenticated: false },
    { headers: { "Cache-Control": "no-store" } },
  );
  clearAdminSessionCookie(response);
  return response;
}
