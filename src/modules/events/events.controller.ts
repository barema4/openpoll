import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { CreateQuickEventDto } from './dto/create-quick-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { UpdateEventStatusDto } from './dto/update-event-status.dto';
import { SetPayoutDto } from '../payouts/dto/set-payout.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRolesGuard } from '../../common/guards/org-roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrgRole } from '../../../generated/prisma/enums';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

@ApiTags('events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEventDto) {
    return this.eventsService.create(user.id, dto);
  }

  // No @Roles() — there's no organization to check membership against yet,
  // that's the whole point. Any logged-in user can start a quick collection.
  @Post('quick')
  createQuick(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateQuickEventDto,
  ) {
    return this.eventsService.createQuick(user.id, dto);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
  @Get(':eventId')
  findOne(@Param('eventId') eventId: string) {
    return this.eventsService.findOne(eventId);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
  @Get()
  listForOrganization(@Query('organizationId') organizationId: string) {
    return this.eventsService.listForOrganization(organizationId);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Patch(':eventId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.update(user.id, eventId, dto);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Patch(':eventId/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Body() dto: UpdateEventStatusDto,
  ) {
    return this.eventsService.updateStatus(user.id, eventId, dto.status);
  }

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER)
  @Patch(':eventId/payout')
  setPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Body() dto: SetPayoutDto,
  ) {
    return this.eventsService.setPayout(user.id, eventId, dto);
  }
}
