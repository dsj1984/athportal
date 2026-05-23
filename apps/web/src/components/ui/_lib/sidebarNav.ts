// apps/web/src/components/ui/_lib/sidebarNav.ts
//
// Persona → sidebar nav-set registry consumed by the Sidebar composite.
// Three personas — athlete, coach, org — each ship a fixed nav list per
// the Epic #702 design-system handoff. Icons reference the canonical
// `lucide-react` glyph by string name (the Astro renderer resolves the
// component dynamically); this keeps the pure-TS layer free of JSX so
// the unit tier can exercise the registry under node Vitest.
//
// Story #712 / Task #729. Tech Spec #704. Style guide §4.x.

/** The three persona shapes Sidebar supports today. */
export type SidebarPersona = 'athlete' | 'coach' | 'org';

/**
 * A single nav row. `icon` names a `lucide-react` export (e.g.
 * "Home", "Calendar"). The Astro renderer translates this to the
 * corresponding component — keeping the value a string means this
 * module stays JSX-free and importable in any environment.
 */
export interface SidebarNavItem {
  /** Sentence-case label rendered next to the icon. */
  readonly label: string;
  /** Destination href, e.g. "/calendar". */
  readonly href: string;
  /** Name of the lucide-react icon component to render. */
  readonly icon: string;
}

/**
 * The canonical persona → nav-list map. Frozen so accidental in-place
 * mutation by a consumer can't drift the canonical surface. Item
 * ordering is significant — it is the order Sidebar renders.
 */
export const SIDEBAR_NAV: Readonly<Record<SidebarPersona, readonly SidebarNavItem[]>> = {
  athlete: [
    { label: 'Home', href: '/', icon: 'Home' },
    { label: 'My profile', href: '/profile', icon: 'User' },
    { label: 'My teams', href: '/teams', icon: 'Users' },
    { label: 'Calendar', href: '/calendar', icon: 'Calendar' },
    { label: 'Team feed', href: '/feed', icon: 'MessageSquare' },
    { label: 'Stats & awards', href: '/stats', icon: 'Trophy' },
  ],
  coach: [
    { label: 'Home', href: '/', icon: 'Home' },
    { label: 'Roster', href: '/roster', icon: 'Users' },
    { label: 'Verify stats', href: '/verify-stats', icon: 'CheckSquare' },
    { label: 'Calendar', href: '/calendar', icon: 'Calendar' },
    { label: 'Team feed', href: '/feed', icon: 'MessageSquare' },
    { label: 'Announcements', href: '/announcements', icon: 'Megaphone' },
  ],
  org: [
    { label: 'Overview', href: '/', icon: 'LayoutDashboard' },
    { label: 'Teams', href: '/teams', icon: 'Users' },
    { label: 'Coaches', href: '/coaches', icon: 'UserCheck' },
    { label: 'Athletes', href: '/athletes', icon: 'GraduationCap' },
    { label: 'Events', href: '/events', icon: 'Calendar' },
    { label: 'Reports', href: '/reports', icon: 'BarChart3' },
  ],
};

/**
 * Resolve the nav list for a persona. Throws `TypeError` on an
 * unknown persona so an upstream typo fails loudly instead of
 * rendering an empty sidebar.
 */
export function resolveSidebarNav(persona: SidebarPersona): readonly SidebarNavItem[] {
  const items = SIDEBAR_NAV[persona];
  if (!items) {
    throw new TypeError(
      `Sidebar: unknown persona "${persona}". Expected one of: ${Object.keys(SIDEBAR_NAV).join(', ')}.`,
    );
  }
  return items;
}
