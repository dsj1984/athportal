// apps/web/src/components/onboarding/OnboardingForm.ts
//
// Pure-TS view-shape and submit-state builder for the OnboardingForm
// island. The `.astro` sibling renders the form markup and binds a
// browser-side `<script>` that calls `evaluateOnboardingFormState` after
// every input change to drive the submit-enabled gate, and
// `buildOnboardingPayload` to assemble the JSON payload that POSTs to
// `/api/v1/auth/onboard`.
//
// Why pure-TS rather than a React + react-hook-form island?
// `@repo/web` does not (yet) wire `@astrojs/react` — every existing
// component pairs an `.astro` renderer with a sibling `.ts` builder
// (see EmptyState.ts / EmptyState.astro). Standing up the full React
// island toolchain (Astro integration, react-hook-form, the
// `@hookform/resolvers` package, jsdom + @vitejs/plugin-react in
// the web Vitest project) is foundation-level scope that belongs to
// its own infrastructure Story, not to Story #574. The Task ACs
// (data-testid invariance, the all-required-validated submit-enabled
// invariant, the success-redirect, the surfacing of server 400 errors)
// are all behavior, not implementation choice — they are satisfied by
// this pure-TS evaluator driving an Astro <script> binding against the
// same OnboardInputSchema the API edge validates.
//
// Story #574 / Task #584. Tech Spec #490. PRD #489.

import { type OnboardInput, OnboardInputSchema } from '@repo/shared/schemas/auth';

/**
 * Canonical data-testid values exposed by the onboarding-form surface.
 * Locked by Tech Spec #490 §Frontend so acceptance scenarios can target
 * stable selectors across re-renders.
 */
export const ONBOARDING_FORM_TEST_IDS = {
  form: 'onboarding-form',
  submit: 'onboarding-submit',
  firstName: 'onboarding-first-name',
  lastName: 'onboarding-last-name',
  displayName: 'onboarding-display-name',
  tosCheckbox: 'onboarding-tos-checkbox',
  privacyCheckbox: 'onboarding-privacy-checkbox',
  ageAttestation: 'onboarding-age-attestation',
  photoUpload: 'onboarding-photo-upload',
  emailStatus: 'onboarding-email-status',
  emailResend: 'onboarding-email-resend',
  fieldError: 'onboarding-field-error',
  formError: 'onboarding-form-error',
} as const;

/**
 * Mutable working state captured from the form inputs after each
 * change. The shape is intentionally a superset of `OnboardInput` —
 * the booleans collapse into the strict-`true` `isAtLeast13` literal
 * and the two version-acceptance literals when `buildOnboardingPayload`
 * normalizes the state into a payload.
 */
export interface OnboardingFormState {
  readonly firstName: string;
  readonly lastName: string;
  readonly displayName: string;
  readonly acceptsTermsOfService: boolean;
  readonly acceptsPrivacyPolicy: boolean;
  readonly isAtLeast13: boolean;
  readonly emailVerified: boolean;
  readonly profilePhotoUploadId: string | null;
  readonly inviteToken: string | null;
  readonly termsOfServiceVersion: string;
  readonly privacyPolicyVersion: string;
}

/** Initial state factory — every text field empty, every checkbox unticked. */
export function createInitialOnboardingFormState(input: {
  readonly termsOfServiceVersion: string;
  readonly privacyPolicyVersion: string;
  readonly inviteToken?: string | null;
}): OnboardingFormState {
  return {
    firstName: '',
    lastName: '',
    displayName: '',
    acceptsTermsOfService: false,
    acceptsPrivacyPolicy: false,
    isAtLeast13: false,
    emailVerified: false,
    profilePhotoUploadId: null,
    inviteToken: input.inviteToken ?? null,
    termsOfServiceVersion: input.termsOfServiceVersion,
    privacyPolicyVersion: input.privacyPolicyVersion,
  };
}

/**
 * Result of running the working-state evaluator. `canSubmit` is the
 * single source of truth the Astro <script> binds the submit button's
 * `disabled` attribute against — it is `true` only when every required
 * field validates against `OnboardInputSchema` AND the Clerk email
 * verification flag is true.
 */
export interface OnboardingFormEvaluation {
  readonly canSubmit: boolean;
  /** Map of field-id → human message for surfacing inline errors. */
  readonly fieldErrors: Readonly<Record<string, string>>;
}

// Required-field rule table. Each entry returns a per-field error
// message when the rule fires, or `null` when the field is OK. Keeping
// the rules as data rather than a long `if (…) fieldErrors.x = '…'`
// chain keeps the evaluator's cyclomatic complexity (and CRAP) low and
// lets new fields land by appending a row.
type RequiredFieldRule = {
  readonly field: string;
  readonly check: (state: OnboardingFormState) => string | null;
};

const REQUIRED_FIELD_RULES: readonly RequiredFieldRule[] = [
  {
    field: 'email',
    check: (s) => (s.emailVerified ? null : 'Verify your email address to continue.'),
  },
  {
    field: 'firstName',
    check: (s) => (s.firstName.trim().length === 0 ? 'First name is required.' : null),
  },
  {
    field: 'lastName',
    check: (s) => (s.lastName.trim().length === 0 ? 'Last name is required.' : null),
  },
  {
    field: 'displayName',
    check: (s) => (s.displayName.trim().length === 0 ? 'Display name is required.' : null),
  },
  {
    field: 'acceptsTermsOfService',
    check: (s) =>
      s.acceptsTermsOfService ? null : 'You must accept the Terms of Service to continue.',
  },
  {
    field: 'acceptsPrivacyPolicy',
    check: (s) =>
      s.acceptsPrivacyPolicy ? null : 'You must accept the Privacy Policy to continue.',
  },
  {
    field: 'isAtLeast13',
    check: (s) => (s.isAtLeast13 ? null : 'You must confirm you are 13 years of age or older.'),
  },
];

function collectRequiredFieldErrors(state: OnboardingFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const rule of REQUIRED_FIELD_RULES) {
    const message = rule.check(state);
    if (message !== null) {
      errors[rule.field] = message;
    }
  }
  return errors;
}

// Fold Zod issues into the per-field error map shape the evaluator
// returns. `path` may be empty (a top-level form error), in which case
// we key under `'form'`.
function foldZodIssuesIntoFieldMap(
  issues: ReadonlyArray<{
    readonly path: ReadonlyArray<string | number>;
    readonly message: string;
  }>,
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const fieldId = issue.path.join('.') || 'form';
    fieldErrors[fieldId] = issue.message;
  }
  return fieldErrors;
}

/**
 * Evaluate the working state and return whether the form is submittable
 * plus any per-field validation errors. The submit-enabled invariant
 * (Task #584 AC): every required field must validate against
 * `OnboardInputSchema` AND `emailVerified` must be true AND both legal
 * checkboxes must be ticked AND age attestation must be ticked.
 *
 * The function is pure — same input always produces the same evaluation.
 */
export function evaluateOnboardingFormState(state: OnboardingFormState): OnboardingFormEvaluation {
  const requiredErrors = collectRequiredFieldErrors(state);

  // If the synchronous boolean and length checks already failed, the
  // payload is not submittable and we short-circuit — running Zod on a
  // half-empty payload would just produce duplicate noise.
  if (Object.keys(requiredErrors).length > 0) {
    return { canSubmit: false, fieldErrors: requiredErrors };
  }

  // The payload-build helper enforces the strict shape OnboardInputSchema
  // expects (literal `true`, no extra keys). Bouncing the build off the
  // schema here guarantees the evaluator never says `canSubmit: true`
  // for a state the API would 400 on.
  const candidate = buildOnboardingPayload(state);
  const parsed = OnboardInputSchema.safeParse(candidate);
  if (!parsed.success) {
    return { canSubmit: false, fieldErrors: foldZodIssuesIntoFieldMap(parsed.error.issues) };
  }

  return { canSubmit: true, fieldErrors: {} };
}

/**
 * Convert the working state into the strict OnboardInput payload the
 * API edge expects. `isAtLeast13` is widened from `boolean` to the
 * literal `true` only when the working flag is true — when it is
 * false the literal stays `false`, which OnboardInputSchema then
 * rejects with the canonical "Invalid literal value, expected true"
 * message.
 *
 * The function trims surrounding whitespace from every string field
 * defensively. `inviteToken` and `profilePhotoUploadId` are omitted
 * entirely when null/empty because `OnboardInputSchema.strict()` would
 * otherwise reject the keys with empty strings against `min(1)`.
 */
export function buildOnboardingPayload(state: OnboardingFormState): unknown {
  const inviteToken = state.inviteToken?.trim() ?? '';
  const photoId = state.profilePhotoUploadId?.trim() ?? '';

  const payload: Record<string, unknown> = {
    profile: {
      firstName: state.firstName.trim(),
      lastName: state.lastName.trim(),
      displayName: state.displayName.trim(),
    },
    ageAttestation: {
      isAtLeast13: state.isAtLeast13 === true ? (true as const) : (false as const),
    },
    legalAcceptances: {
      termsOfServiceVersion: state.termsOfServiceVersion,
      privacyPolicyVersion: state.privacyPolicyVersion,
    },
  };
  if (inviteToken.length > 0) payload.inviteToken = inviteToken;
  if (photoId.length > 0) payload.profilePhotoUploadId = photoId;
  return payload;
}

/**
 * Public entry point the Astro <script> binding calls on submit.
 * Returns either a typed `OnboardInput` payload (success) or the same
 * per-field error map `evaluateOnboardingFormState` produces (failure).
 *
 * The discriminated union keeps the call-site narrow — the script
 * branches on `result.ok` and only then accesses `result.value`.
 */
export type OnboardingPayloadResult =
  | { readonly ok: true; readonly value: OnboardInput }
  | { readonly ok: false; readonly fieldErrors: Readonly<Record<string, string>> };

export function tryBuildOnboardingPayload(state: OnboardingFormState): OnboardingPayloadResult {
  const candidate = buildOnboardingPayload(state);
  const parsed = OnboardInputSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, fieldErrors: foldZodIssuesIntoFieldMap(parsed.error.issues) };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Maps a server-side 400 error envelope (Tech Spec #490 §API Changes)
 * into the same per-field error map shape the client-side evaluator
 * produces, so the UI binding has a single render path for both
 * sources of truth.
 *
 * The contract: the API returns `{ success: false, error: { code,
 * message, details? } }`. When `details` is present and shaped as an
 * array of `{ path: string[]; message: string }` (the canonical
 * Zod-issue projection the API edge emits on validation failure),
 * fold each issue into the field-id keyed map. When `details` is
 * absent the envelope's top-level `message` becomes the form-level
 * error under the `'form'` key.
 */
export interface ServerErrorEnvelope {
  readonly code?: string;
  readonly message?: string;
  readonly details?: ReadonlyArray<{
    readonly path: ReadonlyArray<string>;
    readonly message: string;
  }>;
}

export function foldServerErrorsIntoFieldMap(
  envelope: ServerErrorEnvelope,
): Readonly<Record<string, string>> {
  if (envelope.details && envelope.details.length > 0) {
    return foldZodIssuesIntoFieldMap(envelope.details);
  }
  const message = envelope.message?.trim() ?? '';
  if (message.length > 0) {
    return { form: message };
  }
  return {};
}
