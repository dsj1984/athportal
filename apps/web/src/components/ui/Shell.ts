// apps/web/src/components/ui/Shell.ts
//
// Pure-TS surface for the signed-in Shell composite. Shell owns the
// 232px sidebar + 1fr content grid pinned by Tech Spec #704; this
// module exposes the constants (sidebar width, root data-testid) so
// the unit tier can pin them in lockstep with the renderer.
//
// Story #712 / Task #729.

import type { SidebarPersona } from './_lib/sidebarNav';

export const SHELL_TEST_ID = 'shell';
export const SHELL_CONTENT_TEST_ID = 'shell-content';

/**
 * Sidebar column width. Surfaced as a numeric constant so the unit
 * tier (and any future layout test) reads it from the source of
 * truth rather than re-hardcoding the value.
 */
export const SHELL_SIDEBAR_WIDTH_PX = 232;

/** Public props for the Shell composite primitive. */
export interface ShellProps {
  /** Which persona's sidebar nav to render. */
  readonly persona: SidebarPersona;
  /** Optional href of the active route — forwarded to Sidebar. */
  readonly active?: string;
}

/** Pre-composed grid-template-columns value for the Shell layout. */
export function shellGridTemplateColumns(): string {
  return `${SHELL_SIDEBAR_WIDTH_PX}px 1fr`;
}
