import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';

class ButtonOptionDto {
  @ApiProperty({
    description: 'Stable button identifier returned in WhatsApp replies',
    example: 'order_track',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  id: string;

  @ApiProperty({
    description: 'Visible button label',
    example: 'Track order',
    maxLength: 40,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  text: string;
}

export class SendButtonsMessageDto {
  @ApiProperty({
    description: 'WhatsApp chat ID (native to the active engine)',
    example: '628123456789@c.us',
  })
  @IsString()
  @IsNotEmpty()
  chatId: string;

  @ApiProperty({
    description: 'Text shown above the reply buttons',
    example: 'Your order is ready. Choose an option below.',
    maxLength: 4096,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  text: string;

  @ApiProperty({
    description: 'One to three reply buttons',
    type: [ButtonOptionDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ButtonOptionDto)
  buttons: ButtonOptionDto[];
}
