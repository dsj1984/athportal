// packages/baselines/src/types.test.ts
//
// Unit suite for the constant-side of the harness surface. The type
// declarations themselves are validated by `tsc --noEmit` in this
// workspace's typecheck target; this file pins the runtime constants
// the dimension scripts will discriminate on.

import { describe, expect, it } from 'vitest';
import { BASELINE_KINDS } from './types.js';

describe('BASELINE_KINDS', () => {
  it('lists the seven dimensions in Tech-Spec order', () => {
    expect(BASELINE_KINDS).toEqual([
      'lint',
      'coverage',
      'crap',
      'maintainability',
      'mutation',
      'lighthouse',
      'bundle-size',
    ]);
  });

  it('is exposed as a readonly tuple', () => {
    // Readonly in the type system → freeze at runtime would be redundant;
    // the assertion below just pins arity so accidental drift fails fast.
    expect(BASELINE_KINDS).toHaveLength(7);
  });
});
