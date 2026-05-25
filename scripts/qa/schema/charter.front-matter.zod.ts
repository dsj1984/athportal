// scripts/qa/schema/charter.front-matter.zod.ts
//
// Zod schema for Exploratory Charter front-matter. Consumed by
// `scripts/qa/lint.mjs` (the charter-branch of the QA-corpus linter) and
// by the unit tests under `__tests__/`.
//
// Citation: Tech Spec #782 § Front-matter contracts → "Exploratory Charter"
//           and § Security & Privacy Considerations §1-§4 (the
//           safety-constraints contract is the load-bearing gate that
//           keeps agent-driven charter runs from drifting into prod or
//           mutating undeclared state).
//
// The schema is the **single point of enforcement** for the structural
// shape of charter front-matter. Two layered policies (`mobile` domain
// reserved; `safety_constraints.environment` denylists `prod` at the
// schema layer so a prod-targeted charter cannot land on `main`) are
// applied via the same superRefine pattern used by `plan.front-matter.zod.ts`.

import { z } from 'zod';
import { DOMAINS, reservedDomainMessage } from './domains.ts';
import { PERSONAS } from './personas.ts';

/**
 * Environments a charter may target. `prod` is intentionally absent —
 * Tech Spec #782 § Security & Privacy §2 specifies that `environment:
 * prod` is denylisted at the lint (schema) layer so a charter targeted
 * at production cannot land on `main`. The runner gate against
 * `environment !== 'local'` is a second line of defense.
 */
export const CHARTER_ENVIRONMENTS = ['local', 'preview', 'staging'] as const;
export type CharterEnvironment = (typeof CHARTER_ENVIRONMENTS)[number];

/**
 * Charter-id shape: kebab-case slug prefixed with `ec-` so the id is
 * self-describing at the grep level. Example:
 * `ec-org-admin-csv-import`.
 */
const charterIdRegex = /^ec-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Route prefix: starts with `/`, contains only URL-safe characters.
 * Identical to the plan schema's regex; duplicated rather than imported
 * so the two schemas can drift independently if the route shape changes
 * for one but not the other.
 */
const routePrefixRegex = /^\/[A-Za-z0-9\-_/:]*$/;

/**
 * Heuristic-name shape: kebab-case slug. The lint script resolves each
 * name to `tests/charters/_heuristics/<name>.md`; this regex prevents
 * path-injection (no slashes, no dots) and keeps names grep-friendly.
 */
const heuristicNameRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The safety-constraints contract. Tech Spec #782 § Security & Privacy
 * §1 makes this block mandatory: a charter that omits any of the three
 * required fields cannot land on `main`. The lint script surfaces the
 * Zod error path verbatim so the operator sees which field is missing.
 */
const safetyConstraintsSchema = z
  .object({
    environment: z.enum(CHARTER_ENVIRONMENTS, {
      errorMap: (issue, ctx) => {
        if (issue.code === 'invalid_enum_value') {
          // Special-case the `prod` rejection — Tech Spec §2 calls out
          // that this message must read clearly so the operator
          // understands the denylist, not a typo, is the cause.
          if (ctx.data === 'prod') {
            return {
              message:
                'safety_constraints.environment must not be "prod" — charters that target production are denylisted at the lint layer',
            };
          }
          return {
            message: `safety_constraints.environment must be one of: ${CHARTER_ENVIRONMENTS.join(
              ', ',
            )} (received "${ctx.data}")`,
          };
        }
        return { message: ctx.defaultError };
      },
    }),
    mutation_surface: z
      .array(z.string().min(1, 'mutation_surface entries must not be empty'))
      .min(1, 'safety_constraints.mutation_surface must list at least one entry'),
    required_reset: z
      .string({
        required_error: 'safety_constraints.required_reset is required',
      })
      .min(1, 'safety_constraints.required_reset must not be empty'),
  })
  .strict();

const charterFrontMatterBaseSchema = z
  .object({
    id: z
      .string({ required_error: 'id is required' })
      .regex(charterIdRegex, 'id must be kebab-case and start with "ec-"'),
    type: z.literal('charter', {
      errorMap: () => ({ message: 'type must equal the literal "charter"' }),
    }),
    title: z.string({ required_error: 'title is required' }).min(1, 'title must not be empty'),
    domain: z.enum(DOMAINS, {
      errorMap: (issue, ctx) => {
        if (issue.code === 'invalid_enum_value') {
          return {
            message: `domain must be one of: ${DOMAINS.join(', ')} (received "${ctx.data}")`,
          };
        }
        return { message: ctx.defaultError };
      },
    }),
    persona: z.enum(PERSONAS, {
      errorMap: (issue, ctx) => {
        if (issue.code === 'invalid_enum_value') {
          return {
            message: `persona must be one of: ${PERSONAS.join(', ')} (received "${ctx.data}")`,
          };
        }
        return { message: ctx.defaultError };
      },
    }),
    route_prefixes: z
      .array(
        z
          .string()
          .regex(
            routePrefixRegex,
            'route_prefix must start with "/" and contain only URL-safe characters',
          ),
      )
      .min(1, 'route_prefixes must list at least one entry'),
    mission: z
      .string({ required_error: 'mission is required' })
      .min(1, 'mission must not be empty'),
    heuristics: z
      .array(
        z
          .string()
          .regex(heuristicNameRegex, 'heuristic name must be kebab-case (e.g. "boundary-values")'),
      )
      .min(1, 'heuristics must list at least one entry'),
    time_box_minutes: z
      .number({
        required_error: 'time_box_minutes is required',
        invalid_type_error: 'time_box_minutes must be an integer',
      })
      .int('time_box_minutes must be an integer')
      .positive('time_box_minutes must be positive'),
    safety_constraints: safetyConstraintsSchema,
    prerequisites: z.array(z.string().min(1)).optional(),
  })
  .strict();

/**
 * Charter front-matter schema after structural validation. The reserved-
 * domain refinement runs on top via `parseCharterFrontMatter` so callers
 * get one consolidated `ZodError`.
 */
export const charterFrontMatterSchema = charterFrontMatterBaseSchema.superRefine(
  (value, ctx) => {
    const domainReservation = reservedDomainMessage(value.domain);
    if (domainReservation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['domain'],
        message: `domain "${value.domain}" is ${domainReservation}`,
      });
    }
  },
);

export type SafetyConstraints = z.infer<typeof safetyConstraintsSchema>;
export type CharterFrontMatter = z.infer<typeof charterFrontMatterSchema>;

/**
 * Parse and validate charter front-matter. Returns the typed object on
 * accept; throws `ZodError` on reject. The thrown error's
 * `issues[].path` array names the offending field (e.g.
 * `['safety_constraints', 'environment']`) so the lint script can
 * render `<file>: safety_constraints.environment: <message>`.
 *
 * @throws {z.ZodError} on invalid input
 */
export function parseCharterFrontMatter(raw: unknown): CharterFrontMatter {
  return charterFrontMatterSchema.parse(raw);
}

/**
 * Non-throwing variant — useful when the lint script wants to aggregate
 * every error in a file before exiting.
 */
export function safeParseCharterFrontMatter(
  raw: unknown,
): { success: true; data: CharterFrontMatter } | { success: false; error: z.ZodError } {
  const result = charterFrontMatterSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error };
}
