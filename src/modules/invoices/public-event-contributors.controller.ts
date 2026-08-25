import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';
import { CreatePledgeDto } from './dto/create-pledge.dto';

// Unauthenticated, event-scoped (event UUIDs aren't secret the way an
// invoice secureToken is — this is the public "contribute to this event"
// entry point, distinct from PublicInvoicesController's token lookup).
@ApiTags('public')
@Controller('public/events/:eventId')
export class PublicEventContributorsController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post('pledges')
  createPledge(
    @Param('eventId') eventId: string,
    @Body() dto: CreatePledgeDto,
  ) {
    return this.invoicesService.createPledge(eventId, dto);
  }

  // Redacted (no phone numbers) — a public "who's contributed" board.
  @Get('contributors')
  getContributors(@Param('eventId') eventId: string) {
    return this.invoicesService.getContributorSummary(eventId, {
      includePhone: false,
    });
  }
}
