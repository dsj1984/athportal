import { describe, expect, it } from 'vitest';

import { sum } from './sum';

describe('sum', () => {
  it('returns the arithmetic sum of two positive integers', () => {
    expect(sum(2, 3)).toBe(5);
  });

  it('handles negative operands', () => {
    expect(sum(-2, -3)).toBe(-5);
  });

  it('treats zero as the additive identity', () => {
    expect(sum(0, 7)).toBe(7);
    expect(sum(7, 0)).toBe(7);
  });
});
