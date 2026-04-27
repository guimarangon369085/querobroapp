import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { DashboardController } from './dashboard.controller.js';
import { BankStatementsService } from './bank-statements.service.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [PrismaModule, PaymentsModule],
  controllers: [DashboardController],
  providers: [DashboardService, BankStatementsService]
})
export class DashboardModule {}
