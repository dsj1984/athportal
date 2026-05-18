// packages/baselines/src/index.ts
//
// Public surface for the @repo/baselines harness. Each of the seven
// dimension scripts (lint, coverage, crap, maintainability, mutation,
// lighthouse, bundle-size) imports from this barrel and never touches a
// sibling module directly.
//
// The shape of every committed baseline JSON is fixed by
// `.agents/schemas/baselines/baseline-envelope.schema.json` (the shared
// envelope) plus a per-kind schema in the same directory. The types
// re-exported here mirror those schemas — keep both sides in lockstep
// when the schema evolves.

export type {
  BaselineEnvelope,
  BaselineKind,
  Diff,
  DiffSeverity,
  ToleranceSpec,
} from './types.js';

export { BASELINE_KINDS } from './types.js';

// IO + AJV validation surface lands under task #239 (sibling Task in
// this Story). The compare + format surface lands under task #240. Both
// re-export from here so consumers always import from '@repo/baselines'.
