import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_SECRET_LENGTH,
  adminMutationAllowed,
  clearAllRateLimits,
  clientRateLimitKey,
  decideMcpAuth,
  isBrowserOriginAllowed,
  rateLimitAllows,
  recordRateLimitFailure,
  redactSensitiveText,
  redactSensitiveValue,
  sameOriginRedirectTarget,
  timingSafeStringEqual,
} from "../app/lib/security";

const ACCESS_SECRET = "a".repeat(MIN_SECRET_LENGTH);
const WORKFLOWY_KEY = "workflowy-test-key-value";

describe("timingSafeStringEqual", () => {
  it("matches equal strings and rejects different lengths", () => {
    assert.equal(timingSafeStringEqual("same-value", "same-value"), true);
    assert.equal(timingSafeStringEqual("short", "short-but-longer"), false);
    assert.equal(timingSafeStringEqual("", "x"), false);
  });
});

describe("decideMcpAuth", () => {
  it("accepts only the server access secret and returns the server Workflowy key", () => {
    const decision = decideMcpAuth({
      bearerToken: ACCESS_SECRET,
      accessSecret: ACCESS_SECRET,
      workflowyApiKey: WORKFLOWY_KEY,
    });

    assert.equal(decision.ok, true);
    assert.equal(decision.status, 200);
    assert.equal(decision.workflowyApiKey, WORKFLOWY_KEY);
    assert.equal(decision.clientId?.length, 12);
  });

  it("rejects a client-supplied Workflowy key appended after the secret", () => {
    const decision = decideMcpAuth({
      bearerToken: `${ACCESS_SECRET}:some-other-workflowy-key`,
      accessSecret: ACCESS_SECRET,
      workflowyApiKey: WORKFLOWY_KEY,
    });

    assert.equal(decision.ok, false);
    assert.equal(decision.status, 401);
    assert.equal(decision.workflowyApiKey, undefined);
  });

  it("rejects a missing or wrong bearer without echoing the secret", () => {
    assert.equal(
      decideMcpAuth({
        bearerToken: undefined,
        accessSecret: ACCESS_SECRET,
        workflowyApiKey: WORKFLOWY_KEY,
      }).status,
      401,
    );
    assert.equal(
      decideMcpAuth({
        bearerToken: "b".repeat(MIN_SECRET_LENGTH),
        accessSecret: ACCESS_SECRET,
        workflowyApiKey: WORKFLOWY_KEY,
      }).status,
      401,
    );
  });

  it("fails closed when the access secret is short or the Workflowy key is missing", () => {
    assert.equal(
      decideMcpAuth({
        bearerToken: "short-secret",
        accessSecret: "short-secret",
        workflowyApiKey: WORKFLOWY_KEY,
      }).status,
      503,
    );
    assert.equal(
      decideMcpAuth({
        bearerToken: ACCESS_SECRET,
        accessSecret: ACCESS_SECRET,
        workflowyApiKey: "",
      }).status,
      503,
    );
  });
});

describe("redactSensitiveText", () => {
  it("removes connection strings, bearer tokens, and known secret values", () => {
    const secret = "super-secret-admin-value";
    const text = redactSensitiveText(
      `failed postgres://user:${secret}@ep-example.neon.tech/db Authorization: Bearer ${secret}`,
      [secret],
    );

    assert.equal(text.includes(secret), false);
    assert.equal(text.includes("postgres://"), false);
    assert.match(text, /Bearer \[redacted\]/);
  });

  it("redacts nested values and blocks cross-site redirects", () => {
    const redacted = redactSensitiveValue(
      { note: "postgres://user:pw@ep.neon.tech/db", nested: ["ok"] },
      [],
    ) as { note: string; nested: string[] };

    assert.equal(redacted.note, "[redacted]");
    assert.deepEqual(redacted.nested, ["ok"]);
    assert.equal(
      sameOriginRedirectTarget("https://workflowy.com/api/v1/nodes", "/api/v1/nodes/"),
      "https://workflowy.com/api/v1/nodes/",
    );
    assert.equal(
      sameOriginRedirectTarget("https://workflowy.com/api/v1/nodes", "https://evil.example/steal"),
      null,
    );
  });
});

describe("origin checks", () => {
  it("allows every browser origin only when no allowlist is configured", () => {
    assert.equal(isBrowserOriginAllowed("https://evil.example", undefined), true);
    assert.equal(
      isBrowserOriginAllowed("https://evil.example", "https://claude.ai"),
      false,
    );
    assert.equal(
      isBrowserOriginAllowed("https://claude.ai", "https://claude.ai, https://chatgpt.com"),
      true,
    );
    assert.equal(isBrowserOriginAllowed(null, "https://claude.ai"), true);
  });

  it("blocks cross-site admin mutations", () => {
    const blocked = new Request("https://app.example/api/admin/login", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
    });
    const allowed = new Request("https://app.example/api/admin/login", {
      method: "POST",
      headers: {
        origin: "https://app.example",
        "sec-fetch-site": "same-origin",
      },
    });

    assert.equal(adminMutationAllowed(blocked), false);
    assert.equal(adminMutationAllowed(allowed), true);
  });
});

describe("rate limits", () => {
  it("locks a key after the failure limit and prefers x-real-ip", () => {
    clearAllRateLimits();
    const request = new Request("https://app.example/api/mcp", {
      headers: {
        "x-real-ip": "203.0.113.8",
        "x-forwarded-for": "1.1.1.1, 2.2.2.2",
      },
    });
    const key = clientRateLimitKey(request, "mcp");
    assert.equal(key, "mcp:203.0.113.8");
    assert.equal(rateLimitAllows(key, 2, 60_000), true);
    recordRateLimitFailure(key, 60_000);
    recordRateLimitFailure(key, 60_000);
    assert.equal(rateLimitAllows(key, 2, 60_000), false);
    clearAllRateLimits();
  });
});
