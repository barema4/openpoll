import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TransactionsService } from '../transactions/transactions.service';
import { AdminListTransactionsQueryDto } from '../transactions/dto/admin-list-transactions-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformRolesGuard } from '../../common/guards/platform-roles.guard';
import { PlatformRoles } from '../../common/decorators/platform-roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformRole } from '../../../generated/prisma/enums';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

// Platform-wide transaction lookup + manual refund trigger for staff
// support — separate from TransactionsController, which is always
// event/org-scoped. refund() itself is untouched; only the access path
// (platform role instead of org membership) differs from the org route.
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformRolesGuard)
@PlatformRoles(PlatformRole.OWNER, PlatformRole.STAFF)
@Controller('admin/transactions')
export class AdminTransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  list(@Query() query: AdminListTransactionsQueryDto) {
    return this.transactionsService.listAllForAdmin(query);
  }

  @Post(':transactionId/refund')
  refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('transactionId') transactionId: string,
  ) {
    return this.transactionsService.refund(user.id, transactionId);
  }
}
