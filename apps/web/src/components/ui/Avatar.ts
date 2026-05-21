// apps/web/src/components/ui/Avatar.ts
//
// Pure-TS view-shape builder for the Avatar primitive. Renders an
// uploaded photo when `src` is provided, otherwise renders the user's
// uppercase initials. Used post-onboarding on the dashboard header
// (when no profile photo was uploaded) and on the form's photo
// preview pane.
//
// Story #574 / Task #585. Tech Spec #490. PRD #489.

/** Canonical data-testid exposed by the dashboard's avatar surface. */
export const DASHBOARD_AVATAR_TEST_ID = 'dashboard-avatar';

/** Public props for the Avatar primitive. */
export interface AvatarProps {
  /** The user's display name. Used to derive the initials fallback. */
  readonly name: string;
  /** Optional URL of the user's uploaded profile photo. */
  readonly src?: string | null;
  /** Optional data-testid override (defaults to the canonical id). */
  readonly testId?: string;
}

/** Render-time view shape consumed by the `.astro` sibling. */
export interface AvatarView {
  /** When non-null, the `.astro` renders an `<img>` with this src. */
  readonly src: string | null;
  /** Always populated — used as the `<img>`'s alt text AND the initials-branch text content. */
  readonly name: string;
  /** Uppercase initials for the no-photo branch. Never empty when name is valid. */
  readonly initials: string;
  /** data-testid for the rendered root. */
  readonly testId: string;
}

/**
 * Project an Avatar's props into the render-ready view. Always
 * computes the initials so the `.astro` sibling can fall back to them
 * if the `<img>` fails to load. Throws `TypeError` when `name` is
 * empty or whitespace-only — every authenticated surface has a
 * display name by construction, so an empty name is an authoring bug.
 */
export function buildAvatarView(props: AvatarProps): AvatarView {
  const name = props.name.trim();
  if (name.length === 0) {
    throw new TypeError('Avatar: `name` must be a non-empty string.');
  }
  const initials = computeInitials(name);
  const trimmedSrc = props.src?.trim();
  const src = typeof trimmedSrc === 'string' && trimmedSrc.length > 0 ? trimmedSrc : null;
  const testId = props.testId?.trim() || DASHBOARD_AVATAR_TEST_ID;
  return { src, name, initials, testId };
}

/**
 * Derive uppercase initials from a display name. Takes the first
 * grapheme of the first and last whitespace-separated tokens. Single-
 * token names yield a single character; tokens with non-Latin
 * leading characters (e.g. emoji) yield the codepoint itself.
 *
 * Examples:
 *   "Ada Lovelace"        → "AL"
 *   "ada"                  → "A"
 *   "  Ada    Lovelace  "  → "AL"
 *   "Ada Augusta Lovelace" → "AL"  (first + last; middle ignored)
 */
export function computeInitials(name: string): string {
  const tokens = name
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return '';
  const firstToken = tokens[0] ?? '';
  const lastToken = tokens[tokens.length - 1] ?? '';
  if (tokens.length === 1) return firstChar(firstToken).toUpperCase();
  return (firstChar(firstToken) + firstChar(lastToken)).toUpperCase();
}

function firstChar(token: string): string {
  // Use Array.from to respect surrogate-pair characters so "🦄ame"
  // returns "🦄" rather than the leading half-codepoint.
  return Array.from(token)[0] ?? '';
}
