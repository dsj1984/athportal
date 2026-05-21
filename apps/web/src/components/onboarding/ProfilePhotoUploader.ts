// apps/web/src/components/onboarding/ProfilePhotoUploader.ts
//
// Pure-TS view-shape + upload-result handling for the
// ProfilePhotoUploader island. The upload itself runs through Tech
// Spec #490's `POST /api/v1/uploads` (which returns a `profilePhotoUploadId`
// the API edge later references when stamping `users.profilePhotoId`).
//
// At MVP the uploader is genuinely optional — `OnboardInputSchema`
// makes `profilePhotoUploadId` `.optional()`. Submitting null/skip
// is a first-class branch and must not block the submit-enabled gate.
//
// Story #574 / Task #585. Tech Spec #490.

/** Canonical data-testid for the photo-uploader island. */
export const PROFILE_PHOTO_TEST_IDS = {
  root: 'onboarding-photo-island',
  upload: 'onboarding-photo-upload',
  preview: 'onboarding-photo-preview',
  remove: 'onboarding-photo-remove',
} as const;

/** Render-time view shape consumed by the `.astro` sibling. */
export interface ProfilePhotoView {
  readonly heading: string;
  readonly helperText: string;
  readonly uploadLabel: string;
  readonly removeLabel: string;
  readonly testIds: typeof PROFILE_PHOTO_TEST_IDS;
}

/** The maximum upload size we accept. Tech Spec #490 §Uploads pins this at 5MB. */
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** The allowed MIME types. Tech Spec #490 §Uploads pins this list. */
export const PROFILE_PHOTO_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ProfilePhotoAllowedMime = (typeof PROFILE_PHOTO_ALLOWED_MIME)[number];

/** Build the static view. */
export function buildProfilePhotoView(): ProfilePhotoView {
  return {
    heading: 'Profile photo (optional)',
    helperText:
      'Upload a profile photo or skip — you can always add one later from your dashboard.',
    uploadLabel: 'Choose a photo',
    removeLabel: 'Remove',
    testIds: PROFILE_PHOTO_TEST_IDS,
  };
}

/**
 * Validate a `File` against the allowed MIME types and size cap. Pure
 * so the inline `<script>` and the unit tier exercise the same gate.
 *
 * Returns `null` on success or a human message on failure.
 */
export function validateProfilePhotoFile(input: {
  readonly mimeType: string;
  readonly sizeBytes: number;
}): string | null {
  const mime = input.mimeType.toLowerCase();
  if (!PROFILE_PHOTO_ALLOWED_MIME.includes(mime as ProfilePhotoAllowedMime)) {
    return `Profile photos must be JPEG, PNG, or WebP. Got "${input.mimeType}".`;
  }
  if (input.sizeBytes > PROFILE_PHOTO_MAX_BYTES) {
    const maxMb = (PROFILE_PHOTO_MAX_BYTES / (1024 * 1024)).toFixed(0);
    return `Profile photos must be ${maxMb}MB or smaller.`;
  }
  if (input.sizeBytes <= 0) {
    return 'Profile photo file appears to be empty.';
  }
  return null;
}
