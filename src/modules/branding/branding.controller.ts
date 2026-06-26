import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public, RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { BrandingService } from './branding.service';
import { UpdateBrandingDto } from './dto/branding.dto';
import type { BrandingSettings } from './dto/branding.dto';

/** Minimal shape of a multer in-memory file, avoiding a dependency on @types/multer. */
interface UploadedMulterFile {
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const UPLOAD_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

@ApiTags('branding')
@Controller('branding')
export class BrandingController {
  constructor(private readonly brandingService: BrandingService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Get platform branding (public — needed by the login page before authentication)' })
  @ApiResponse({ status: 200, description: 'Current branding settings' })
  get(): BrandingSettings {
    return this.brandingService.get();
  }

  @Put()
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Update platform branding text/color fields' })
  @ApiResponse({ status: 200, description: 'Branding updated' })
  update(@Body() dto: UpdateBrandingDto): BrandingSettings {
    return this.brandingService.update(dto);
  }

  @Post('reset')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Reset branding to defaults' })
  @ApiResponse({ status: 200, description: 'Branding reset' })
  reset(): BrandingSettings {
    return this.brandingService.reset();
  }

  @Post('upload/sidebar-logo')
  @RequireRole(ApiKeyRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload the sidebar logo' })
  uploadSidebarLogo(@UploadedFile() file: UploadedMulterFile): BrandingSettings {
    return this.brandingService.saveUpload('sidebarLogo', file);
  }

  @Post('upload/login-logo')
  @RequireRole(ApiKeyRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload the login page logo' })
  uploadLoginLogo(@UploadedFile() file: UploadedMulterFile): BrandingSettings {
    return this.brandingService.saveUpload('loginLogo', file);
  }

  @Post('upload/favicon')
  @RequireRole(ApiKeyRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload the browser favicon' })
  uploadFavicon(@UploadedFile() file: UploadedMulterFile): BrandingSettings {
    return this.brandingService.saveUpload('favicon', file);
  }

  @Get('uploads/:filename')
  @Public()
  @ApiOperation({ summary: 'Serve an uploaded branding asset (public — logo/favicon must render pre-auth)' })
  getUpload(@Param('filename') filename: string, @Res() res: Response): void {
    if (!/^[a-zA-Z0-9_-]+\.(png|jpe?g|webp|svg)$/.test(filename)) {
      throw new BadRequestException('Invalid filename');
    }
    const ext = filename.slice(filename.lastIndexOf('.'));
    const contentType = UPLOAD_CONTENT_TYPES[ext];
    if (!contentType) throw new NotFoundException('Not found');

    const data = this.brandingService.readUpload(filename);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(data);
  }
}
