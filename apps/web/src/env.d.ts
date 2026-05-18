// apps/web/src/env.d.ts
//
// Ambient type references for the Astro runtime. The Clerk package ships
// its own `App.Locals` augmentation (carrying `auth`, `currentUser`,
// `authStatus`, etc.) — re-export that triple-slash reference here so
// `Astro.locals.auth(...)` is strongly typed across the app.
//
// Story #328 (Task #331) — Clerk SDK wiring for the web runtime.

/// <reference types="astro/client" />
/// <reference types="@clerk/astro/env" />
