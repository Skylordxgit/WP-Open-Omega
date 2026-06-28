import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength, Matches, MinLength } from 'class-validator';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export class CreateLabelDto {
  @ApiProperty({ description: 'Label name', example: 'VIP' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  @ApiPropertyOptional({ description: 'Hex color', example: '#18b561' })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, { message: 'color must be a hex color like #18b561' })
  color?: string;
}

export class UpdateLabelDto {
  @ApiPropertyOptional({ description: 'Label name' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ description: 'Hex color' })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, { message: 'color must be a hex color like #18b561' })
  color?: string;
}

export class AssignLabelDto {
  @ApiProperty({ description: 'Session id the chat belongs to' })
  @IsString()
  sessionId: string;

  @ApiProperty({ description: 'Chat id (JID)' })
  @IsString()
  chatId: string;

  @ApiProperty({ description: 'Label id to assign' })
  @IsString()
  labelId: string;
}
