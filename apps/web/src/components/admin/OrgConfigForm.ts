// apps/web/src/components/admin/OrgConfigForm.ts
//
// Pure-TS view-shape + payload builder for the admin org-config form
// island (Epic #10 / Story #656 / Task #674).
//
// The `.astro` sibling renders the form markup and binds a browser-side
// `<script>` that calls `evaluateOrgConfigFormState` after every input
// change and `buildOrgConfigPatchPayload` to assemble the JSON body
// sent to `PATCH /api/v1/admin/org`. The pure-TS evaluator gates the
// submit button and folds Zod issue paths back into per-field errors.
//
// Why pure-TS rather than a React + react-hook-form island?
// `@repo/web` does not (yet) wire `@astrojs/react`. The existing
// onboarding-form pattern (Story #574) pairs an `.astro` renderer with
// a sibling `.ts` builder; the Task ACs (data-testid invariance,
// submit-enabled gate, success status, validation surfacing) are all
// behavior, not implementation choice — they are satisfied by this
// pure-TS evaluator driving an Astro <script> binding against the same
// `OrgConfigPatchSchema` the API edge validates.

import {
  HEX_COLOR_PATTERN,
  type OrgConfigOutput,
  type OrgConfigPatchInput,
  OrgConfigPatchSchema,
} from '@repo/shared/schemas/admin/org';

/**
 * Canonical data-testid values exposed by the org-config form surface.
 * Locked by the Story #656 / Task #674 acceptance criteria so the
 * acceptance scenario can target stable selectors across re-renders.
 *
 * The `form`, `status`, `logoInput`, and `primaryColorInput` ids are
 * load-bearing — they appear verbatim in the Task AC.
 */
export const ORG_CONFIG_FORM_TEST_IDS = {
  form: 'admin-org-config-form',
  status: 'admin-org-config-status',
  submit: 'admin-org-config-submit',
  name: 'admin-org-name-input',
  primaryColor: 'admin-org-primary-color-input',
  logo: 'admin-org-logo-input',
  formError: 'admin-org-config-form-error',
} as const;

/**
 * Working state captured from the form inputs. The shape is intentionally
 * a superset of `OrgConfigPatchInput`: a `null` `primaryColorHex` means
 * "clear the colour", an empty string means "the field was untouched"
 * and the payload omits the key entirely.
 */
export interface OrgConfigFormState {
  readonly name: string;
  readonly primaryColorHex: string;
  readonly logoR2Key: string | null;
}

/** Loader payload — the GET /api/v1/admin/org response data field. */
export type OrgConfigLoaderPayload = OrgConfigOutput;

/**
 * Build the initial form state from the loader payload returned by GET.
 * Nullable columns collapse to empty strings so the controlled inputs
 * always carry a defined value.
 */
export function createInitialOrgConfigFormState(
  loader: OrgConfigLoaderPayload,
): OrgConfigFormState {
  return {
    name: loader.name,
    primaryColorHex: loader.primaryColorHex ?? '',
    logoR2Key: null,
  };
}

export type FieldKey = 'name' | 'primaryColorHex';

export interface FormEvaluation {
  readonly canSubmit: boolean;
  readonly fieldErrors: Readonly<Partial<Record<FieldKey, string>>>;
}

/**
 * Pure evaluator. Drives the submit-enabled gate and surfaces inline
 * field errors without ever touching the DOM. The browser script
 * passes its `readState()` snapshot here on every input event.
 */
export function evaluateOrgConfigFormState(state: OrgConfigFormState): FormEvaluation {
  const fieldErrors: Partial<Record<FieldKey, string>> = {};

  if (state.name.trim().length === 0) {
    fieldErrors.name = 'Organization name is required.';
  } else if (state.name.length > 200) {
    fieldErrors.name = 'Organization name must be 200 characters or fewer.';
  }

  if (state.primaryColorHex.length > 0 && !HEX_COLOR_PATTERN.test(state.primaryColorHex)) {
    fieldErrors.primaryColorHex = 'Primary colour must be a #RRGGBB hex value.';
  }

  const canSubmit = Object.keys(fieldErrors).length === 0;
  return { canSubmit, fieldErrors };
}

export interface BuildPayloadOk {
  readonly ok: true;
  readonly value: OrgConfigPatchInput;
}
export interface BuildPayloadErr {
  readonly ok: false;
  readonly fieldErrors: Readonly<Partial<Record<FieldKey | 'form', string>>>;
}
export type BuildPayloadResult = BuildPayloadOk | BuildPayloadErr;

/**
 * Convert the working state into the strict `OrgConfigPatchInput`
 * payload. Empty strings collapse to "field untouched" (omitted);
 * an explicit `null` `logoR2Key` clears the column.
 */
export function buildOrgConfigPatchPayload(state: OrgConfigFormState): OrgConfigPatchInput {
  const payload: OrgConfigPatchInput = {};
  if (state.name.length > 0) payload.name = state.name;
  if (state.primaryColorHex.length > 0) payload.primaryColorHex = state.primaryColorHex;
  if (state.logoR2Key !== null) payload.logoR2Key = state.logoR2Key;
  return payload;
}

export function tryBuildOrgConfigPatchPayload(state: OrgConfigFormState): BuildPayloadResult {
  const evaluation = evaluateOrgConfigFormState(state);
  if (!evaluation.canSubmit) {
    return { ok: false, fieldErrors: evaluation.fieldErrors };
  }
  const candidate = buildOrgConfigPatchPayload(state);
  const parsed = OrgConfigPatchSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: foldZodIssuesIntoFieldErrors(parsed.error.issues),
    };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Fold a Zod issues array into the per-field map the renderer reads.
 * Unknown paths fall onto the `form` slot.
 */
function foldZodIssuesIntoFieldErrors(
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>,
): Readonly<Partial<Record<FieldKey | 'form', string>>> {
  const out: Partial<Record<FieldKey | 'form', string>> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '');
    if (key === 'name' || key === 'primaryColorHex') {
      out[key] = issue.message;
    } else {
      out.form = issue.message;
    }
  }
  return out;
}

/**
 * Fold the canonical server error envelope back into field errors.
 * The API surfaces a single `VALIDATION_ERROR` with `message` of the
 * form `"<path>: <reason>"` — strip the leading path so the renderer
 * can route the message to the matching field slot.
 */
export function foldServerErrorIntoFieldMap(error: {
  readonly code?: string;
  readonly message?: string;
}): Readonly<Partial<Record<FieldKey | 'form', string>>> {
  const message = typeof error.message === 'string' ? error.message : '';
  if (error.code === 'VALIDATION_ERROR' && message.includes(': ')) {
    const colon = message.indexOf(': ');
    const path = message.slice(0, colon);
    const detail = message.slice(colon + 2);
    if (path === 'name' || path === 'primaryColorHex') {
      return { [path]: detail };
    }
  }
  return { form: message.length > 0 ? message : 'Could not save changes.' };
}
