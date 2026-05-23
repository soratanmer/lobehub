'use client';

import { useCallback } from 'react';

import { isDesktop } from '@/const/version';
import { onboardingSelectors } from '@/store/user/selectors';
import { type UserInitializationState } from '@/types/user';

const SKIP_PRESERVE_PREFIXES = ['/signin', '/signup', '/next-auth', '/onboarding'];

export const buildOnboardingRedirectUrl = (pathname: string, search: string): string => {
  const shouldPreserve =
    pathname !== '/' && !SKIP_PRESERVE_PREFIXES.some((p) => pathname.startsWith(p));
  if (!shouldPreserve) return '/onboarding';
  return `/onboarding?callbackUrl=${encodeURIComponent(`${pathname}${search}`)}`;
};

export const useDesktopUserStateRedirect = () => {
  // Desktop onboarding redirect is now handled by main process (BrowserManager)
  // No need to check localStorage here
  return useCallback(() => {}, []);
};

export const useWebUserStateRedirect = () =>
  useCallback((state: UserInitializationState) => {
    const { pathname, search } = window.location;

    if (!onboardingSelectors.needsOnboarding(state)) return;
    if (pathname.startsWith('/onboarding')) return;

    window.location.href = buildOnboardingRedirectUrl(pathname, search);
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
