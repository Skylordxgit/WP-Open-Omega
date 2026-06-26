import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength, Matches } from 'class-validator';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export class UpdateBrandingDto {
  @ApiPropertyOptional({ description: 'Application name shown in sidebar and browser tab' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  appName?: string;

  @ApiPropertyOptional({ description: 'Sidebar headline (defaults to appName when unset)' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  sidebarHeadline?: string;

  @ApiPropertyOptional({ description: 'Sidebar subtitle/tagline shown under the headline' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sidebarSubtitle?: string;

  @ApiPropertyOptional({ description: 'Login page title' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  loginTitle?: string;

  @ApiPropertyOptional({ description: 'Login page subtitle' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  loginSubtitle?: string;

  @ApiPropertyOptional({ description: 'Browser tab title' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  browserTitle?: string;

  @ApiPropertyOptional({ description: 'Primary brand color (hex, e.g. #18b561)' })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, { message: 'primaryColor must be a hex color like #18b561' })
  primaryColor?: string;

  @ApiPropertyOptional({ description: 'Accent brand color (hex, e.g. #21c77f)' })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, { message: 'accentColor must be a hex color like #21c77f' })
  accentColor?: string;
}

export interface BrandingSettings {
  appName: string;
  sidebarHeadline: string;
  sidebarSubtitle: string;
  loginTitle: string;
  loginSubtitle: string;
  browserTitle: string;
  primaryColor: string;
  accentColor: string;
  sidebarLogoUrl: string;
  loginLogoUrl: string;
  faviconUrl: string;
  updatedAt: string;
}
