import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReconciliationService } from './reconciliation.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformRolesGuard } from '../../common/guards/platform-roles.guard';
import { PlatformRoles } from '../../common/decorators/platform-roles.decorator';
import { PlatformRole } from '../../../generated/prisma/enums';

@ApiTags('reconciliation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformRolesGuard)
@PlatformRoles(PlatformRole.OWNER, PlatformRole.STAFF)
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get()
  check() {
    return this.reconciliationService.check();
  }
}
