import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength, IsUrl, ValidateIf } from 'class-validator';

const NAME_MAX_LENGTH = 100;
const BODY_MAX_LENGTH = 4096;
const HEADER_FOOTER_MAX_LENGTH = 1024;
const BUTTON_LABEL_MAX_LENGTH = 40;

export class CreateTemplateDto {
  @ApiProperty({
    description: 'Unique template name within the session',
    example: 'order-confirmation',
    maxLength: NAME_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({
    description: 'Template body with {{variable}} placeholders',
    example: 'Hi {{customer}}, your order {{orderId}} has shipped.',
    maxLength: BODY_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(BODY_MAX_LENGTH)
  body: string;

  @ApiPropertyOptional({
    description: 'Optional header text, prepended to the rendered body',
    example: 'OpenWA Store',
    maxLength: HEADER_FOOTER_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(HEADER_FOOTER_MAX_LENGTH)
  header?: string;

  @ApiPropertyOptional({
    description: 'Optional footer text, appended to the rendered body',
    example: 'Reply STOP to unsubscribe.',
    maxLength: HEADER_FOOTER_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(HEADER_FOOTER_MAX_LENGTH)
  footer?: string;

  @ApiPropertyOptional({
    description: 'Optional CTA button label for dashboard preview and future interactive sends',
    example: 'Try now',
    maxLength: BUTTON_LABEL_MAX_LENGTH,
  })
  @ValidateIf((o: CreateTemplateDto) => !!o.buttonUrl || !!o.buttonLabel)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUTTON_LABEL_MAX_LENGTH)
  buttonLabel?: string;

  @ApiPropertyOptional({
    description: 'Optional CTA button target URL',
    example: 'https://example.com/orders',
  })
  @ValidateIf((o: CreateTemplateDto) => !!o.buttonUrl || !!o.buttonLabel)
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false, require_protocol: true })
  buttonUrl?: string;
}

export class UpdateTemplateDto {
  @ApiPropertyOptional({ description: 'Template name', maxLength: NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ description: 'Template body with {{variable}} placeholders', maxLength: BODY_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(BODY_MAX_LENGTH)
  body?: string;

  @ApiPropertyOptional({ description: 'Optional header text', maxLength: HEADER_FOOTER_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(HEADER_FOOTER_MAX_LENGTH)
  header?: string;

  @ApiPropertyOptional({ description: 'Optional footer text', maxLength: HEADER_FOOTER_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(HEADER_FOOTER_MAX_LENGTH)
  footer?: string;

  @ApiPropertyOptional({ description: 'Optional CTA button label', maxLength: BUTTON_LABEL_MAX_LENGTH })
  @ValidateIf((o: UpdateTemplateDto) => o.buttonLabel !== undefined || o.buttonUrl !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BUTTON_LABEL_MAX_LENGTH)
  buttonLabel?: string;

  @ApiPropertyOptional({ description: 'Optional CTA button target URL' })
  @ValidateIf((o: UpdateTemplateDto) => o.buttonLabel !== undefined || o.buttonUrl !== undefined)
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_tld: false, require_protocol: true })
  buttonUrl?: string;
}

export class TemplateResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  sessionId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  body: string;

  @ApiPropertyOptional({ nullable: true })
  header?: string | null;

  @ApiPropertyOptional({ nullable: true })
  footer?: string | null;

  @ApiPropertyOptional({ nullable: true })
  buttonLabel?: string | null;

  @ApiPropertyOptional({ nullable: true })
  buttonUrl?: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
