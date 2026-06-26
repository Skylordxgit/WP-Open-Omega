import { useEffect } from 'react';
import { useBranding, resolveBrowserTitle } from './useBranding';

/**
 * Custom hook to set document title dynamically.
 * Appends " | <browser tab title>" using the configured branding. The suffix
 * resolves to the configured browser tab title, then the app name — never a
 * hardcoded brand string (see resolveBrowserTitle).
 */
export function useDocumentTitle(title: string) {
  const { branding } = useBranding();
  const suffix = resolveBrowserTitle(branding);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = title ? `${title} | ${suffix}` : suffix;

    return () => {
      document.title = previousTitle;
    };
  }, [title, suffix]);
}
