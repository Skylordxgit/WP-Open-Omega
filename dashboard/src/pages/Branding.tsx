import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Palette, Globe, Sparkles, RotateCcw, Upload, Save } from 'lucide-react';
import { brandingApi, type BrandingSettings, type BrandingUploadKind } from '../services/api';
import { useBranding } from '../hooks/useBranding';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import './Branding.css';

type FormState = Pick<
  BrandingSettings,
  'appName' | 'sidebarHeadline' | 'sidebarSubtitle' | 'loginTitle' | 'loginSubtitle' | 'browserTitle' | 'primaryColor' | 'accentColor'
>;

function toFormState(branding: BrandingSettings): FormState {
  return {
    appName: branding.appName,
    sidebarHeadline: branding.sidebarHeadline,
    sidebarSubtitle: branding.sidebarSubtitle,
    loginTitle: branding.loginTitle,
    loginSubtitle: branding.loginSubtitle,
    browserTitle: branding.browserTitle,
    primaryColor: branding.primaryColor,
    accentColor: branding.accentColor,
  };
}

const ACCEPTED_TYPES = 'image/png,image/jpeg,image/webp,image/svg+xml';
const MAX_UPLOAD_MB = 2;

export function Branding() {
  const { branding, refresh } = useBranding();
  useDocumentTitle('Branding');
  const toast = useToast();

  const [form, setForm] = useState<FormState>(() => toFormState(branding));
  const [isSaving, setIsSaving] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<BrandingUploadKind | null>(null);

  const sidebarLogoInput = useRef<HTMLInputElement>(null);
  const loginLogoInput = useRef<HTMLInputElement>(null);
  const faviconInput = useRef<HTMLInputElement>(null);

  // Re-sync the form whenever fresh branding loads (initial fetch, after save, after upload).
  useEffect(() => {
    setForm(toFormState(branding));
  }, [branding]);

  const updateField = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await brandingApi.update(form);
      await refresh();
      toast.success('Branding saved', 'Sidebar, login page, and browser tab now use your updated branding.');
    } catch (err) {
      toast.error('Failed to save branding', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsSaving(true);
    try {
      await brandingApi.reset();
      await refresh();
      toast.success('Branding reset', 'Restored the default OpenWA branding.');
    } catch (err) {
      toast.error('Failed to reset branding', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpload = (kind: BrandingUploadKind) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      toast.error('File too large', `Please choose a file under ${MAX_UPLOAD_MB}MB.`);
      return;
    }

    setUploadingKind(kind);
    try {
      await brandingApi.upload(kind, file);
      await refresh();
      toast.success('Upload complete', 'The new image is now live.');
    } catch (err) {
      toast.error('Upload failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setUploadingKind(null);
    }
  };

  return (
    <div className="branding-page">
      <PageHeader
        title="Branding"
        subtitle="Customize your platform's own brand identity — sidebar, login page, browser tab, and colors."
        actions={
          <button className="btn-secondary" onClick={handleReset} disabled={isSaving}>
            <RotateCcw size={18} />
            Reset to defaults
          </button>
        }
      />

      <div className="branding-grid">
        <section className="branding-card">
          <div className="branding-card__header">
            <Sparkles size={18} />
            <h3>Brand Identity</h3>
          </div>
          <div className="branding-card__body">
            <div className="form-field">
              <label htmlFor="appName">App name</label>
              <input id="appName" type="text" value={form.appName} onChange={updateField('appName')} maxLength={80} />
            </div>
            <div className="form-field">
              <label htmlFor="sidebarHeadline">Sidebar headline</label>
              <input
                id="sidebarHeadline"
                type="text"
                value={form.sidebarHeadline}
                onChange={updateField('sidebarHeadline')}
                maxLength={80}
              />
            </div>
            <div className="form-field">
              <label htmlFor="sidebarSubtitle">Sidebar subtitle / tagline</label>
              <input
                id="sidebarSubtitle"
                type="text"
                value={form.sidebarSubtitle}
                onChange={updateField('sidebarSubtitle')}
                maxLength={120}
              />
            </div>
            <div className="form-field">
              <label htmlFor="loginTitle">Login page title</label>
              <input id="loginTitle" type="text" value={form.loginTitle} onChange={updateField('loginTitle')} maxLength={120} />
            </div>
            <div className="form-field">
              <label htmlFor="loginSubtitle">Login page subtitle</label>
              <textarea
                id="loginSubtitle"
                value={form.loginSubtitle}
                onChange={updateField('loginSubtitle')}
                maxLength={240}
                rows={2}
              />
            </div>
          </div>
        </section>

        <section className="branding-card">
          <div className="branding-card__header">
            <ImageIcon size={18} />
            <h3>Logos</h3>
          </div>
          <div className="branding-card__body">
            <div className="logo-upload-row">
              <div className="logo-preview">
                <img src={branding.sidebarLogoUrl} alt="Sidebar logo" />
              </div>
              <div className="logo-upload-info">
                <span className="logo-upload-label">Sidebar logo</span>
                <span className="logo-upload-hint">PNG, JPG, WEBP, or SVG · max {MAX_UPLOAD_MB}MB</span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => sidebarLogoInput.current?.click()}
                  disabled={uploadingKind === 'sidebar-logo'}
                >
                  <Upload size={16} />
                  {uploadingKind === 'sidebar-logo' ? 'Uploading…' : 'Change logo'}
                </button>
                <input
                  ref={sidebarLogoInput}
                  type="file"
                  accept={ACCEPTED_TYPES}
                  hidden
                  onChange={handleUpload('sidebar-logo')}
                />
              </div>
            </div>

            <div className="logo-upload-row">
              <div className="logo-preview">
                <img src={branding.loginLogoUrl} alt="Login logo" />
              </div>
              <div className="logo-upload-info">
                <span className="logo-upload-label">Login page logo</span>
                <span className="logo-upload-hint">PNG, JPG, WEBP, or SVG · max {MAX_UPLOAD_MB}MB</span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => loginLogoInput.current?.click()}
                  disabled={uploadingKind === 'login-logo'}
                >
                  <Upload size={16} />
                  {uploadingKind === 'login-logo' ? 'Uploading…' : 'Change logo'}
                </button>
                <input
                  ref={loginLogoInput}
                  type="file"
                  accept={ACCEPTED_TYPES}
                  hidden
                  onChange={handleUpload('login-logo')}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="branding-card">
          <div className="branding-card__header">
            <Palette size={18} />
            <h3>Colors</h3>
          </div>
          <div className="branding-card__body">
            <div className="color-field">
              <label htmlFor="primaryColor">Primary brand color</label>
              <div className="color-input-wrapper">
                <input
                  id="primaryColor"
                  type="color"
                  value={form.primaryColor}
                  onChange={updateField('primaryColor')}
                />
                <input
                  type="text"
                  value={form.primaryColor}
                  onChange={updateField('primaryColor')}
                  maxLength={7}
                  className="color-hex-input"
                />
              </div>
            </div>
            <div className="color-field">
              <label htmlFor="accentColor">Accent color</label>
              <div className="color-input-wrapper">
                <input
                  id="accentColor"
                  type="color"
                  value={form.accentColor}
                  onChange={updateField('accentColor')}
                />
                <input
                  type="text"
                  value={form.accentColor}
                  onChange={updateField('accentColor')}
                  maxLength={7}
                  className="color-hex-input"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="branding-card">
          <div className="branding-card__header">
            <Globe size={18} />
            <h3>Browser / Favicon</h3>
          </div>
          <div className="branding-card__body">
            <div className="form-field">
              <label htmlFor="browserTitle">Browser tab title</label>
              <input
                id="browserTitle"
                type="text"
                value={form.browserTitle}
                onChange={updateField('browserTitle')}
                maxLength={80}
              />
            </div>

            <div className="logo-upload-row">
              <div className="logo-preview favicon-preview">
                <img src={branding.faviconUrl} alt="Favicon" />
              </div>
              <div className="logo-upload-info">
                <span className="logo-upload-label">Favicon</span>
                <span className="logo-upload-hint">PNG, JPG, WEBP, or SVG · max {MAX_UPLOAD_MB}MB</span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => faviconInput.current?.click()}
                  disabled={uploadingKind === 'favicon'}
                >
                  <Upload size={16} />
                  {uploadingKind === 'favicon' ? 'Uploading…' : 'Change favicon'}
                </button>
                <input ref={faviconInput} type="file" accept={ACCEPTED_TYPES} hidden onChange={handleUpload('favicon')} />
              </div>
            </div>
          </div>
        </section>

        <section className="branding-card branding-card--preview">
          <div className="branding-card__header">
            <Sparkles size={18} />
            <h3>Live Preview</h3>
          </div>
          <div className="branding-card__body">
            <div className="preview-sidebar" style={{ '--preview-primary': form.primaryColor } as React.CSSProperties}>
              <img src={branding.sidebarLogoUrl} alt="" className="preview-sidebar-logo" />
              <div className="preview-sidebar-text">
                <strong>{form.sidebarHeadline || form.appName}</strong>
                <span>{form.sidebarSubtitle}</span>
              </div>
            </div>

            <div className="preview-login" style={{ '--preview-primary': form.primaryColor } as React.CSSProperties}>
              <img src={branding.loginLogoUrl} alt="" className="preview-login-logo" />
              <strong>{form.loginTitle}</strong>
              <p>{form.loginSubtitle}</p>
              <span className="preview-login-btn">Connect</span>
            </div>

            <div className="preview-swatches">
              <div className="preview-swatch" style={{ background: form.primaryColor }}>
                <span>Primary</span>
              </div>
              <div className="preview-swatch" style={{ background: form.accentColor }}>
                <span>Accent</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="branding-save-bar">
        <button className="btn-primary large" onClick={handleSave} disabled={isSaving}>
          <Save size={18} />
          {isSaving ? 'Saving…' : 'Save branding'}
        </button>
      </div>
    </div>
  );
}
