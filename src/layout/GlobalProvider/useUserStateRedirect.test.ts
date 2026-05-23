import { describe, expect, it } from 'vitest';

import { buildOnboardingRedirectUrl, shouldDeferOnboardingRedirect } from './useUserStateRedirect';

describe('buildOnboardingRedirectUrl', () => {
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

describe('shouldDeferOnboardingRedirect', () => {
  it('defers on invite routes so invited users can accept before onboarding', () => {
    expect(shouldDeferOnboardingRedirect('/invite/abc')).toBe(true);
    expect(shouldDeferOnboardingRedirect('/invite/abc/')).toBe(true);
  });

  it('defers on possible workspace slug routes', () => {
    expect(shouldDeferOnboardingRedirect('/acme')).toBe(true);
    expect(shouldDeferOnboardingRedirect('/acme/settings/members')).toBe(true);
  });

  it('does not defer on personal app routes', () => {
    expect(shouldDeferOnboardingRedirect('/')).toBe(false);
    expect(shouldDeferOnboardingRedirect('/agent')).toBe(false);
    expect(shouldDeferOnboardingRedirect('/settings/profile')).toBe(false);
  });
});
