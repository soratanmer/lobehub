import { describe, expect, it } from 'vitest';

import { buildOnboardingRedirectUrl } from './useUserStateRedirect';

describe('buildOnboardingRedirectUrl', () => {
  it('preserves invite path as callbackUrl', () => {
    expect(buildOnboardingRedirectUrl('/invite/abc', '')).toBe(
      '/onboarding?callbackUrl=%2Finvite%2Fabc',
    );
  });

  it('preserves path with query string', () => {
    expect(buildOnboardingRedirectUrl('/invite/abc', '?ref=email')).toBe(
      '/onboarding?callbackUrl=%2Finvite%2Fabc%3Fref%3Demail',
    );
  });

  it('returns bare /onboarding for root path', () => {
    expect(buildOnboardingRedirectUrl('/', '')).toBe('/onboarding');
  });

  it('returns bare /onboarding for sign-in / sign-up pages', () => {
    expect(buildOnboardingRedirectUrl('/signin', '')).toBe('/onboarding');
    expect(buildOnboardingRedirectUrl('/signup', '?email=x')).toBe('/onboarding');
    expect(buildOnboardingRedirectUrl('/next-auth/verify', '')).toBe('/onboarding');
  });

  it('returns bare /onboarding when already inside onboarding', () => {
    expect(buildOnboardingRedirectUrl('/onboarding/agent', '')).toBe('/onboarding');
  });

  it('preserves arbitrary in-app paths', () => {
    expect(buildOnboardingRedirectUrl('/workspace/foo', '?tab=members')).toBe(
      '/onboarding?callbackUrl=%2Fworkspace%2Ffoo%3Ftab%3Dmembers',
    );
  });
});
