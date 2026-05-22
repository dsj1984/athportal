/**
 * @repo/shared/schemas/admin/org — Zod boundary schemas for the org
 * configuration endpoints (Epic #10 / Story #656 / Task #673).
 *
 * The shared schema is the load-bearing contract between the API handler
 * (`GET / PATCH /api/v1/admin/org`) and the admin org-config form on the
 * web (`apps/web/src/pages/admin/org.astro`). The form uses the same
 * input schema as the API edge so a client-side `react-hook-form`
 * resolver and the server's Zod validator never drift.
 *
 * Schemas are `.strict()` so unknown keys are a hard failure — a stale
 * client field name cannot silently slip through.
 *
 * Scope on this Story is intentionally narrow: only the columns that
 * exist on `organizations` today (name, primary colour, logo) are
 * persisted. Sports and contact metadata are surfaced in the output
 * shape as placeholders (`sports: []`, `contactEmail: null`,
 * `contactPhone: null`) so the web client can render the full form
 * skeleton without a follow-up wire-shape break when those columns
 * land.
 */

import { z } from 'zod';

/**
 * Hex colour validator. Matches `#RRGGBB` (case-insensitive). We
 * deliberately reject the three-digit shorthand (`#FFF`) and any value
 * carrying an alpha channel; the storage column is a plain 7-character
 * string and the brand surface is opaque by design.
 */
export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const hexColorSchema = z
  .string()
  .regex(HEX_COLOR_PATTERN, 'primaryColorHex must match /^#[0-9a-f]{6}$/i');

/**
 * `PATCH /api/v1/admin/org` request body. Every field is optional so
 * the client can submit a partial update (e.g. colour-only). Nullable
 * branding fields accept `null` so the caller can explicitly clear a
 * previously-set value.
 */
export const OrgConfigPatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    primaryColorHex: hexColorSchema.nullable().optional(),
    logoR2Key: z.string().min(1).max(512).nullable().optional(),
  })
  .strict();

export type OrgConfigPatchInput = z.infer<typeof OrgConfigPatchSchema>;

/**
 * Public-facing org-config shape returned by GET and PATCH. Internal
 * columns (`createdAt`, `updatedAt`, `organizationType`) are
 * intentionally absent — a follow-up Story can add them to the output
 * shape once a UI surface needs them.
 *
 * `logoUrl` is derived from `logoR2Key` by the handler (a CDN URL the
 * client can render directly) and is null when no logo is set.
 * `sports`, `contactEmail`, and `contactPhone` are placeholder fields
 * surfaced as empty defaults until the follow-up Story that adds the
 * matching columns.
 */
export const OrgConfigOutputSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    sports: z.array(z.string()),
    contactEmail: z.string().email().nullable(),
    contactPhone: z.string().nullable(),
    primaryColorHex: z.string().nullable(),
    logoUrl: z.string().url().nullable(),
  })
  .strict();

export type OrgConfigOutput = z.infer<typeof OrgConfigOutputSchema>;
