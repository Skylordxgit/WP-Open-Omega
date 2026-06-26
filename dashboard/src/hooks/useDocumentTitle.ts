import { useEffect } from 'react';
import { useBranding, resolveDocumentTitle } from './useBranding';

/**
 * Custom hook to set the document title dynamically.
 * When a Browser tab title is configured it is used verbatim (no page prefix);
 * otherwise the "Page | App name" format is used. See resolveDocumentTitle.
 */
export function useDocumentTitle(title: string) {
  const { branding } = useBranding();
  const resolved = resolveDocumentTitle(branding, title);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = resolved;

    return () => {
      document.title = previousTitle;
    };
  }, [resolved]);
}
