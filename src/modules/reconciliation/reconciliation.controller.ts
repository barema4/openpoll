import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReconciliationService } from './reconciliation.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformOperatorGuard } from '../../common/guards/platform-operator.guard';

@ApiTags('reconciliation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformOperatorGuard)
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliationService: ReconciliationService) {}

  @Get()
  check() {
    return this.reconciliationService.check();
  }
}
