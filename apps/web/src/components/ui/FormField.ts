// apps/web/src/components/ui/FormField.ts
//
// Pure-TS view-shape builder for the FormField primitive. The `.astro`
// sibling renders the label, the slot for the control element, and the
// helper / error paragraph; this builder shapes the class strings and
// the error-branch role/visibility flags that the `.astro` consumes.
//
// Why split? The web workspace's Vitest project runs in a `node`
// environment with no JSX/Astro renderer wired in. Keeping the
// class-shaping decisions in a pure-TS module lets the unit tier
// exercise every prop combination (with/without helper, with/without
// error, required/not-required) against the same shape the `.astro`
// renders — mirrors the EmptyState.ts pattern (ADR-0007).
//
// Story #837 / Task #841.

/** Public props for the FormField primitive. */
export interface FormFieldProps {
  /** Visible label text, e.g. "First name". */
  readonly label: string;
  /** ID of the control element rendered into the default slot. */
  readonly htmlFor: string;
  /** Optional sub-label helper text. Hidden when omitted. */
  readonly helper?: string;
  /**
   * Optional inline error message. When a non-empty string is
   * provided, the error branch renders: the wrapper switches to its
   * red-border state and the error paragraph carries `role="alert"`.
   * `null` is treated as "no error" (matches the OnboardingForm's
   * field-error map shape).
   */
  readonly error?: string | null;
  /** When true, the label renders a `*` marker. Defaults to `false`. */
  readonly required?: boolean;
}

/**
 * Render-time view shape produced by the builder. The `.astro` sibling
 * spreads these strings/flags onto its markup verbatim; the unit tier
 * asserts on the same fields the page renders.
 */
export interface FormFieldView {
  readonly label: string;
  readonly htmlFor: string;
  readonly helper: string | null;
  readonly error: string | null;
  readonly required: boolean;
  readonly hasError: boolean;
  /** Wrapper class string. Switches to the red-border state on error. */
  readonly wrapperClass: string;
  /** Label class string. */
  readonly labelClass: string;
  /** Helper paragraph class string. */
  readonly helperClass: string;
  /** Error paragraph class string. */
  readonly errorClass: string;
  /**
   * `role` attribute the error paragraph carries on the error branch
   * (`"alert"`) or `null` when no error is rendered.
   */
  readonly errorRole: 'alert' | null;
  /**
   * `id` the helper paragraph carries so the slotted control can wire
   * it via `aria-describedby`. Derived from `htmlFor`.
   */
  readonly helperId: string;
  /**
   * `id` the error paragraph carries so the slotted control can wire
   * it via `aria-describedby` on the error branch. Derived from `htmlFor`.
   */
  readonly errorId: string;
}

const WRAPPER_BASE = 'flex flex-col gap-1 rounded-md border border-transparent bg-transparent p-0';
const WRAPPER_ERROR = 'border border-action-coral rounded-md bg-transparent p-2';
const LABEL_CLASS = 'text-sm font-medium text-text-primary';
const HELPER_CLASS = 'text-xs text-text-tertiary';
const ERROR_CLASS = 'text-xs text-action-coral';

/**
 * Shape FormField props into the render-ready view. Trims copy
 * defensively and validates that the label and htmlFor are non-empty.
 * Throws `TypeError` on invalid input so authoring mistakes fail
 * loudly at the call site rather than rendering a blank field.
 */
export function buildFormFieldView(props: FormFieldProps): FormFieldView {
  const label = props.label.trim();
  const htmlFor = props.htmlFor.trim();
  if (label.length === 0) {
    throw new TypeError('FormField: `label` must be a non-empty string.');
  }
  if (htmlFor.length === 0) {
    throw new TypeError('FormField: `htmlFor` must be a non-empty string.');
  }

  const helperRaw = typeof props.helper === 'string' ? props.helper.trim() : '';
  const helper = helperRaw.length > 0 ? helperRaw : null;

  const errorRaw = typeof props.error === 'string' ? props.error.trim() : '';
  const error = errorRaw.length > 0 ? errorRaw : null;
  const hasError = error !== null;

  const required = props.required === true;

  return {
    label,
    htmlFor,
    helper,
    error,
    required,
    hasError,
    wrapperClass: hasError ? WRAPPER_ERROR : WRAPPER_BASE,
    labelClass: LABEL_CLASS,
    helperClass: HELPER_CLASS,
    errorClass: ERROR_CLASS,
    errorRole: hasError ? 'alert' : null,
    helperId: `${htmlFor}-helper`,
    errorId: `${htmlFor}-error`,
  };
}
