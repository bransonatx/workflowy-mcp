import { createHash, timingSafeEqual } from "crypto";

export const MIN_SECRET_LENGTH = 32;
export const MAX_MCP_BODY_BYTES = 1_048_576;
export const MAX_TOOL_INPUT_ELEMENTS = 20_000;

const RATE_LIMIT_BUCKETS = new Map<string, { count: number; resetAt: number }>();

export function timingSafeStringEqual(a: string, b: string): boolean {
  const aHash = createHash("sha256").update(a, "utf8").digest();
  const bHash = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(aHash, bHash);
}

export function accountKeyFromApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export interface McpAuthDecision {
  ok: boolean;
  status: number;
  workflowyApiKey?: string;
  clientId?: string;
}

export function decideMcpAuth(input: {
  bearerToken: string | undefined;
  accessSecret: string;
  workflowyApiKey: string;
}): McpAuthDecision {
  if (
    input.accessSecret.length < MIN_SECRET_LENGTH ||
    input.workflowyApiKey.length === 0
  ) {
    return { ok: false, status: 503 };
  }

  if (
    !input.bearerToken ||
    !timingSafeStringEqual(input.bearerToken, input.accessSecret)
  ) {
    return { ok: false, status: 401 };
  }

  const accountKey = accountKeyFromApiKey(input.workflowyApiKey);
  return {
    ok: true,
    status: 200,
    workflowyApiKey: input.workflowyApiKey,
    clientId: accountKey.slice(0, 12),
  };
}

export function redactSensitiveText(
  value: string,
  secrets: readonly string[] = [],
): string {
  let output = value;
  const unique = [...new Set(secrets.filter((secret) => secret.length >= 8))];
  unique.sort((left, right) => right.length - left.length);

  for (const secret of unique) {
    if (output.includes(secret)) {
      output = output.split(secret).join("[redacted]");
    }
  }

  return output
    .replace(/postgres(?:ql)?:\/\/[^\s'")]+/gi, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=:-]{8,}/gi, "Bearer [redacted]");
}

export function redactSensitiveValue(value: unknown, secrets: readonly string[] = []): unknown {
  if (typeof value === "string") {
    return redactSensitiveText(value, secrets);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item, secrets));
  }
  if (typeof value === "object" && value !== null) {
    const redacted: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      redacted[redactSensitiveText(key, secrets)] = redactSensitiveValue(child, secrets);
    }
    return redacted;
  }
  return value;
}

export function sameOriginRedirectTarget(currentUrl: string, location: string): string | null {
  try {
    const current = new URL(currentUrl);
    const nextUrl = new URL(location, current);
    if (nextUrl.origin !== current.origin) {
      return null;
    }
    return nextUrl.toString();
  } catch {
    return null;
  }
}

export function isBrowserOriginAllowed(
  origin: string | null,
  allowedOrigins: string | undefined,
): boolean {
  if (!origin || !allowedOrigins?.trim()) {
    return true;
  }

  return allowedOrigins
    .split(",")
    .map((allowedOrigin) => allowedOrigin.trim())
    .filter(Boolean)
    .includes(origin);
}

export function isTrustedAdminMutation(input: {
  requestUrl: string;
  origin: string | null;
  secFetchSite: string | null;
}): boolean {
  if (
    input.secFetchSite &&
    input.secFetchSite !== "same-origin" &&
    input.secFetchSite !== "none"
  ) {
    return false;
  }

  if (!input.origin) {
    return true;
  }

  try {
    return new URL(input.origin).host === new URL(input.requestUrl).host;
  } catch {
    return false;
  }
}

export function adminMutationAllowed(request: Request): boolean {
  return isTrustedAdminMutation({
    requestUrl: request.url,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
  });
}

export function clientRateLimitKey(request: Request, bucket: string): string {
  const realIp = request.headers.get("x-real-ip")?.split(",")[0]?.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  const forwardedIp = forwarded
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  return `${bucket}:${realIp || forwardedIp || "unknown"}`;
}

function pruneRateLimits(now: number): void {
  if (RATE_LIMIT_BUCKETS.size < 1000) {
    return;
  }

  for (const [key, entry] of RATE_LIMIT_BUCKETS) {
    if (entry.resetAt <= now) {
      RATE_LIMIT_BUCKETS.delete(key);
    }
  }

  if (RATE_LIMIT_BUCKETS.size >= 1000) {
    RATE_LIMIT_BUCKETS.clear();
  }
}

export function rateLimitAllows(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  pruneRateLimits(now);
  const entry = RATE_LIMIT_BUCKETS.get(key);
  if (!entry || entry.resetAt <= now) {
    return true;
  }
  return entry.count < limit;
}

export function recordRateLimitFailure(key: string, windowMs: number): void {
  const now = Date.now();
  pruneRateLimits(now);
  const entry = RATE_LIMIT_BUCKETS.get(key);
  if (!entry || entry.resetAt <= now) {
    RATE_LIMIT_BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  entry.count += 1;
}

export function clearRateLimit(key: string): void {
  RATE_LIMIT_BUCKETS.delete(key);
}

export function clearAllRateLimits(): void {
  RATE_LIMIT_BUCKETS.clear();
}
