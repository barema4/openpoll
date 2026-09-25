import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlatformPayoutsService } from '../platform-payouts/platform-payouts.service';
import { SetMobileMoneyPayoutDto } from '../payouts/dto/set-mobile-money-payout.dto';
import { RequestPlatformWithdrawalDto } from '../platform-payouts/dto/request-platform-withdrawal.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformRolesGuard } from '../../common/guards/platform-roles.guard';
import { PlatformRoles } from '../../common/decorators/platform-roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformRole } from '../../../generated/prisma/enums';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

// The platform's own accumulated fee revenue, per PawaPay country — separate
// from every other withdrawal/payout route, which always pays out an
// organization's (or vendor's) money, never the platform's own cut. Owner-only:
// this moves the platform's own money, a materially different trust level
// than the view-only/support-lookup admin routes (STAFF+OWNER).
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformRolesGuard)
@PlatformRoles(PlatformRole.OWNER)
@Controller('admin/platform-payouts')
export class AdminPlatformPayoutsController {
  constructor(
    private readonly platformPayoutsService: PlatformPayoutsService,
  ) {}

  @Get('balances')
  listBalances() {
    return this.platformPayoutsService.listBalances();
  }

  @Get('withdrawals')
  listWithdrawals() {
    return this.platformPayoutsService.listWithdrawals();
  }

  @Put(':countryCode/destination')
  setDestination(
    @CurrentUser() user: AuthenticatedUser,
    @Param('countryCode') countryCode: string,
    @Body() dto: SetMobileMoneyPayoutDto,
  ) {
    return this.platformPayoutsService.setDestination(
      user.id,
      countryCode,
      dto,
    );
  }

  @Post(':countryCode/withdrawals')
  requestWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('countryCode') countryCode: string,
    @Body() dto: RequestPlatformWithdrawalDto,
  ) {
    return this.platformPayoutsService.requestWithdrawal(
      user.id,
      countryCode,
      dto.amount,
    );
  }
}
