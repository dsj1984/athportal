// apps/api/src/lib/r2.ts
//
// R2 logo-upload helpers (Epic #10 / Story #656 / Task #675).
//
// Two boundaries:
//
//   1. Edge validation — `validateLogoUpload({ contentType, contentLength })`
//      enforces the allowed mime types and the 2 MB size cap before any
//      object key is minted or any external call is made. Failures are
//      represented as a tagged union so the calling route can map each
//      reason onto its own canonical error envelope.
//
//   2. Key minting — `buildLogoKey(orgId)` deterministically prefixes
//      the per-org key namespace so cross-tenant overwrites are
//      impossible by construction (an org cannot mint a key that
//      collides with another org's namespace).
//
// The actual presigned-URL signer is carried as an injectable
// `LogoUploadSigner` interface so:
//   - contract tests can inject a stub that records the request and
//     returns a deterministic URL, and
//   - the production wiring (S3-compatible R2 + AWS-SigV4) can land in
//     a follow-up without re-shaping any consumer.
//
// Per `.agents/rules/security-baseline.md`:
//   - File uploads MUST validate type and size before persisting or
//     processing — both checks live here at the edge.
//   - No secrets are read or logged in this file; the signer carries
//     its own credentials through whatever the production wiring
//     supplies.

import { randomUUID } from 'node:crypto';

/**
 * Allowed image mime types for the org logo. Kept narrow on purpose —
 * widening the set requires a security review (the CDN serves these
 * directly and an unsafe mime would expand the XSS surface).
 */
export const ALLOWED_LOGO_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;
export type AllowedLogoContentType = (typeof ALLOWED_LOGO_CONTENT_TYPES)[number];

/**
 * Maximum logo upload size (2 MB). Mirrored in the form-island input
 * accept attribute so the browser surfaces a friendly error before the
 * upload starts, but the server-side check is the authoritative gate.
 */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * Discriminated outcome of `validateLogoUpload`. Callers switch on
 * `ok` and, when `false`, on `reason` to map to the canonical error
 * envelope (`UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`).
 */
export type ValidationResult =
  | { ok: true; contentType: AllowedLogoContentType }
  | { ok: false; reason: 'UNSUPPORTED_MEDIA_TYPE' | 'PAYLOAD_TOO_LARGE' };

export interface LogoUploadInput {
  readonly contentType: string;
  readonly contentLength: number;
}

function isAllowedContentType(value: string): value is AllowedLogoContentType {
  return (ALLOWED_LOGO_CONTENT_TYPES as readonly string[]).includes(value);
}

export function validateLogoUpload(input: LogoUploadInput): ValidationResult {
  if (!isAllowedContentType(input.contentType)) {
    return { ok: false, reason: 'UNSUPPORTED_MEDIA_TYPE' };
  }
  if (!Number.isFinite(input.contentLength) || input.contentLength <= 0) {
    // A non-finite or zero length is itself a violation of the size
    // policy — surface it as PAYLOAD_TOO_LARGE rather than inventing a
    // separate error code; either way the caller cannot proceed.
    return { ok: false, reason: 'PAYLOAD_TOO_LARGE' };
  }
  if (input.contentLength > MAX_LOGO_BYTES) {
    return { ok: false, reason: 'PAYLOAD_TOO_LARGE' };
  }
  return { ok: true, contentType: input.contentType };
}

/**
 * Map an allowed content-type to its filename extension. Kept tiny and
 * total so the key has a stable, human-recognisable suffix.
 */
function extensionFor(contentType: AllowedLogoContentType): 'png' | 'jpg' | 'webp' {
  switch (contentType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
  }
}

/**
 * Deterministically scope a freshly-minted object key under the org's
 * private namespace. Cross-tenant key collisions are impossible by
 * construction — an org id is mixed into the prefix.
 */
export function buildLogoKey(orgId: string, contentType: AllowedLogoContentType): string {
  const ext = extensionFor(contentType);
  return `logos/${orgId}/${randomUUID()}.${ext}`;
}

/**
 * Structural shape any presigned-URL signer this app accepts MUST
 * implement. `createPresignedPutUrl` is the single method the upload
 * route invokes — narrow on purpose so tests can inject a stub and
 * the production binding can ship without re-shaping any consumer.
 */
export interface LogoUploadSigner {
  createPresignedPutUrl(input: {
    readonly key: string;
    readonly contentType: AllowedLogoContentType;
    readonly contentLength: number;
    /** Seconds. Caller picks the lifetime; signer enforces an upper bound. */
    readonly expiresInSeconds: number;
  }): Promise<{ readonly uploadUrl: string }>;
}

/**
 * One-shot helper: validate the input, mint a key, ask the signer for
 * a presigned PUT URL, return both. The route layer wraps this in the
 * canonical success/error envelope.
 */
export async function mintLogoUploadUrl(args: {
  readonly orgId: string;
  readonly input: LogoUploadInput;
  readonly signer: LogoUploadSigner;
  readonly expiresInSeconds?: number;
}): Promise<
  | { ok: true; key: string; uploadUrl: string }
  | { ok: false; reason: 'UNSUPPORTED_MEDIA_TYPE' | 'PAYLOAD_TOO_LARGE' }
> {
  const validation = validateLogoUpload(args.input);
  if (!validation.ok) return validation;
  const key = buildLogoKey(args.orgId, validation.contentType);
  const { uploadUrl } = await args.signer.createPresignedPutUrl({
    key,
    contentType: validation.contentType,
    contentLength: args.input.contentLength,
    expiresInSeconds: args.expiresInSeconds ?? 300,
  });
  return { ok: true, key, uploadUrl };
}
