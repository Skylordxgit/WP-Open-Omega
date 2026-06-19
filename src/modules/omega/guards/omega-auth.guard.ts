import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { OmegaAuthService } from '../omega-auth.service';

@Injectable()
export class OmegaAuthGuard implements CanActivate {
  constructor(private readonly omegaAuthService: OmegaAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { omegaUser?: unknown; omegaToken?: string }>();
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;

    if (!token) {
      throw new UnauthorizedException('Omega admin token is required');
    }

    const session = await this.omegaAuthService.validateSessionToken(token);
    request.omegaUser = session.user;
    request.omegaToken = token;
    return true;
  }
}
