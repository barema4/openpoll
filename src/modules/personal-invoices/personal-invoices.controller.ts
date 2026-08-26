import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PersonalInvoicesService } from './personal-invoices.service';
import { CreatePersonalInvoiceDto } from './dto/create-personal-invoice.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

// Not org-scoped — any logged-in user can create and manage their own
// personal invoices, whether or not they belong to an Organization.
@ApiTags('personal-invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('personal-invoices')
export class PersonalInvoicesController {
  constructor(
    private readonly personalInvoicesService: PersonalInvoicesService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePersonalInvoiceDto,
  ) {
    return this.personalInvoicesService.create(user.id, dto);
  }

  @Get()
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.personalInvoicesService.listForUser(user.id);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.personalInvoicesService.findOne(id, user.id);
  }

  @Get(':id/share')
  getShareLinks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.personalInvoicesService.getShareLinks(id, user.id);
  }
}
