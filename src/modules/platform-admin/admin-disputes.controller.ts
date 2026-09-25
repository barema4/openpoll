import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TransactionsService } from '../transactions/transactions.service';
import { AdminListDisputesQueryDto } from '../transactions/dto/admin-list-disputes-query.dto';
import { UpdateDisputeStatusDto } from '../transactions/dto/update-dispute-status.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformRolesGuard } from '../../common/guards/platform-roles.guard';
import { PlatformRoles } from '../../common/decorators/platform-roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformRole } from '../../../generated/prisma/enums';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

// Platform-wide dispute lookup + manual status override for staff support.
// Disputes have no per-org route of their own today (they're only visible
// nested under a transaction) — this is their first dedicated listing.
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformRolesGuard)
@PlatformRoles(PlatformRole.OWNER, PlatformRole.STAFF)
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  list(@Query() query: AdminListDisputesQueryDto) {
    return this.transactionsService.listDisputesForAdmin(query);
  }

  @Patch(':disputeId/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('disputeId') disputeId: string,
    @Body() dto: UpdateDisputeStatusDto,
  ) {
    return this.transactionsService.updateDisputeStatus(
      user.id,
      disputeId,
      dto,
    );
  }
}
