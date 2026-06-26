import { useEffect } from 'react';
import { useBranding } from './useBranding';

/**
 * Custom hook to set document title dynamically.
 * Appends " | <browser tab title>" using the configured branding (falls back to "OpenWA").
 */
export function useDocumentTitle(title: string) {
  const { branding } = useBranding();
  const suffix = branding.browserTitle || 'OpenWA';

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | ${suffix}`;

    return () => {
      document.title = previousTitle;
    };
  }, [title, suffix]);
}
