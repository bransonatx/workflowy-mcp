import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { accountKeyFromApiKey } from "../../../lib/security";
import {
  getWorkflowyApiKey,
  isAdminAuthenticated,
  publicErrorMessage,
  rejectCrossSiteMutation,
  unauthorizedJson,
} from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SqlClient = NeonQueryFunction<false, false>;

let dbPromise: Promise<SqlClient> | undefined;

async function getDb(): Promise<SqlClient> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = (async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not set in process.env");
    }

    const sql = neon(databaseUrl);
    await sql`
      CREATE TABLE IF NOT EXISTS workflowy_mcp_logs (
        id BIGSERIAL PRIMARY KEY,
        account_key TEXT NOT NULL,
        level TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'mcp',
        event TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_workflowy_mcp_logs_account_created
      ON workflowy_mcp_logs (account_key, created_at DESC)
    `;

    return sql;
  })();

  return dbPromise;
}

function getAccountKey(): string {
  const apiKey = getWorkflowyApiKey();
  if (!apiKey) {
    throw new Error("WORKFLOWY_API_KEY is not configured.");
  }
  return accountKeyFromApiKey(apiKey);
}

function clampLimit(value: string | null): number {
  const parsed = Number(value ?? 80);
  if (!Number.isFinite(parsed)) {
    return 80;
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), 200);
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!isAdminAuthenticated(request)) {
    return unauthorizedJson();
  }

  try {
    const sql = await getDb();
    const accountKey = getAccountKey();
    const limit = clampLimit(request.nextUrl.searchParams.get("limit"));
    const logs = await sql`
      SELECT id, level, source, event, message, metadata, created_at
      FROM workflowy_mcp_logs
      WHERE account_key = ${accountKey}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return NextResponse.json({
      account_id: accountKey.slice(0, 12),
      logs,
      total_returned: logs.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          message: publicErrorMessage(error),
        },
      },
      { status: 503 },
    );
  }
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const blocked = rejectCrossSiteMutation(request);
  if (blocked) {
    return blocked;
  }

  if (!isAdminAuthenticated(request)) {
    return unauthorizedJson();
  }

  try {
    const sql = await getDb();
    const accountKey = getAccountKey();
    const deleted = await sql`
      DELETE FROM workflowy_mcp_logs
      WHERE account_key = ${accountKey}
      RETURNING id
    `;

    return NextResponse.json({
      account_id: accountKey.slice(0, 12),
      deleted_count: deleted.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          message: publicErrorMessage(error),
        },
      },
      { status: 503 },
    );
  }
}
