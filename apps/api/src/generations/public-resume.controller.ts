import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GenerationsService } from './generations.service';
import { Public } from '../common/decorators/roles.decorator';

@Controller('public/resumes')
export class PublicResumeController {
  constructor(private generations: GenerationsService) {}
  @Public()
  @Get(':token')
  async view(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
    return this.generations.publicResume(token);
  }
}
