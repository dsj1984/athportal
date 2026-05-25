// scripts/qa/schema/plan.front-matter.zod.ts
//
// Zod schema for Test Plan front-matter. Consumed by
// `scripts/qa/lint.mjs` (the plan-branch of the QA-corpus linter) and by
// the unit tests under `__tests__/`.
//
// Citation: Tech Spec #782 § Front-matter contracts → "Test Plan".
//
// The schema is the **single point of enforcement** for the structural
// shape of plan front-matter. The two layered policies (`mobile` domain
// reserved, `mobile` surface reserved) are applied on top of a
// successful structural parse via `parsePlanFrontMatter` — that
// function returns the typed object on accept and throws a `ZodError`
// (whose `issues[].path` names the offending field) on reject.
//
// Why a custom refinement instead of `z.enum(DOMAINS.filter(...))`?
// Future Epics that ship a new MVP surface must be able to land their
// `domain: <new>` plans in the **same PR** that ships the routes —
// without modifying this schema. The enum stays open; the *currently
// reserved* entries (`mobile`) are gated by the refinement so the lint
// message can read "reserved until mobile Epic lands" verbatim.

import { z } from 'zod';
import { DOMAINS, reservedDomainMessage } from './domains.ts';
import { PERSONAS } from './personas.ts';

/** Surfaces the corpus knows about. `mobile` is reserved (see refinement). */
export const SURFACES = ['web', 'mobile'] as const;
export type Surface = (typeof SURFACES)[number];

/**
 * Plan-id shape: kebab-case slug prefixed with `tp-` so the id is
 * self-describing at the grep level. Example:
 * `tp-identity-signup-happy-path`.
 */
const planIdRegex = /^tp-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Route prefix: starts with `/`, contains only URL-safe characters.
 * Empty strings, missing leading slash, and whitespace are rejected at
 * the schema layer so the lint script can rely on the typed value.
 */
const routePrefixRegex = /^\/[A-Za-z0-9\-_/:]*$/;

const planFrontMatterBaseSchema = z
  .object({
    id: z
      .string({ required_error: 'id is required' })
      .regex(planIdRegex, 'id must be kebab-case and start with "tp-"'),
    type: z.literal('plan', {
      errorMap: () => ({ message: 'type must equal the literal "plan"' }),
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
    surface: z.enum(SURFACES, {
      errorMap: (issue, ctx) => {
        if (issue.code === 'invalid_enum_value') {
          return {
            message: `surface must be one of: ${SURFACES.join(', ')} (received "${ctx.data}")`,
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
    est_minutes: z
      .number({
        required_error: 'est_minutes is required',
        invalid_type_error: 'est_minutes must be an integer',
      })
      .int('est_minutes must be an integer')
      .positive('est_minutes must be positive'),
    prerequisites: z.array(z.string().min(1)).optional(),
  })
  .strict();

/**
 * Plan front-matter schema after structural validation. The reserved-
 * domain / reserved-surface refinements run on top via
 * `parsePlanFrontMatter` so callers get one consolidated `ZodError`.
 */
export const planFrontMatterSchema = planFrontMatterBaseSchema.superRefine((value, ctx) => {
  const domainReservation = reservedDomainMessage(value.domain);
  if (domainReservation) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['domain'],
      message: `domain "${value.domain}" is ${domainReservation}`,
    });
  }
  if (value.surface === 'mobile') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['surface'],
      message: 'surface "mobile" is reserved until mobile Epic lands',
    });
  }
});

export type PlanFrontMatter = z.infer<typeof planFrontMatterSchema>;

/**
 * Parse and validate plan front-matter. Returns the typed object on
 * accept; throws `ZodError` on reject. The thrown error's
 * `issues[].path` array names the offending field (e.g. `['persona']`)
 * so the lint script can render `<file>: persona: <message>`.
 *
 * @throws {z.ZodError} on invalid input
 */
export function parsePlanFrontMatter(raw: unknown): PlanFrontMatter {
  return planFrontMatterSchema.parse(raw);
}

/**
 * Non-throwing variant — useful when the lint script wants to aggregate
 * every error in a file before exiting.
 */
export function safeParsePlanFrontMatter(
  raw: unknown,
): { success: true; data: PlanFrontMatter } | { success: false; error: z.ZodError } {
  const result = planFrontMatterSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error };
}
