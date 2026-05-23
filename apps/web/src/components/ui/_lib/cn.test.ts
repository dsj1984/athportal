// apps/web/src/components/ui/_lib/cn.test.ts
//
// Unit coverage for the cn() class-merge helper. Two cases per Task #717
// AC: (1) conflicting Tailwind utilities resolve last-write-wins via
// tailwind-merge, and (2) clsx's falsy-input handling drops nullish /
// boolean / empty arguments. Anything beyond those two cases belongs to
// the upstream libraries' own test suites — cn is a one-liner.

import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('resolves conflicting Tailwind classes to the last write', () => {
    // Both p-2 and p-4 target the same padding utility; tailwind-merge
    // drops the earlier write so the rendered DOM ends up with p-4 only.
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('drops falsy inputs (null, undefined, false, empty string)', () => {
    // clsx's contract: any falsy value is skipped, only truthy class
    // strings survive into the final join.
    expect(cn('a', null, undefined, false, '', 'b')).toBe('a b');
  });
});
