import { Module } from '@nestjs/common';
import { JobPoolController } from './job-pool.controller';
import { JobPoolService } from './job-pool.service';
import { ApplicationsModule } from '../applications/applications.module';
import { CompanyDiscoveryService } from './company-discovery.service';
import { JobrightBotController, JobrightBotWorkerController, JobrightWorkerGuard } from './jobright-bot.controller';
import { JobrightBotService } from './jobright-bot.service';

@Module({
  imports: [ApplicationsModule],
  controllers: [JobPoolController, JobrightBotController, JobrightBotWorkerController],
  providers: [JobPoolService, CompanyDiscoveryService, JobrightBotService, JobrightWorkerGuard],
})
export class JobPoolModule {}
