import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [DashboardController],
  providers: [DashboardService]
})
export class DashboardModule {}
