import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // Workspace-aware entry points. Knip auto-detects framework plugins
  // (vitest, playwright, astro, biome, eslint, expo) inside each workspace,
  // so we only declare the bespoke entries those plugins can't infer.
  workspaces: {
    '.': {
      entry: [
        'scripts/**/*.{mjs,ts}',
        'vitest.workspace.ts',
        'vitest.config.ts',
        'lint-staged.config.js',
        'commitlint.config.js',
        'stryker.config.json',
      ],
      project: ['scripts/**/*.{mjs,ts}'],
      // The deps below are consumed by surfaces knip can't follow:
      //   - js-yaml / picomatch / string-argv: required by `.agents/`
      //     submodule scripts (frozen, not in our project graph).
      //   - @commitlint/cli + lint-staged: invoked by `.husky/` shell
      //     hooks via `pnpm exec`.
      //   - @secretlint/secretlint-rule-preset-recommend: referenced
      //     by `.secretlintrc.json`, not by JS imports.
      ignoreDependencies: [
        'js-yaml',
        'picomatch',
        'string-argv',
        '@commitlint/cli',
        'lint-staged',
        '@secretlint/secretlint-rule-preset-recommend',
        // minimatch — consumed by `.agents/scripts/lib/baselines/components.js`
        // (framework submodule, ignored by knip's project scan). Surfaced
        // by Epic #702 design-system close-validation.
        'minimatch',
        // typhonjs-escomplex — consumed by the `.agents/` submodule
        // maintainability + CRAP baseline engines
        // (`lib/maintainability-engine.js`, `lib/crap-engine.js`), which
        // knip's project scan can't follow. Its consumer-side import was
        // removed when #1000/#1002 converged the baselines onto the Mandrel
        // engine; surfaced by Epic #997 close-validation.
        'typhonjs-escomplex',
      ],
    },
    'apps/api': {
      entry: [
        'src/index.ts',
        'src/sentry.ts',
        'src/env.ts',
        'src/routes/**/*.ts',
        // Test-only auth adapter under `__testing__/` — imported by the
        // contract test `no-prod-import.contract.test.ts` (Story #342 /
        // Task #355) and is the API-side mirror of the shared test-auth
        // seam. Listed explicitly because the multi-project vitest config
        // does not surface it as an auto-discovered entry to knip.
        'src/middleware/__testing__/**/*.ts',
        'vitest.config.ts',
      ],
    },
    'apps/web': {
      entry: [
        'src/index.ts',
        'src/sentry.ts',
        // Astro middleware — auto-loaded by Astro at request time but not
        // auto-discovered by knip's Astro plugin (Story #328 / Task #331).
        'src/middleware.ts',
        // Astro routes — `.astro` pages are discovered by the Astro plugin
        // but `.ts` endpoints (e.g., `src/pages/sign-out.ts` from Story
        // #328 / Task #333) are not; declared here so knip follows the
        // surface.
        'src/pages/**/*.{ts,astro}',
        // Shared shell — RootLayout.astro is the canonical insertion point
        // for the global stylesheet and the ToastHost mount (Epic #702
        // Story #711 / Task #720; Story #714 / Task #731). Knip's Astro
        // plugin does not chase `.astro → .astro` imports reliably, so the
        // layout is named explicitly to keep `src/styles/global.css` and
        // the transitively-imported primitives reachable.
        'src/layouts/**/*.astro',
        // global.css — imported by RootLayout.astro via a CSS side-effect
        // import in the Astro front-matter; knip's Astro plugin does not
        // track CSS module imports from `.astro` files. Declaring it as a
        // first-class entry so the design-system token catalogue stays
        // reachable.
        'src/styles/global.css',
        'astro.config.ts',
        'playwright.config.ts',
        'vitest.config.ts',
        'e2e/**/*.{ts,mjs}',
      ],
      // Knip's Astro plugin does not follow imports out of `.astro` files
      // into the `ui/` primitive directory shipped by Epic #702. The two
      // dependencies below are consumed transitively from there:
      //   - tailwindcss is loaded by `@import "tailwindcss"` in
      //     `apps/web/src/styles/global.css`.
      //   - lucide-react is imported by `apps/web/src/components/ui/Sidebar.astro`.
      ignoreDependencies: ['lucide-react', 'tailwindcss'],
    },
    'apps/mobile': {
      entry: ['src/sentry.ts', 'app.config.ts'],
      // @repo/config — declared for future vitest sharing once mobile
      //   grows a unit-test surface beyond the Sentry init wrapper.
      // expo-updates — synthesized by knip's `expo` plugin (every Expo
      //   app is expected to declare it for OTA). Not actually used by
      //   the current app shell; will be added when OTA lands.
      // @clerk/clerk-expo — declared by Epic #7 / Story #328 to prove
      //   package selection for the v1.0 native sign-in flow; no source
      //   consumes it yet because the native app shell does not exist
      //   at MVP. Wired in by the v1.0 native-apps Epic.
      ignoreDependencies: ['@repo/config', 'expo-updates', '@clerk/clerk-expo'],
    },
    'packages/baselines': {
      entry: ['src/index.ts'],
    },
    'packages/shared': {
      entry: ['src/index.ts', 'src/testing/index.ts'],
    },
    'packages/config': {
      entry: ['vitest.base.ts', 'vitest.contract.ts'],
    },
  },
  // Ignore the agent submodule (managed externally), the build outputs,
  // the per-worktree scratch dirs, and the generated playwright-bdd
  // bindings under apps/web.
  ignore: [
    '.agents/**',
    '.worktrees/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.bdd-gen/**',
    '**/test-results/**',
    'reports/**',
    'temp/**',
    // Step-linter rejecting fixtures — intentionally malformed BDD
    // step files that prove `scripts/lint-steps.mjs` rejects each rule
    // class. Knip would otherwise flag their `playwright-bdd` /
    // `@playwright/test` imports as unlisted dependencies, but the
    // files are scratch fixtures (`scripts/__fixtures__/` is excluded
    // from biome + eslint for the same reason — see `biome.json`).
    'scripts/__fixtures__/**',
  ],
};

export default config;
