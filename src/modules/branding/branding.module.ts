import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';

@Module({
  imports: [MulterModule.register({ limits: { fileSize: 2 * 1024 * 1024 } })],
  controllers: [BrandingController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
