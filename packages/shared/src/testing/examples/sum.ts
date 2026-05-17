/**
 * Tiny pure-logic helper used to demonstrate the Vitest unit tier wiring.
 *
 * Lives under `packages/shared/src/testing/examples/` because it is shipped
 * solely as a teaching artifact — production code does not import it.
 */
export function sum(a: number, b: number): number {
  return a + b;
}
