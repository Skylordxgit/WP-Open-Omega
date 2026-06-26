import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../../common/services/logger.service';
import { isPathWithin } from '../../common/utils/path-safety';
import { BrandingSettings, UpdateBrandingDto } from './dto/branding.dto';

const DEFAULTS: Omit<BrandingSettings, 'updatedAt'> = {
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
};

const ALLOWED_UPLOAD_MIMETYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
};

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2MB — logos/favicons only.

export type BrandingUploadKind = 'sidebarLogo' | 'loginLogo' | 'favicon';

/**
 * Persists platform branding (own product identity, not customer white-label) to a JSON
 * file under the same Docker-safe `data/` volume already used for the SQLite DBs and
 * media storage, so it survives container restarts without requiring a DB migration.
 */
@Injectable()
export class BrandingService {
  private readonly logger = createLogger('BrandingService');
  private readonly brandingDir = path.resolve(process.cwd(), 'data', 'branding');
  private readonly uploadsDir = path.join(this.brandingDir, 'uploads');
  private readonly settingsFile = path.join(this.brandingDir, 'branding.json');
  private cache: BrandingSettings | null = null;

  constructor() {
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  get(): BrandingSettings {
    if (this.cache) return this.cache;

    if (fs.existsSync(this.settingsFile)) {
      try {
        const raw = fs.readFileSync(this.settingsFile, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<BrandingSettings>;
        this.cache = { ...DEFAULTS, updatedAt: new Date(0).toISOString(), ...parsed };
        return this.cache;
      } catch (error) {
        this.logger.error('Failed to read branding.json, falling back to defaults', String(error));
      }
    }

    this.cache = { ...DEFAULTS, updatedAt: new Date(0).toISOString() };
    return this.cache;
  }

  update(dto: UpdateBrandingDto): BrandingSettings {
    const current = this.get();
    const next: BrandingSettings = {
      ...current,
      ...Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)),
      updatedAt: new Date().toISOString(),
    };
    this.persist(next);
    return next;
  }

  /** Validates and saves an uploaded logo/favicon, returning the public URL to store on the settings. */
  saveUpload(kind: BrandingUploadKind, file: { mimetype: string; size: number; buffer: Buffer }): BrandingSettings {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file uploaded');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)`);
    }
    const ext = ALLOWED_UPLOAD_MIMETYPES[file.mimetype];
    if (!ext) {
      throw new BadRequestException(
        `Unsupported file type "${file.mimetype}". Allowed: PNG, JPG, WEBP, SVG.`,
      );
    }

    const filename = `${kind}-${Date.now()}${ext}`;
    if (!isPathWithin(this.uploadsDir, filename)) {
      throw new BadRequestException('Invalid filename');
    }
    const fullPath = path.join(this.uploadsDir, filename);
    fs.writeFileSync(fullPath, file.buffer);

    const publicUrl = `/api/branding/uploads/${filename}`;
    const current = this.get();
    const field: keyof BrandingSettings =
      kind === 'sidebarLogo' ? 'sidebarLogoUrl' : kind === 'loginLogo' ? 'loginLogoUrl' : 'faviconUrl';

    this.removeOldUpload(current[field]);

    const next: BrandingSettings = { ...current, [field]: publicUrl, updatedAt: new Date().toISOString() };
    this.persist(next);
    return next;
  }

  /** Reads a previously uploaded file by name for the public static-serving route. */
  readUpload(filename: string): Buffer {
    if (!isPathWithin(this.uploadsDir, filename)) {
      throw new BadRequestException('Invalid filename');
    }
    const fullPath = path.join(this.uploadsDir, filename);
    if (!fs.existsSync(fullPath)) {
      throw new BadRequestException('File not found');
    }
    return fs.readFileSync(fullPath);
  }

  reset(): BrandingSettings {
    const next: BrandingSettings = { ...DEFAULTS, updatedAt: new Date().toISOString() };
    this.persist(next);
    return next;
  }

  private removeOldUpload(url: string | undefined): void {
    if (!url || !url.startsWith('/api/branding/uploads/')) return; // never delete bundled defaults
    const filename = url.replace('/api/branding/uploads/', '');
    if (!isPathWithin(this.uploadsDir, filename)) return;
    const fullPath = path.join(this.uploadsDir, filename);
    try {
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch (error) {
      this.logger.debug('Failed to remove previous branding upload', { error: String(error) });
    }
  }

  private persist(settings: BrandingSettings): void {
    if (!fs.existsSync(this.brandingDir)) {
      fs.mkdirSync(this.brandingDir, { recursive: true });
    }
    fs.writeFileSync(this.settingsFile, JSON.stringify(settings, null, 2));
    this.cache = settings;
  }
}
