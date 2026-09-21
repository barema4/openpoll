import { Module } from '@nestjs/common';
import { EventReportsService } from './event-reports.service';
import { EventReportsController } from './event-reports.controller';

@Module({
  controllers: [EventReportsController],
  providers: [EventReportsService],
})
export class EventReportsModule {}
