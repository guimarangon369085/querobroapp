import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module.js';
import { BomController } from './bom.controller.js';
import { BomService } from './bom.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [BomController],
  providers: [BomService]
})
export class BomModule {}
