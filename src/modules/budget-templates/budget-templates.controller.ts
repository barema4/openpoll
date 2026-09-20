import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BudgetTemplatesService } from './budget-templates.service';
import { CreateBudgetTemplateDto } from './dto/create-budget-template.dto';
import { SaveTemplateFromEventDto } from './dto/save-template-from-event.dto';
import { ApplyTemplateDto } from './dto/apply-template.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRolesGuard } from '../../common/guards/org-roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgRole } from '../../../generated/prisma/enums';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

@ApiTags('budget-templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('budget-templates')
export class BudgetTemplatesController {
  constructor(private readonly budgetTemplates: BudgetTemplatesService) {}

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Post()
  create(@Body() dto: CreateBudgetTemplateDto) {
    return this.budgetTemplates.create(dto);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Post('from-event')
  createFromEvent(@Body() dto: SaveTemplateFromEventDto) {
    return this.budgetTemplates.createFromEvent(dto);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
  @Get()
  listForOrganization(@Query('organizationId') organizationId: string) {
    return this.budgetTemplates.listForOrganization(organizationId);
  }

  // :budgetTemplateId resolves the organization via OrgRolesGuard's
  // budgetTemplateId branch (mirrors the vendorId branch), since there's
  // no organizationId/eventId in this request to resolve against instead.
  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Delete(':budgetTemplateId')
  remove(@Param('budgetTemplateId') budgetTemplateId: string) {
    return this.budgetTemplates.remove(budgetTemplateId);
  }

  // eventId in the body resolves the organization here (checked ahead of
  // budgetTemplateId in the guard's priority order) — applying a template
  // is authorized against the target event's org, not the template's own.
  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Post(':budgetTemplateId/apply')
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('budgetTemplateId') budgetTemplateId: string,
    @Body() dto: ApplyTemplateDto,
  ) {
    return this.budgetTemplates.apply(user.id, budgetTemplateId, dto);
  }
}
