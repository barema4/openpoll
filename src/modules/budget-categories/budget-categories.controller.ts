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
import { BudgetCategoriesService } from './budget-categories.service';
import { CreateBudgetCategoryDto } from './dto/create-budget-category.dto';
import { AllocateTransactionDto } from './dto/allocate-transaction.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRolesGuard } from '../../common/guards/org-roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgRole } from '../../../generated/prisma/enums';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

@ApiTags('budget-categories')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('budget-categories')
export class BudgetCategoriesController {
  constructor(
    private readonly budgetCategoriesService: BudgetCategoriesService,
  ) {}

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBudgetCategoryDto,
  ) {
    return this.budgetCategoriesService.create(user.id, dto);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
  @Get(':budgetCategoryId')
  findOne(@Param('budgetCategoryId') budgetCategoryId: string) {
    return this.budgetCategoriesService.findOne(budgetCategoryId);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
  @Get()
  listForEvent(@Query('eventId') eventId: string) {
    return this.budgetCategoriesService.listForEvent(eventId);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Post(':budgetCategoryId/allocate')
  allocate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('budgetCategoryId') budgetCategoryId: string,
    @Body() dto: AllocateTransactionDto,
  ) {
    return this.budgetCategoriesService.allocate(
      user.id,
      budgetCategoryId,
      dto,
    );
  }
}
