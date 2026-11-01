import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AnswersService } from './answers.service';
@Processor('application-answers', { concurrency: 3 })
export class AnswerProcessor extends WorkerHost {
  constructor(private answers: AnswersService) { super(); }
  async process(job: Job<{ requestId: string }>) { await this.answers.processRequest(job.data.requestId); }
}
