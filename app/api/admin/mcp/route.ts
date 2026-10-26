import { NextRequest, NextResponse } from "next/server";
import { handleMcpRequest } from "../../[transport]/route";
import { MAX_MCP_BODY_BYTES } from "../../../lib/security";
import {
  getMcpAccessSecret,
  getWorkflowyApiKey,
  isAdminAuthenticated,
  publicErrorMessage,
  rejectCrossSiteMutation,
  unauthorizedJson,
} from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<Response> {
  const blocked = rejectCrossSiteMutation(request);
  if (blocked) {
    return blocked;
  }

  if (!isAdminAuthenticated(request)) {
    return unauthorizedJson();
  }

  const accessSecret = getMcpAccessSecret();
  if (accessSecret.length < 32) {
    return NextResponse.json(
      { error: { message: "MCP_ACCESS_SECRET must be a random value at least 32 characters long." } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!getWorkflowyApiKey()) {
    return NextResponse.json(
      { error: { message: "WORKFLOWY_API_KEY is not configured." } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const body = await request.text();
  if (body.length > MAX_MCP_BODY_BYTES) {
    return NextResponse.json(
      { error: { message: "Request body too large." } },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const response = await handleMcpRequest(
      new Request("https://workflowy-mcp.internal/api/mcp", {
        method: "POST",
        headers: {
          Accept: request.headers.get("accept") ?? "application/json, text/event-stream",
          Authorization: `Bearer ${accessSecret}`,
          "Content-Type": request.headers.get("content-type") ?? "application/json",
        },
        body,
      }),
    );

    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: { message: publicErrorMessage(error) } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
