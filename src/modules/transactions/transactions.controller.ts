import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { RecordManualTransactionDto } from './dto/record-manual-transaction.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRolesGuard } from '../../common/guards/org-roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgRole } from '../../../generated/prisma/enums';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get(':transactionId')
  findOne(@Param('transactionId') transactionId: string) {
    return this.transactionsService.findOne(transactionId);
  }

  @Get()
  listForEvent(@Query('eventId') eventId: string) {
    return this.transactionsService.listForEvent(eventId);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Post('manual')
  recordManual(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordManualTransactionDto,
  ) {
    return this.transactionsService.recordManual(user.id, dto);
  }
}
