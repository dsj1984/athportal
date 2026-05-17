// Foundation shim — see Epic #6 for the real ratchet implementation.
//
// The `.agents` framework statically imports `refreshBaseline` from this
// path at module load. Until Epic #6 (`foundation-quality-baselines`)
// lands the maintainability / crap / coverage ratchet services, this
// shim returns a structural no-op so framework consumers can import
// without crashing.
//
// Call sites short-circuit on `writePath` before reaching this shim
// whenever the project has not wired up the matching baseline config,
// so in practice this is invoked only when a downstream Epic
// half-wires a baseline. When that happens, the no-op return reports
// "nothing written" and the auto-refresh runner logs
// "no baseline drift to fold in" and proceeds.

/**
 * @param {{
 *   kind: string,
 *   baseRef?: string,
 *   headRef?: string,
 *   scopeFiles?: string[] | null,
 *   fullScope?: boolean,
 *   writePath: string,
 *   scorer?: unknown,
 *   fs?: unknown,
 *   cwd?: string,
 * }} _args
 * @returns {Promise<{ wrote: false, scope: { mode: 'noop' } }>}
 */
export async function refreshBaseline(_args) {
  return { wrote: false, scope: { mode: 'noop' } };
}
