import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { MIN_SECRET_LENGTH, clearAllRateLimits } from "../app/lib/security";

const ACCESS_SECRET = "c".repeat(MIN_SECRET_LENGTH);
const WORKFLOWY_KEY = "wf-live-key-should-not-leak";

before(() => {
  process.env.MCP_ACCESS_SECRET = ACCESS_SECRET;
  process.env.WORKFLOWY_API_KEY = WORKFLOWY_KEY;
  process.env.ADMIN_SECRET = "d".repeat(MIN_SECRET_LENGTH);
  delete process.env.DATABASE_URL;
  delete process.env.ALLOWED_ORIGINS;
  clearAllRateLimits();
});

async function loadHandler(): Promise<typeof import("../app/api/[transport]/route")> {
  return import("../app/api/[transport]/route");
}

function initializeRequest(headers: HeadersInit = {}): Request {
  return new Request("https://workflowy.example/api/mcp", {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "security-test", version: "0.0.0" },
      },
    }),
  });
}

describe("MCP route auth", () => {
  it("rejects a missing token, a wrong token, and a client-supplied Workflowy key", async () => {
    const { handleMcpRequest } = await loadHandler();
    const missing = await handleMcpRequest(initializeRequest());
    const wrong = await handleMcpRequest(
      initializeRequest({ Authorization: `Bearer ${"e".repeat(MIN_SECRET_LENGTH)}` }),
    );
    const legacy = await handleMcpRequest(
      initializeRequest({
        Authorization: `Bearer ${ACCESS_SECRET}:some-other-workflowy-key`,
      }),
    );

    assert.equal(missing.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(legacy.status, 401);
    const body = await legacy.text();
    assert.equal(body.includes(WORKFLOWY_KEY), false);
    assert.equal(body.includes(ACCESS_SECRET), false);
  });

  it("accepts the server access secret and does not leak the Workflowy key or a database URL", async () => {
    const { handleMcpRequest } = await loadHandler();
    const response = await handleMcpRequest(
      initializeRequest({ Authorization: `Bearer ${ACCESS_SECRET}` }),
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.equal(body.includes(WORKFLOWY_KEY), false);
    assert.equal(body.includes("postgres://"), false);
    assert.match(body, /workflowy-mcp|protocolVersion|serverInfo/);
  });

  it("blocks browser origins that are not on the allowlist", async () => {
    process.env.ALLOWED_ORIGINS = "https://claude.ai";
    const { handleMcpRequest } = await loadHandler();
    const response = await handleMcpRequest(
      initializeRequest({
        Authorization: `Bearer ${ACCESS_SECRET}`,
        Origin: "https://evil.example",
      }),
    );
    delete process.env.ALLOWED_ORIGINS;

    assert.equal(response.status, 403);
  });

  it("refuses an oversized declared body before doing any work", async () => {
    const { handleMcpRequest } = await loadHandler();
    const response = await handleMcpRequest(
      new Request("https://workflowy.example/api/mcp", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ACCESS_SECRET}`,
          "Content-Length": String(2_000_000),
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
    );

    assert.equal(response.status, 413);
  });
});
