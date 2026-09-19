import { Module } from '@nestjs/common';
import { AgencyClientsService } from './agency-clients.service';
import { AgencyClientsController } from './agency-clients.controller';

@Module({
  controllers: [AgencyClientsController],
  providers: [AgencyClientsService],
  exports: [AgencyClientsService],
})
export class AgencyClientsModule {}
