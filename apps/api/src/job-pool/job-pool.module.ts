import { Module } from '@nestjs/common';
import { JobPoolController } from './job-pool.controller';
import { JobPoolService } from './job-pool.service';
import { ApplicationsModule } from '../applications/applications.module';

@Module({
  imports: [ApplicationsModule],
  controllers: [JobPoolController],
  providers: [JobPoolService],
})
export class JobPoolModule {}
