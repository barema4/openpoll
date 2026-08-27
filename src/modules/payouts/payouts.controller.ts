import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PayoutsService } from './payouts.service';
import { ResolveAccountDto } from './dto/resolve-account.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

// Shared, un-scoped utility endpoints backing every "set up your payout bank
// account" form (user, organization, event) — just login required, since
// looking up banks or resolving an account name isn't itself a privileged act.
@ApiTags('payouts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Get('banks')
  listBanks() {
    return this.payoutsService.listBanks();
  }

  @Post('resolve-account')
  resolveAccount(@Body() dto: ResolveAccountDto) {
    return this.payoutsService.resolveAccount(dto.bankCode, dto.accountNumber);
  }
}
