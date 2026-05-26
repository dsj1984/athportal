// apps/api/src/mailer/rosterInvite.test.ts
//
// Unit tests for the roster-invite mailer seam (Epic #11 / Story
// #920 / Task #927).
//
// Pins:
//
//   - `hashToken` returns a hex-encoded SHA-256 of the plaintext.
//   - `buildAcceptUrl` / `buildDeclineUrl` URL-encode the token and
//     respect a custom base URL (with or without trailing slash).
//   - `sendRosterInviteEmail` composes exactly one accept URL and one
//     decline URL, both keyed by the plaintext token.
//   - The plaintext token NEVER appears in the structured log event
//     produced by `buildLogEvent`, and never appears anywhere outside
//     the message body and the URL pair.
//   - `buildLogEvent` exposes only inviteId, teamId, and emailDomain —
//     never the full email or first/last name (PII).

import { describe, expect, it, vi } from 'vitest';
import {
  type RosterInviteEmailMessage,
  type RosterInviteForMail,
  type RosterInviteMailTransport,
  buildAcceptUrl,
  buildDeclineUrl,
  buildLogEvent,
  hashToken,
  sendRosterInviteEmail,
} from './rosterInvite';

const PLAINTEXT_TOKEN = 'a'.repeat(64); // 32 random bytes hex-encoded → 64 chars

function invite(overrides: Partial<RosterInviteForMail> = {}): RosterInviteForMail {
  return {
    id: 'inv_test',
    teamId: 't_test',
    email: 'ada.lovelace@example.test',
    firstName: 'Ada',
    lastName: 'Lovelace',
    expiresAt: new Date('2026-02-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('hashToken', () => {
  it('returns a 64-character lowercase hex string', () => {
    const hash = hashToken(PLAINTEXT_TOKEN);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — identical input yields identical hash', () => {
    expect(hashToken(PLAINTEXT_TOKEN)).toBe(hashToken(PLAINTEXT_TOKEN));
  });

  it('differs for different inputs (no trivial collisions)', () => {
    expect(hashToken('one')).not.toBe(hashToken('two'));
  });

  it('rejects an empty plaintext', () => {
    expect(() => hashToken('')).toThrow(/non-empty string/);
  });
});

describe('buildAcceptUrl / buildDeclineUrl', () => {
  it('builds the canonical accept URL', () => {
    expect(buildAcceptUrl('https://app.example.test', 'abc123')).toBe(
      'https://app.example.test/r/roster-invite/abc123/accept',
    );
  });

  it('builds the canonical decline URL', () => {
    expect(buildDeclineUrl('https://app.example.test', 'abc123')).toBe(
      'https://app.example.test/r/roster-invite/abc123/decline',
    );
  });

  it('strips a trailing slash on the base URL', () => {
    expect(buildAcceptUrl('https://app.example.test/', 'abc123')).toBe(
      'https://app.example.test/r/roster-invite/abc123/accept',
    );
  });

  it('URL-encodes special characters in the token', () => {
    // A real token is 64 hex chars and never contains special
    // characters — but the helper MUST refuse to silently corrupt a
    // value that does, so a future token format change does not
    // produce a malformed URL.
    expect(buildAcceptUrl('https://app.example.test', 'a b/c')).toBe(
      'https://app.example.test/r/roster-invite/a%20b%2Fc/accept',
    );
  });
});

describe('sendRosterInviteEmail', () => {
  function makeTransport(): RosterInviteMailTransport & {
    sent: RosterInviteEmailMessage[];
  } {
    const sent: RosterInviteEmailMessage[] = [];
    return {
      sent,
      send(msg) {
        sent.push(msg);
        return Promise.resolve();
      },
    };
  }

  it('hands the transport a message addressed to the invite email', async () => {
    const transport = makeTransport();
    await sendRosterInviteEmail(invite(), PLAINTEXT_TOKEN, {
      transport,
      baseUrl: 'https://app.example.test',
    });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.to).toBe('ada.lovelace@example.test');
  });

  it('embeds exactly one accept URL and one decline URL in the body', async () => {
    const transport = makeTransport();
    await sendRosterInviteEmail(invite(), PLAINTEXT_TOKEN, {
      transport,
      baseUrl: 'https://app.example.test',
    });
    const msg = transport.sent[0];
    expect(msg).toBeDefined();
    if (!msg) return;
    const acceptUrl = buildAcceptUrl('https://app.example.test', PLAINTEXT_TOKEN);
    const declineUrl = buildDeclineUrl('https://app.example.test', PLAINTEXT_TOKEN);

    // Text body — exactly one occurrence of each URL.
    expect(occurrences(msg.text, acceptUrl)).toBe(1);
    expect(occurrences(msg.text, declineUrl)).toBe(1);
    // HTML body — exactly one occurrence of each URL.
    expect(occurrences(msg.html, acceptUrl)).toBe(1);
    expect(occurrences(msg.html, declineUrl)).toBe(1);
  });

  it('both URLs are keyed by the supplied plaintext token', async () => {
    const transport = makeTransport();
    await sendRosterInviteEmail(invite(), PLAINTEXT_TOKEN, {
      transport,
      baseUrl: 'https://app.example.test',
    });
    const msg = transport.sent[0];
    expect(msg?.text).toContain(`/r/roster-invite/${PLAINTEXT_TOKEN}/accept`);
    expect(msg?.text).toContain(`/r/roster-invite/${PLAINTEXT_TOKEN}/decline`);
  });

  it('uses a neutral greeting when firstName is absent', async () => {
    const transport = makeTransport();
    await sendRosterInviteEmail(invite({ firstName: null }), PLAINTEXT_TOKEN, {
      transport,
      baseUrl: 'https://app.example.test',
    });
    expect(transport.sent[0]?.text).toContain('Hi there,');
    expect(transport.sent[0]?.text).not.toContain('Hi ada.lovelace');
  });

  it('rejects an empty plaintext token', async () => {
    const transport = makeTransport();
    await expect(
      sendRosterInviteEmail(invite(), '', {
        transport,
        baseUrl: 'https://app.example.test',
      }),
    ).rejects.toThrow(/non-empty string/);
  });

  it('rejects a missing baseUrl', async () => {
    const transport = makeTransport();
    await expect(
      sendRosterInviteEmail(invite(), PLAINTEXT_TOKEN, {
        transport,
        baseUrl: '',
      }),
    ).rejects.toThrow(/baseUrl/);
  });

  it('does not emit the plaintext token via console (defensive)', async () => {
    // Spy on every console surface to make sure the seam never logs
    // the plaintext token to stdout/stderr — security-baseline.md
    // §Data Leakage & Logging forbids logging token material.
    const surfaces = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = surfaces.map((k) => vi.spyOn(console, k).mockImplementation(() => undefined));
    try {
      const transport = makeTransport();
      await sendRosterInviteEmail(invite(), PLAINTEXT_TOKEN, {
        transport,
        baseUrl: 'https://app.example.test',
      });
      for (const spy of spies) {
        for (const call of spy.mock.calls) {
          const serialized = call.map((a) => (typeof a === 'string' ? a : JSON.stringify(a)));
          for (const s of serialized) {
            expect(s).not.toContain(PLAINTEXT_TOKEN);
          }
        }
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('buildLogEvent', () => {
  it('exposes the invite id, team id, and the email domain', () => {
    const event = buildLogEvent(invite({ email: 'ada@example.test' }));
    expect(event).toEqual({
      kind: 'roster-invite-sent',
      inviteId: 'inv_test',
      teamId: 't_test',
      emailDomain: 'example.test',
    });
  });

  it('does NOT carry the plaintext token, full email, or names', () => {
    const event = buildLogEvent(invite({ email: 'ada.lovelace@example.test' }));
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('ada.lovelace');
    expect(serialized).not.toContain('Lovelace');
    expect(serialized).not.toContain('Ada');
  });

  it('uses "unknown" as the domain when the email lacks an @', () => {
    const event = buildLogEvent(invite({ email: 'malformed' }));
    expect(event.emailDomain).toBe('unknown');
  });
});

function occurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const found = haystack.indexOf(needle, idx);
    if (found === -1) break;
    count += 1;
    idx = found + needle.length;
  }
  return count;
}
