import { IsOptional, IsString } from 'class-validator';

export class AssignOmegaSessionDto {
  @IsString()
  sessionId: string;

  @IsOptional()
  @IsString()
  clientId?: string | null;
}
