import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

// There is no multi-admin/role system in this app — the sole operator is
// identified by a single configured email rather than a new role. Stacked
// after JwtAuthGuard, so request.user is already a real authenticated user;
// this just narrows further to "and it's specifically the operator."
@Injectable()
export class PlatformOperatorGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const operatorEmail = this.config.get<string>('PLATFORM_OPERATOR_EMAIL');

    // Unset means deny everyone — fail closed, not open.
    if (
      !operatorEmail ||
      request.user?.email.toLowerCase() !== operatorEmail.toLowerCase()
    ) {
      throw new ForbiddenException('Not authorized for this route');
    }

    return true;
  }
}
