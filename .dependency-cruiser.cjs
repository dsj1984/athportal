/**
 * Dependency-cruiser configuration.
 *
 * Encodes the architecture invariants from `docs/architecture.md` §§ 1–2,
 * 3.4, and 5 plus `AGENTS.md` Safety Constraints. Each rule comment links
 * back to the doc section that motivates it.
 *
 * Policy: no ratchet, no baseline. A rule either holds or is explicitly
 * relaxed in the same PR. See `docs/patterns.md` §
 * "Dependency boundaries (dependency-cruiser)".
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // --- Structural integrity --------------------------------------------
    {
      name: 'no-circular',
      comment:
        'Circular dependencies cause tight coupling and unpredictable load order. ' +
        'See docs/architecture.md § 2 Workspace Mapping.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment:
        'Orphan modules are usually dead code. Knip covers the broader dead-export sweep; ' +
        'this rule catches imports-no-one-uses. Entry points (Astro middleware, Astro pages, ' +
        'Sentry init files, Worker env shape, RBAC types re-exported via @repo/shared) are ' +
        'load-bearing without inbound edges and are listed explicitly.',
      severity: 'error',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '\\.test\\.(ts|tsx)$',
          '\\.contract\\.test\\.(ts|tsx)$',
          '^apps/web/src/middleware\\.ts$',
          '^apps/web/src/pages/',
          '^apps/web/src/sentry\\.ts$',
          '^apps/mobile/src/sentry\\.ts$',
          '^apps/api/src/env\\.ts$',
          '^apps/api/src/sentry\\.ts$',
          '^apps/api/src/types/',
          '^packages/shared/src/rbac/types\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'not-to-unresolvable',
      comment:
        'Unresolvable imports — typically a stale path or a missing package — are ' +
        'a build-time error in disguise.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-deprecated-core',
      comment:
        'Deprecated Node core modules (punycode, domain, constants, sys, _linklist, _stream_wrap). ' +
        'See https://nodejs.org/api/deprecations.html.',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['deprecated'] },
    },
    {
      name: 'not-to-dev-dep',
      comment:
        'Production code must not import devDependencies. Tests, scripts, and configs may. ' +
        'See docs/architecture.md § 4 Build, Test, and Deploy.',
      severity: 'error',
      from: {
        path: '^(apps|packages)/[^/]+/src',
        pathNot: [
          '\\.test\\.(ts|tsx)$',
          '\\.contract\\.test\\.(ts|tsx)$',
          '(^|/)__tests__/',
          '(^|/)__testing__/',
          '(^|/)testing/', // packages/shared/src/testing/** is published surface for test code
        ],
      },
      to: { dependencyTypes: ['npm-dev'] },
    },

    // --- Workspace boundary rules ----------------------------------------
    // Source of truth: docs/architecture.md § 1 Tech Stack — Boundary rule
    // and § 2 Workspace Mapping.
    {
      name: 'shared-must-not-depend-on-apps',
      comment:
        '@repo/shared is the substrate; it must not know about consumers. ' +
        'See docs/architecture.md § 2 — Workspace Mapping → @repo/shared.',
      severity: 'error',
      from: { path: '^packages/shared/src' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-must-not-cross-import',
      comment:
        'apps/web and apps/api must not import each other directly. The only ' +
        'sanctioned coupling is the @repo/api AppType consumed via Hono RPC. ' +
        'See docs/architecture.md § 2 — @repo/web (`useApiClient` typed against AppType).',
      severity: 'error',
      from: { path: '^apps/web/src' },
      to: { path: '^apps/api/src' },
    },
    {
      name: 'api-must-not-import-web',
      comment:
        'Mirror of apps-must-not-cross-import. apps/api must never depend on apps/web. ' +
        'See docs/architecture.md § 2.',
      severity: 'error',
      from: { path: '^apps/api/src' },
      to: { path: '^apps/web/src' },
    },
    {
      name: 'mobile-must-not-cross-import',
      comment:
        'apps/mobile must not reach into apps/web or apps/api directly; shared types ' +
        'go through @repo/shared. See docs/architecture.md § 2 — @repo/mobile.',
      severity: 'error',
      from: { path: '^apps/mobile/src' },
      to: { path: '^apps/(web|api)/src' },
    },
    {
      name: 'no-relative-apps-to-packages',
      comment:
        'Cross-workspace coupling must go through @repo/* package aliases, not relative ' +
        '../../ paths. See docs/architecture.md § 1 — Boundary rule. The complementary ' +
        'apps-must-not-cross-import and shared-must-not-depend-on-apps rules cover the ' +
        'other quadrants regardless of import style.',
      severity: 'error',
      from: { path: '^apps/[^/]+/src/' },
      to: {
        path: '^packages/[^/]+/src/',
        dependencyTypes: ['local'],
      },
    },

    // --- Test isolation ---------------------------------------------------
    {
      name: 'test-helpers-only-in-tests',
      comment:
        'packages/shared/src/testing/** holds the Clerk test-instance seam and contract ' +
        'harness. Production code must never reach into it; otherwise the test seam ships ' +
        'in production builds. See docs/testing-strategy.md § Authenticated routes.',
      severity: 'error',
      from: {
        path: '^(apps|packages)/[^/]+/src',
        pathNot: [
          '\\.test\\.(ts|tsx)$',
          '\\.contract\\.test\\.(ts|tsx)$',
          '(^|/)__tests__/',
          '(^|/)__testing__/',
          '^packages/shared/src/testing/',
          '^apps/web/e2e/',
          '^tests/',
        ],
      },
      to: { path: '^packages/shared/src/testing/' },
    },

    // --- Domain ownership -------------------------------------------------
    {
      name: 'drizzle-schema-owns-tables',
      comment:
        'Only packages/shared/src/db/schema/** may import drizzle table builders. Apps consume ' +
        'tables via @repo/shared/db/schema; redeclaring them fractures the schema SSOT. ' +
        'See docs/architecture.md § 2 — @repo/shared.',
      severity: 'error',
      from: {
        path: '^(apps|packages)/',
        pathNot: '^packages/shared/src/db/schema/',
      },
      to: { path: '^drizzle-orm/(sqlite-core|libsql)' },
    },
    {
      name: 'auth-middleware-no-incoming-routes',
      comment:
        'Route handlers must not import middleware/auth.ts directly. They read c.var.auth ' +
        '(set by requireInternalUser upstream). AGENTS.md § Safety Constraints rule 3 keeps ' +
        'this file security-critical and write-locked. Contract tests are exempt — they wire ' +
        'the middleware into the test harness deliberately.',
      severity: 'error',
      from: {
        path: '^apps/api/src/routes/',
        pathNot: ['\\.test\\.(ts|tsx)$', '\\.contract\\.test\\.(ts|tsx)$', '(^|/)__tests__/'],
      },
      to: { path: '^apps/api/src/middleware/auth\\.ts$' },
    },
  ],

  // --- Required rules -----------------------------------------------------
  // "X must depend on Y" — the inverse of forbidden.
  //
  // The "edge logger goes through redaction" invariant (docs/architecture.md
  // § 3.4) is documented in patterns.md and enforced by the
  // `request-logger.ts` file header rather than depcruise: the redaction
  // module is re-exported through `@repo/shared`, and depcruise's `required`
  // rule checks direct edges only — once an import goes through a package
  // index re-export, the chain is invisible to a direct-edge required rule.
  // Encoding it as a `reachable` rule pulled in the entire shared graph and
  // produced false positives. Manual review owns this one.
  required: [],

  options: {
    doNotFollow: {
      path: '(node_modules|\\.bdd-gen|dist|coverage)',
    },
    includeOnly: '^(apps|packages)/[^/]+/src/',
    exclude: {
      path: [
        '(^|/)node_modules/',
        '(^|/)dist/',
        '(^|/)coverage/',
        '(^|/)\\.bdd-gen/',
        '(^|/)__testing__/',
      ],
    },
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['module', 'main', 'types'],
    },
    cache: false,
    progress: { type: 'none' },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
