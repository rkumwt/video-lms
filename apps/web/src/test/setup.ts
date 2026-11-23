import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.className = '';
});

// jsdom has no matchMedia.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
});

// jsdom lacks ResizeObserver (used by Radix primitives) and pointer-capture APIs.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
for (const [name, impl] of [
  ['hasPointerCapture', () => false],
  ['scrollIntoView', () => undefined],
] as const) {
  if (!(name in Element.prototype)) Object.defineProperty(Element.prototype, name, { value: impl });
}
