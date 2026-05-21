// apps/web/src/testing/astro-middleware-shim.ts
//
// Vitest-only shim for the `astro:middleware` virtual module. The Astro
// runtime exposes `defineMiddleware` and `sequence` via a virtual module
// resolved by Astro's Vite plugin; Vitest does not run that plugin, so
// importing `astro:middleware` from a unit test fails with "Cannot find
// package 'astro:middleware'". This shim re-implements the two functions
// in a runtime-equivalent shape so the production middleware module can
// be imported under Vitest without spinning up Astro.
//
// `defineMiddleware` is an identity helper in Astro (its sole purpose is
// to attach the runtime middleware type to the function literal); this
// shim mirrors that semantics. `sequence` runs a chain of middlewares,
// each receiving its own bound `next` that defers to the subsequent
// middleware in the chain — the unit test under apps/web does not
// exercise `sequence` itself (the table-driven test calls
// `createOnboardingGate` directly), but the shim still implements it so
// the production module's top-level `onRequest` composition can be
// imported without throwing.
//
// Story #562 (Task #573) — wired in apps/web/vitest.config.ts via a
// resolve.alias entry that maps the bare specifier `astro:middleware`
// to this file.

type MiddlewareNext = () => Promise<Response>;

type MiddlewareHandler<C> = (
  context: C,
  next: MiddlewareNext,
) => Promise<Response> | Response | Promise<void> | void;

export function defineMiddleware<C>(handler: MiddlewareHandler<C>): MiddlewareHandler<C> {
  return handler;
}

export function sequence<C>(
  ...handlers: ReadonlyArray<MiddlewareHandler<C>>
): MiddlewareHandler<C> {
  return async function chained(context, next): Promise<Response> {
    let index = -1;
    async function dispatch(i: number): Promise<Response> {
      if (i <= index) throw new Error('sequence(): next() called multiple times');
      index = i;
      const handler = handlers[i];
      if (!handler) return next();
      const result = await handler(context, () => dispatch(i + 1));
      if (result instanceof Response) return result;
      // Handler returned void — defer to next() for the final response.
      return next();
    }
    return dispatch(0);
  };
}
