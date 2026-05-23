// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSafeRelativePath, useFinishOnboardingRedirect } from './useFinishOnboardingRedirect';

describe('isSafeRelativePath', () => {
  it('accepts a relative path starting with single slash', () => {
    expect(isSafeRelativePath('/invite/abc')).toBe(true);
    expect(isSafeRelativePath('/workspace/foo?x=1')).toBe(true);
  });

  it('rejects null / empty / undefined', () => {
    expect(isSafeRelativePath(null)).toBe(false);
    expect(isSafeRelativePath('')).toBe(false);
    expect(isSafeRelativePath(undefined)).toBe(false);
  });

  it('rejects protocol-relative paths', () => {
    expect(isSafeRelativePath('//evil.com')).toBe(false);
    expect(isSafeRelativePath('//evil.com/path')).toBe(false);
  });

  it('rejects absolute URLs and javascript: schemes', () => {
    expect(isSafeRelativePath('http://evil.com')).toBe(false);
    expect(isSafeRelativePath('https://evil.com')).toBe(false);
    expect(isSafeRelativePath('javascript:alert(1)')).toBe(false);
  });

  it('rejects paths that do not start with /', () => {
    expect(isSafeRelativePath('invite/abc')).toBe(false);
    expect(isSafeRelativePath('?callbackUrl=x')).toBe(false);
  });
});

describe('useFinishOnboardingRedirect', () => {
  const originalLocation = window.location;
  let assignedHref = '';

  beforeEach(() => {
    assignedHref = '';
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        set href(value: string) {
          assignedHref = value;
        },
        get href() {
          return assignedHref;
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
    vi.restoreAllMocks();
  });

  const wrapper =
    (initialEntries: string[]) =>
    ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    );

  it('navigates to safe callbackUrl when present', () => {
    const { result } = renderHook(() => useFinishOnboardingRedirect(), {
      wrapper: wrapper(['/onboarding?callbackUrl=%2Finvite%2Fabc']),
    });
    result.current();
    expect(assignedHref).toBe('/invite/abc');
  });

  it('falls back to / when callbackUrl missing', () => {
    const { result } = renderHook(() => useFinishOnboardingRedirect(), {
      wrapper: wrapper(['/onboarding']),
    });
    result.current();
    expect(assignedHref).toBe('/');
  });

  it('falls back to / when callbackUrl is unsafe', () => {
    const { result } = renderHook(() => useFinishOnboardingRedirect(), {
      wrapper: wrapper(['/onboarding?callbackUrl=https%3A%2F%2Fevil.com']),
    });
    result.current();
    expect(assignedHref).toBe('/');
  });

  it('rejects protocol-relative callbackUrl', () => {
    const { result } = renderHook(() => useFinishOnboardingRedirect(), {
      wrapper: wrapper(['/onboarding?callbackUrl=%2F%2Fevil.com']),
    });
    result.current();
    expect(assignedHref).toBe('/');
  });
});
