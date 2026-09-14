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
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { ListInvoicesQueryDto } from './dto/list-invoices-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRolesGuard } from '../../common/guards/org-roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgRole } from '../../../generated/prisma/enums';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

@ApiTags('invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoicesService.create(user.id, dto);
  }

  // Registered before ':invoiceId' — otherwise Express would match
  // "contributors"/"primary" as an invoiceId param instead of these static
  // routes.
  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
  @Get('contributors')
  getContributors(@Query('eventId') eventId: string) {
    return this.invoicesService.getContributorSummary(eventId, {
      includePhone: true,
    });
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
  @Get('primary')
  getPrimaryLink(@Query('eventId') eventId: string) {
    return this.invoicesService.getPrimaryLink(eventId);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
  @Get(':invoiceId')
  findOne(@Param('invoiceId') invoiceId: string) {
    return this.invoicesService.findOne(invoiceId);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
  @Get(':invoiceId/share')
  getShareLinks(@Param('invoiceId') invoiceId: string) {
    return this.invoicesService.getShareLinks(invoiceId);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
  @Get()
  listForEvent(@Query() query: ListInvoicesQueryDto) {
    return this.invoicesService.listForEvent(query);
  }
}
