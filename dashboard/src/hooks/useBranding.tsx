import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { brandingApi, type BrandingSettings } from '../services/api';

const DEFAULT_BRANDING: BrandingSettings = {
  appName: 'OpenWA',
  sidebarHeadline: 'OpenWA',
  sidebarSubtitle: 'WhatsApp API',
  loginTitle: 'OpenWA Technical Dashboard',
  loginSubtitle: 'Internal API key access for session control, logs, plugins, and engine tools.',
  browserTitle: 'OpenWA',
  primaryColor: '#18b561',
  accentColor: '#21c77f',
  sidebarLogoUrl: '/openwa_logo.webp',
  loginLogoUrl: '/openwa_logo.webp',
  faviconUrl: '/favicon.svg',
  updatedAt: '',
};

interface BrandingContextType {
  branding: BrandingSettings;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

function hexToRgba(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return `rgba(24, 181, 97, ${alpha})`;
  const int = parseInt(match[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Pushes saved brand colors onto the existing design-token CSS variables at runtime. */
function applyColorTokens(branding: BrandingSettings) {
  const root = document.documentElement.style;
  root.setProperty('--primary', branding.primaryColor);
  root.setProperty('--primary-hover', branding.accentColor);
  root.setProperty('--primary-soft', hexToRgba(branding.primaryColor, 0.12));
  root.setProperty('--primary-soft-strong', hexToRgba(branding.primaryColor, 0.2));
  root.setProperty('--primary-border', hexToRgba(branding.primaryColor, 0.3));
  root.setProperty('--sidebar-active', hexToRgba(branding.primaryColor, 0.2));
  root.setProperty('--sidebar-active-border', hexToRgba(branding.primaryColor, 0.42));
}

function applyBrowserChrome(branding: BrandingSettings) {
  document.title = branding.browserTitle || DEFAULT_BRANDING.browserTitle;

  let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.rel = 'icon';
    document.head.appendChild(favicon);
  }
  favicon.href = branding.faviconUrl || DEFAULT_BRANDING.faviconUrl;
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingSettings>(DEFAULT_BRANDING);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await brandingApi.get();
      setBranding(data);
      applyColorTokens(data);
      applyBrowserChrome(data);
    } catch {
      // Network/backend unavailable — keep defaults so the app still renders sensibly.
      applyColorTokens(DEFAULT_BRANDING);
      applyBrowserChrome(DEFAULT_BRANDING);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <BrandingContext.Provider value={{ branding, isLoading, refresh }}>{children}</BrandingContext.Provider>
  );
}

export function useBranding(): BrandingContextType {
  const context = useContext(BrandingContext);
  if (context === undefined) {
    throw new Error('useBranding must be used within a BrandingProvider');
  }
  return context;
}
