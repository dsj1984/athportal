// apps/web/src/components/ui/FormField.test.ts
//
// Unit tests for the shared FormField primitive. Targets the pure
// `buildFormFieldView` builder that the `.astro` sibling renders; the
// web workspace's Vitest project runs in a node environment with no
// JSX/Astro renderer, so the builder is the testable surface that
// describes the rendered DOM shape (wrapper class, label class, helper
// visibility, error role/visibility, required marker).
//
// Story #837 / Task #841.
import { describe, expect, it } from 'vitest';
import { type FormFieldProps, buildFormFieldView } from './FormField';

const baseProps: FormFieldProps = {
  label: 'First name',
  htmlFor: 'first-name',
};

describe('buildFormFieldView — required label', () => {
  it('returns the label and htmlFor verbatim', () => {
    const view = buildFormFieldView(baseProps);
    expect(view.label).toBe('First name');
    expect(view.htmlFor).toBe('first-name');
  });

  it('trims surrounding whitespace from label and htmlFor', () => {
    const view = buildFormFieldView({ label: '  First name  ', htmlFor: '\tfirst-name\n' });
    expect(view.label).toBe('First name');
    expect(view.htmlFor).toBe('first-name');
  });

  it('throws TypeError when label is empty or whitespace-only', () => {
    expect(() => buildFormFieldView({ ...baseProps, label: '   ' })).toThrow(TypeError);
  });

  it('throws TypeError when htmlFor is empty or whitespace-only', () => {
    expect(() => buildFormFieldView({ ...baseProps, htmlFor: '' })).toThrow(TypeError);
  });
});

describe('buildFormFieldView — helper branch', () => {
  it('omits the helper when no helper prop is provided', () => {
    const view = buildFormFieldView(baseProps);
    expect(view.helper).toBeNull();
  });

  it('treats an empty/whitespace helper as omitted', () => {
    const view = buildFormFieldView({ ...baseProps, helper: '   ' });
    expect(view.helper).toBeNull();
  });

  it('wires the helper through and exposes a derived helperId', () => {
    const view = buildFormFieldView({ ...baseProps, helper: 'Use your legal first name.' });
    expect(view.helper).toBe('Use your legal first name.');
    expect(view.helperId).toBe('first-name-helper');
  });

  it('trims whitespace from the helper copy', () => {
    const view = buildFormFieldView({ ...baseProps, helper: '  Use your legal first name.  ' });
    expect(view.helper).toBe('Use your legal first name.');
  });
});

describe('buildFormFieldView — error branch', () => {
  it('reports no error when error prop is omitted', () => {
    const view = buildFormFieldView(baseProps);
    expect(view.hasError).toBe(false);
    expect(view.error).toBeNull();
    expect(view.errorRole).toBeNull();
  });

  it('reports no error when error prop is null (matches field-error map shape)', () => {
    const view = buildFormFieldView({ ...baseProps, error: null });
    expect(view.hasError).toBe(false);
    expect(view.error).toBeNull();
    expect(view.errorRole).toBeNull();
  });

  it('reports no error when error prop is an empty/whitespace string', () => {
    const view = buildFormFieldView({ ...baseProps, error: '   ' });
    expect(view.hasError).toBe(false);
    expect(view.error).toBeNull();
    expect(view.errorRole).toBeNull();
  });

  it('renders the error branch when error prop is a non-empty string', () => {
    const view = buildFormFieldView({ ...baseProps, error: 'First name is required.' });
    expect(view.hasError).toBe(true);
    expect(view.error).toBe('First name is required.');
  });

  it('sets role="alert" on the error paragraph in the error branch', () => {
    const view = buildFormFieldView({ ...baseProps, error: 'First name is required.' });
    expect(view.errorRole).toBe('alert');
  });

  it('exposes a derived errorId on the error branch', () => {
    const view = buildFormFieldView({ ...baseProps, error: 'First name is required.' });
    expect(view.errorId).toBe('first-name-error');
  });

  it('trims whitespace from the error copy', () => {
    const view = buildFormFieldView({ ...baseProps, error: '  First name is required.  ' });
    expect(view.error).toBe('First name is required.');
  });

  it('switches the wrapper to a red-border state on the error branch', () => {
    const ok = buildFormFieldView(baseProps);
    const err = buildFormFieldView({ ...baseProps, error: 'First name is required.' });
    expect(ok.wrapperClass).not.toContain('border-action-coral');
    expect(err.wrapperClass).toContain('border-action-coral');
  });
});

describe('buildFormFieldView — required flag', () => {
  it('defaults required to false when omitted', () => {
    const view = buildFormFieldView(baseProps);
    expect(view.required).toBe(false);
  });

  it('mirrors required: true through to the view', () => {
    const view = buildFormFieldView({ ...baseProps, required: true });
    expect(view.required).toBe(true);
  });

  it('mirrors required: false through to the view', () => {
    const view = buildFormFieldView({ ...baseProps, required: false });
    expect(view.required).toBe(false);
  });
});

describe('buildFormFieldView — combined prop matrices', () => {
  it('renders label + helper + required without error', () => {
    const view = buildFormFieldView({
      label: 'Last name',
      htmlFor: 'last-name',
      helper: 'Family name as it appears on your ID.',
      required: true,
    });
    expect(view.label).toBe('Last name');
    expect(view.helper).toBe('Family name as it appears on your ID.');
    expect(view.required).toBe(true);
    expect(view.hasError).toBe(false);
    expect(view.errorRole).toBeNull();
  });

  it('renders label + error + required (helper hidden on error branch)', () => {
    const view = buildFormFieldView({
      label: 'Display name',
      htmlFor: 'display-name',
      helper: 'How other athletes see you.',
      error: 'Display name is required.',
      required: true,
    });
    expect(view.helper).toBe('How other athletes see you.');
    expect(view.error).toBe('Display name is required.');
    expect(view.hasError).toBe(true);
    expect(view.errorRole).toBe('alert');
    expect(view.required).toBe(true);
  });

  it('label-only minimal props (no helper, no error, not required)', () => {
    const view = buildFormFieldView({ label: 'Email', htmlFor: 'email' });
    expect(view.label).toBe('Email');
    expect(view.helper).toBeNull();
    expect(view.error).toBeNull();
    expect(view.required).toBe(false);
    expect(view.hasError).toBe(false);
    expect(view.errorRole).toBeNull();
  });

  it('exposes both helperId and errorId derived from htmlFor', () => {
    const view = buildFormFieldView({
      label: 'Email',
      htmlFor: 'profile-email',
      helper: 'We use this to send confirmations.',
      error: 'Email is required.',
    });
    expect(view.helperId).toBe('profile-email-helper');
    expect(view.errorId).toBe('profile-email-error');
  });
});
