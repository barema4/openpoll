import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { AgencyClientsModule } from './modules/agency-clients/agency-clients.module';
import { BillingModule } from './modules/billing/billing.module';
import { StripeConnectModule } from './modules/stripe-connect/stripe-connect.module';
import { EventsModule } from './modules/events/events.module';
import { EventReportsModule } from './modules/event-reports/event-reports.module';
import { BudgetCategoriesModule } from './modules/budget-categories/budget-categories.module';
import { BudgetTemplatesModule } from './modules/budget-templates/budget-templates.module';
import { BudgetApprovalsModule } from './modules/budget-approvals/budget-approvals.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { DisbursementsModule } from './modules/disbursements/disbursements.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { PersonalInvoicesModule } from './modules/personal-invoices/personal-invoices.module';
import { UsersModule } from './modules/users/users.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { WithdrawalsModule } from './modules/withdrawals/withdrawals.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty' }
            : undefined,
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>('REDIS_URL') },
        // Jest runs each e2e spec file in its own process, but they all share
        // one Redis instance/DB — without a per-process key prefix, one test
        // file's BullMQ worker can dequeue and process another test file's
        // job, whose in-memory test doubles (e.g. FakePaymentProvider) know
        // nothing about it. Scope queue keys per-process in test only.
        prefix:
          config.get<string>('NODE_ENV') === 'test'
            ? `bull-test-${process.pid}`
            : undefined,
      }),
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    AgencyClientsModule,
    BillingModule,
    StripeConnectModule,
    EventsModule,
    EventReportsModule,
    BudgetCategoriesModule,
    BudgetTemplatesModule,
    BudgetApprovalsModule,
    VendorsModule,
    DisbursementsModule,
    InvoicesModule,
    PaymentsModule,
    TransactionsModule,
    PersonalInvoicesModule,
    UsersModule,
    PayoutsModule,
    WithdrawalsModule,
    ReconciliationModule,
    PlatformAdminModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
