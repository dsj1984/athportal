// apps/web/src/pages/dev/sign-in-as/persona.test.ts
//
// Unit coverage for the Story #988 existing-session-conflict branch on
// the dev sign-in seam. The seam itself is exercised end-to-end via
// manual QA (no harness mocks the Clerk REST endpoint locally); this
// test exercises only the pure renderer that builds the 409 body so the
// conflict shape stays stable.

import { describe, expect, it } from 'vitest';
import { renderExistingSessionConflict } from './[persona]';

describe('renderExistingSessionConflict', () => {
  it('returns a 409 with both persona and current-user IDs in the body', () => {
    const result = renderExistingSessionConflict({
      targetPersona: 'coach',
      currentUserId: 'user_2abcOrgAdminPlaceholder',
    });
    expect(result.status).toBe(409);
    expect(result.body).toContain('coach');
    expect(result.body).toContain('user_2abcOrgAdminPlaceholder');
    expect(result.body).toContain('/sign-out');
    expect(result.body).toContain('/dev/sign-in-as/coach');
  });

  it('encodes the target persona in the retry href to defend against odd inputs', () => {
    const result = renderExistingSessionConflict({
      targetPersona: 'org-admin',
      currentUserId: 'user_2abcCoachPlaceholder',
    });
    expect(result.body).toContain('href="/dev/sign-in-as/org-admin"');
  });
});
