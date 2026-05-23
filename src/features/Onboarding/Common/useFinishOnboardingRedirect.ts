'use client';

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export const isSafeRelativePath = (raw: string | null | undefined): raw is string => {
  if (!raw) return false;
  if (!raw.startsWith('/')) return false;
  if (raw.startsWith('//')) return false;
  return true;
};

export const useFinishOnboardingRedirect = () => {
  const [searchParams] = useSearchParams();
  return useCallback(() => {
    const raw = searchParams.get('callbackUrl');
    const target = isSafeRelativePath(raw) ? raw : '/';
    window.location.href = target;
  }, [searchParams]);
};
