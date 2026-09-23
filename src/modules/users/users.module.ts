import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PayoutsModule } from '../payouts/payouts.module';
import { StripeConnectModule } from '../stripe-connect/stripe-connect.module';

@Module({
  imports: [PayoutsModule, StripeConnectModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
