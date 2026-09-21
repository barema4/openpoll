import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EventReportsService } from './event-reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRolesGuard } from '../../common/guards/org-roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrgRole } from '../../../generated/prisma/enums';

@ApiTags('event-reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('events/:eventId/reports')
export class EventReportsController {
  constructor(private readonly eventReports: EventReportsService) {}

  @Roles(OrgRole.MAIN_ORGANIZER, OrgRole.TREASURER, OrgRole.AUDITOR)
  @Get('closeout')
  async closeout(@Param('eventId') eventId: string, @Res() res: Response) {
    const { filename, csv } =
      await this.eventReports.generateCloseoutCsv(eventId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
