/**
 * Observability redaction allowlist — the single trust boundary for log
 * egress to the managed sink.
 *
 * Per Epic #5 PRD AC-7 and Tech Spec § Security & Privacy Considerations
 * (#246), this is the **only** module in the codebase where PII disclosure
 * to logs is decided. The middleware that constructs `LogEvent` payloads
 * imports `RedactionAllowlist` and the redact functions from here; it
 * does not maintain its own field list.
 *
 * Posture rules (do not weaken without an ADR):
 *
 *   1. `RedactionAllowlist` is `Object.freeze`'d so the runtime cannot
 *      mutate the Sets after module load. A misbehaving caller doing
 *      `RedactionAllowlist.headers.add('cookie')` would throw in strict
 *      mode and silently noop otherwise; the frozen wrapper prevents the
 *      reference itself from being reassigned. The Sets themselves are
 *      not Object.frozen (Set has no equivalent), but consumers MUST
 *      treat them as read-only.
 *   2. `bodyKeys` starts as an empty Set. Widening requires the ADR
 *      template at `docs/decisions/_template-redaction-widening.md`.
 *   3. Both redact functions silently drop disallowed keys. They do NOT
 *      throw on a disallowed input. This is deliberate: throwing on the
 *      hot request path would convert a logging-layer mistake into a
 *      user-visible 5xx, which is exactly the wrong incentive.
 *
 * Operator-facing companion: `docs/ops/observability-redaction.md`.
 */

const HEADER_ALLOWLIST = [
  'user-agent',
  'cf-ray',
  'cf-ipcountry',
  'x-request-id',
  'accept-language',
] as const;

const QUERY_KEY_ALLOWLIST = ['cursor', 'limit', 'order', 'sort'] as const;

const BODY_KEY_ALLOWLIST: readonly string[] = [];

/**
 * Allowlist of metadata keys the request-completion logger may copy from
 * a request into the `LogEvent.metadata` map.
 *
 * Frozen at module load. Mutating any nested Set is a posture violation
 * and is reviewable.
 */
export const RedactionAllowlist = Object.freeze({
  /** Request headers we may copy. Compared case-insensitively. */
  headers: new Set<string>(HEADER_ALLOWLIST),
  /** Query-string keys we may copy. Compared case-sensitively. */
  queryKeys: new Set<string>(QUERY_KEY_ALLOWLIST),
  /** JSON body field names we may copy. Empty on Day 1 — widening requires an ADR. */
  bodyKeys: new Set<string>(BODY_KEY_ALLOWLIST),
});

/**
 * Walk a `Headers` instance and emit a flat string-to-string map containing
 * only entries whose lower-cased name appears in
 * `RedactionAllowlist.headers`. Disallowed entries are silently dropped.
 *
 * Header names are lower-cased in the output (matches the WHATWG Fetch
 * canonicalization the sink expects). Non-string values cannot occur on a
 * `Headers` instance, so no stringification is needed here.
 */
export function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (RedactionAllowlist.headers.has(lower)) {
      out[lower] = value;
    }
  });
  return out;
}

/**
 * Read the URL search params and (when the `Content-Type` is JSON) the
 * request body, and emit a flat string-to-string map of allowlisted
 * entries.
 *
 * Behaviour contract:
 *
 *   - Query keys are compared case-sensitively against
 *     `RedactionAllowlist.queryKeys`. Multi-valued query params (e.g.
 *     `?tag=a&tag=b`) collapse to the last value, matching how
 *     `URLSearchParams.get` resolves repeats.
 *   - JSON body parsing is best-effort. A non-JSON content type, a
 *     missing body, an unparseable body, or a body that is not a plain
 *     object all result in zero body entries — never a throw.
 *   - Body values are stringified via `String(value)` so the sink's flat
 *     column model stays intact. Nested objects therefore appear as
 *     `'[object Object]'` if they ever sneak past an empty allowlist,
 *     which is itself a tell that the allowlist needs revisiting.
 *
 * The request is read via `req.clone().text()` so the caller's downstream
 * `req.json()` / `req.text()` continues to work — the redactor never
 * consumes the body the handler will need.
 */
export async function redactQueryAndBody(
  req: Request,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  // Query first — cheap, synchronous, no body consumption.
  const url = new URL(req.url);
  url.searchParams.forEach((value, key) => {
    if (RedactionAllowlist.queryKeys.has(key)) {
      out[key] = value;
    }
  });

  // Body second — only when the allowlist could possibly produce output
  // AND the content type is JSON. The empty-allowlist short-circuit
  // means Day 1 callers pay zero body-parse cost.
  if (RedactionAllowlist.bodyKeys.size === 0) {
    return out;
  }

  // `Headers.get` returns `null` when the header is absent. `null` does
  // not include any substring, so the includes() check short-circuits
  // through the same branch as a non-JSON content type.
  const contentType = req.headers.get('content-type');
  if (contentType === null || !contentType.toLowerCase().includes('application/json')) {
    return out;
  }

  let raw: string;
  try {
    raw = await req.clone().text();
  } catch {
    return out;
  }
  if (raw.length === 0) {
    return out;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return out;
  }

  for (const key of Object.keys(parsed as Record<string, unknown>)) {
    if (RedactionAllowlist.bodyKeys.has(key)) {
      // JSON.parse never produces `undefined` values, so `String(value)`
      // is safe — there is no realistic undefined branch to guard.
      out[key] = String((parsed as Record<string, unknown>)[key]);
    }
  }

  return out;
}
