// packages/baselines/src/serialise.ts
//
// Byte-identical JSON serialiser for committed baseline files.
//
// Stability rules (enforced by `writeBaseline` after this module
// runs):
//
//   1. Object keys are emitted in lexicographic order at every depth.
//      Arrays preserve caller-supplied ordering — per-kind row order
//      is the producing script's responsibility, not this module's.
//   2. The output ends with a single LF newline.
//   3. Pretty-printed with two-space indentation. Matches the existing
//      `.lint-baseline.json` precedent the repo already ships.
//
// The contract is: `serialise(parse(serialise(x))) === serialise(x)`
// for any value `x` that is itself the result of `serialise`. That is
// what makes round-tripping a stable diff signal — a hand-edit that
// keeps the document valid but reorders keys still gets caught by the
// byte-identical invariant in `writeBaseline`.

/**
 * Serialise a JSON-compatible value with stable, sorted-key,
 * trailing-newline output. Use this for every committed baseline JSON
 * write so the diff stays minimal across runs.
 */
export function serialiseBaseline(value: unknown): string {
  return `${stringifyStable(value, 0)}\n`;
}

function stringifyStable(value: unknown, indentDepth: number): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`[@repo/baselines] cannot serialise non-finite number: ${String(value)}`);
    }
    // `JSON.stringify` emits the canonical short form (e.g. `1`,
    // `1.5`, `0.1`) — reuse it so we never accidentally emit
    // `1.0000000000001` from a naïve `toString`.
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return stringifyArray(value, indentDepth);
  if (typeof value === 'object') {
    return stringifyObject(value as Record<string, unknown>, indentDepth);
  }
  throw new Error(`[@repo/baselines] cannot serialise value of type ${typeof value}`);
}

function stringifyArray(arr: readonly unknown[], indentDepth: number): string {
  if (arr.length === 0) return '[]';
  const inner = indent(indentDepth + 1);
  const closing = indent(indentDepth);
  const parts = arr.map((entry) => `${inner}${stringifyStable(entry, indentDepth + 1)}`);
  return `[\n${parts.join(',\n')}\n${closing}]`;
}

function stringifyObject(obj: Record<string, unknown>, indentDepth: number): string {
  const keys = Object.keys(obj).sort();
  if (keys.length === 0) return '{}';
  const inner = indent(indentDepth + 1);
  const closing = indent(indentDepth);
  const parts = keys.map((key) => {
    const k = JSON.stringify(key);
    const v = stringifyStable(obj[key], indentDepth + 1);
    return `${inner}${k}: ${v}`;
  });
  return `{\n${parts.join(',\n')}\n${closing}}`;
}

function indent(depth: number): string {
  return '  '.repeat(depth);
}

/**
 * Parse and re-serialise a JSON string with the same stable rules. A
 * caller that wants to assert "this file is in canonical form" can
 * compare `serialiseBaseline(JSON.parse(raw))` against the original
 * raw bytes — if they match, the file was hand-written in canonical
 * shape (or was last written by the harness).
 */
export function reserialiseFromString(raw: string): string {
  const parsed = JSON.parse(raw) as unknown;
  return serialiseBaseline(parsed);
}
