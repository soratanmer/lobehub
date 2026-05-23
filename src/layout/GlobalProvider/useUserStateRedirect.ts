'use client';

import { useCallback } from 'react';

import { isDesktop } from '@/const/version';
import { onboardingSelectors } from '@/store/user/selectors';
import { type UserInitializationState } from '@/types/user';

const SKIP_PRESERVE_PREFIXES = ['/signin', '/signup', '/next-auth', '/onboarding'];
const DEFER_REDIRECT_PREFIXES = ['/invite'];

const RESERVED_FIRST_SEGMENTS = new Set([
  'agent',
  'community',
  'desktop-onboarding',
  'devtools',
  'eval',
  'group',
  'image',
  'me',
  'memory',
  'next-auth',
  'onboarding',
  'page',
  'resource',
  'settings',
  'share',
  'signin',
  'signup',
  'subscription',
  'task',
  'tasks',
  'video',
]);

const FIRST_SEGMENT_REGEX = /^\/([^/?#]+)/;

const isPathUnder = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

const parseFirstSegment = (pathname: string): string | null => {
  const match = pathname.match(FIRST_SEGMENT_REGEX);
  return match ? match[1] : null;
};

export const shouldDeferOnboardingRedirect = (pathname: string): boolean => {
  if (DEFER_REDIRECT_PREFIXES.some((prefix) => isPathUnder(pathname, prefix))) return true;

  const first = parseFirstSegment(pathname);

  return !!first && !RESERVED_FIRST_SEGMENTS.has(first);
};

export const useDesktopUserStateRedirect = () => {
  // Desktop onboarding redirect is now handled by main process (BrowserManager)
  // No need to check localStorage here
  return useCallback(() => {}, []);
};

export const useWebUserStateRedirect = () =>
  useCallback((state: UserInitializationState) => {
    const { pathname } = window.location;

    if (!onboardingSelectors.needsOnboarding(state)) return;
    if (shouldDeferOnboardingRedirect(pathname)) return;
    if (pathname.startsWith('/onboarding')) return;

    window.location.href = '/onboarding';
  }, []);

export const useUserStateRedirect = () => {
  const desktopRedirect = useDesktopUserStateRedirect();
  const webRedirect = useWebUserStateRedirect();

  return useCallback(
    (state: UserInitializationState) => {
      const redirect = isDesktop ? desktopRedirect : webRedirect;
      redirect(state);
    },
    [desktopRedirect, webRedirect],
  );
};
