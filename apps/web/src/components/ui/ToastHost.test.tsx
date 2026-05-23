// apps/web/src/components/ui/ToastHost.test.tsx
//
// Unit tests for the ToastHost React island. Pins:
//   - The host renders Sonner's canonical `[data-sonner-toaster]` element
//     so the layout mount (Task #731) and downstream `toast.*` calls land
//     on a real Sonner surface.
//   - Calling `toast.success(...)` after mount actually inserts a toast
//     `<li>` into the DOM, proving the canonical helper at
//     `./_lib/toast` is wired to the same Sonner singleton the host
//     renders.
//
// Story #714 / Task #730 — Epic #702 design-system foundation.

// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ToastHost } from './ToastHost';
import { toast } from './_lib/toast';

// React 19 requires this flag in any test environment that drives
// `act(...)` against `react-dom/client`. Without it React logs the
// "current testing environment is not configured to support act(...)"
// warning and the toaster's effect-driven mount never lands.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

function mount(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<ToastHost />);
  });
}

describe('<ToastHost>', () => {
  it('renders the Sonner notification region', () => {
    mount();
    // Sonner always renders an accessible `<section aria-label="Notifications …">`
    // region as soon as <Toaster /> mounts. The inner `[data-sonner-toaster]`
    // ordered list only appears once at least one toast lands (see the next
    // test). Asserting on the accessible label here proves the host is
    // rendered without coupling to Sonner's internal lazy-render.
    const region = document.querySelector('section[aria-label^="Notifications"]');
    expect(region).not.toBeNull();
  });

  it('inserts a toast into the DOM when toast.success is called', async () => {
    mount();

    await act(async () => {
      toast.success('saved');
      // Sonner schedules the toast insertion via setTimeout; flush the
      // microtask + macrotask queue so the <li> lands in the DOM before
      // we assert.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    const toasts = document.querySelectorAll('[data-sonner-toast]');
    expect(toasts.length).toBeGreaterThan(0);

    // The [data-sonner-toaster] ol is materialized as soon as a toast
    // lands; this confirms it is the canonical host the layout mounts
    // (Task #731 asserts exactly one of these on the rendered page).
    expect(document.querySelectorAll('[data-sonner-toaster]').length).toBe(1);
  });
});
