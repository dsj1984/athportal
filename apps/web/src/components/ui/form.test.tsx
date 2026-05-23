// apps/web/src/components/ui/form.test.tsx
//
// Unit tests for the form-primitive trio (Input, Textarea, Select) and
// the shared cva matrix in `_lib/form.ts`. The tests exercise the
// cva matrix directly and render each primitive to static markup via
// `react-dom/server` so they run without a DOM (the unit-jsdom project
// picks them up, but they are framework-light). Per the Task AC,
// every primitive is asserted in both `default` and `invalid` intents
// (3 × 2 = 6 cases).
//
// Story #715 / Task #727.

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Input } from './Input';
import { Select } from './Select';
import { Textarea } from './Textarea';
import { type FormIntent, formControlVariants } from './_lib/form';

const INTENTS: readonly FormIntent[] = ['default', 'invalid'];

describe('formControlVariants — base classes', () => {
  it('always keys the focus-visible ring to --color-brand by default', () => {
    const cls = formControlVariants({});
    expect(cls).toContain('focus-visible:ring-brand/40');
    expect(cls).toContain('focus-visible:ring-2');
  });

  it('applies the default intent (border-border) when called with no args', () => {
    const cls = formControlVariants({});
    expect(cls).toContain('border-border');
  });

  it('invalid intent swaps in the action-coral border and ring', () => {
    const cls = formControlVariants({ intent: 'invalid' });
    expect(cls).toContain('border-action-coral');
    expect(cls).toContain('focus-visible:ring-action-coral/40');
    expect(cls).not.toContain('border-border ');
  });
});

describe('<Input> — intent matrix', () => {
  for (const intent of INTENTS) {
    it(`renders intent=${intent} with the expected class fragment and aria-invalid`, () => {
      const html = renderToStaticMarkup(<Input intent={intent} name="email" />);
      if (intent === 'invalid') {
        expect(html).toContain('border-action-coral');
        expect(html).toContain('focus-visible:ring-action-coral/40');
        expect(html).toContain('aria-invalid="true"');
      } else {
        expect(html).toContain('border-border');
        expect(html).toContain('focus-visible:ring-brand/40');
        expect(html).not.toContain('aria-invalid');
      }
    });
  }

  it('defaults to type="text" when no type is supplied', () => {
    const html = renderToStaticMarkup(<Input name="email" />);
    expect(html).toContain('type="text"');
  });

  it('forwards arbitrary native attributes (placeholder, name)', () => {
    const html = renderToStaticMarkup(<Input name="email" placeholder="you@example.com" />);
    expect(html).toContain('placeholder="you@example.com"');
    expect(html).toContain('name="email"');
  });
});

describe('<Textarea> — intent matrix', () => {
  for (const intent of INTENTS) {
    it(`renders intent=${intent} with the expected class fragment and aria-invalid`, () => {
      const html = renderToStaticMarkup(<Textarea intent={intent} name="bio" />);
      if (intent === 'invalid') {
        expect(html).toContain('border-action-coral');
        expect(html).toContain('focus-visible:ring-action-coral/40');
        expect(html).toContain('aria-invalid="true"');
      } else {
        expect(html).toContain('border-border');
        expect(html).toContain('focus-visible:ring-brand/40');
        expect(html).not.toContain('aria-invalid');
      }
    });
  }

  it('renders a <textarea> element (not an <input>)', () => {
    const html = renderToStaticMarkup(<Textarea name="bio" />);
    expect(html).toMatch(/^<textarea/);
  });
});

describe('<Select> — intent matrix', () => {
  for (const intent of INTENTS) {
    it(`renders intent=${intent} with the expected class fragment and aria-invalid`, () => {
      const html = renderToStaticMarkup(
        <Select intent={intent} name="role">
          <option value="coach">Coach</option>
        </Select>,
      );
      if (intent === 'invalid') {
        expect(html).toContain('border-action-coral');
        expect(html).toContain('focus-visible:ring-action-coral/40');
        expect(html).toContain('aria-invalid="true"');
      } else {
        expect(html).toContain('border-border');
        expect(html).toContain('focus-visible:ring-brand/40');
        expect(html).not.toContain('aria-invalid');
      }
    });
  }

  it('renders the supplied <option> children', () => {
    const html = renderToStaticMarkup(
      <Select name="role">
        <option value="coach">Coach</option>
        <option value="athlete">Athlete</option>
      </Select>,
    );
    expect(html).toContain('<option value="coach">Coach</option>');
    expect(html).toContain('<option value="athlete">Athlete</option>');
  });
});
