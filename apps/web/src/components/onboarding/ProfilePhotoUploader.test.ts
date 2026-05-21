// apps/web/src/components/onboarding/ProfilePhotoUploader.test.ts
//
// Unit tests for the ProfilePhotoUploader's pure-TS view-shape builder
// and the file-validation gate. The `.astro` sibling drives the upload
// against `POST /api/v1/uploads`; the validation gate is the testable
// surface here.
//
// Story #574 / Task #585.
import { describe, expect, it } from 'vitest';
import {
  PROFILE_PHOTO_ALLOWED_MIME,
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_TEST_IDS,
  buildProfilePhotoView,
  validateProfilePhotoFile,
} from './ProfilePhotoUploader';

describe('buildProfilePhotoView', () => {
  it('exposes the canonical onboarding-photo-upload testId', () => {
    const view = buildProfilePhotoView();
    expect(view.testIds.upload).toBe('onboarding-photo-upload');
    expect(view.testIds).toBe(PROFILE_PHOTO_TEST_IDS);
  });

  it('renders non-empty heading, helper, upload, and remove copy', () => {
    const view = buildProfilePhotoView();
    expect(view.heading.length).toBeGreaterThan(0);
    expect(view.helperText.length).toBeGreaterThan(0);
    expect(view.uploadLabel.length).toBeGreaterThan(0);
    expect(view.removeLabel.length).toBeGreaterThan(0);
  });

  it('communicates "optional" in the heading copy so users know they can skip', () => {
    const view = buildProfilePhotoView();
    expect(view.heading.toLowerCase()).toContain('optional');
  });
});

describe('validateProfilePhotoFile', () => {
  it('returns null for an allowed JPEG within the size cap', () => {
    expect(validateProfilePhotoFile({ mimeType: 'image/jpeg', sizeBytes: 1024 * 1024 })).toBeNull();
  });

  it('returns null for an allowed PNG within the size cap', () => {
    expect(validateProfilePhotoFile({ mimeType: 'image/png', sizeBytes: 256 * 1024 })).toBeNull();
  });

  it('returns null for an allowed WebP within the size cap', () => {
    expect(validateProfilePhotoFile({ mimeType: 'image/webp', sizeBytes: 512 * 1024 })).toBeNull();
  });

  it('rejects MIME types outside the allowed list', () => {
    const message = validateProfilePhotoFile({
      mimeType: 'image/gif',
      sizeBytes: 1024,
    });
    expect(message).not.toBeNull();
    expect(message).toContain('JPEG');
  });

  it('rejects files larger than the configured cap', () => {
    const message = validateProfilePhotoFile({
      mimeType: 'image/jpeg',
      sizeBytes: PROFILE_PHOTO_MAX_BYTES + 1,
    });
    expect(message).not.toBeNull();
  });

  it('rejects empty files', () => {
    const message = validateProfilePhotoFile({ mimeType: 'image/jpeg', sizeBytes: 0 });
    expect(message).not.toBeNull();
  });

  it('treats MIME types case-insensitively', () => {
    expect(validateProfilePhotoFile({ mimeType: 'IMAGE/JPEG', sizeBytes: 1024 })).toBeNull();
  });

  it('exposes the allowed MIME list as a frozen tuple', () => {
    expect(PROFILE_PHOTO_ALLOWED_MIME).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });
});
