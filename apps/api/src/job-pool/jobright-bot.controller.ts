import { Body, CanActivate, Controller, ExecutionContext, Get, Injectable, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Public, Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth.types';
import { JobrightBotService } from './jobright-bot.service';

@Controller('job-pool/jobright-bot')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MASTER)
export class JobrightBotController {
  constructor(private service: JobrightBotService) {}
  @Get() status(@Req() req: { user: AuthUser }) { return this.service.status(req.user); }
  @Patch() settings(@Req() req: { user: AuthUser }, @Body() body: Record<string, unknown>) { return this.service.settings(req.user, body); }
  @Post('key') key(@Req() req: { user: AuthUser }) { return this.service.rotateKey(req.user); }
  @Post('command') command(@Req() req: { user: AuthUser }, @Body('action') action: unknown) { return this.service.command(req.user, action); }
}
@Injectable()
export class JobrightWorkerGuard implements CanActivate {
  constructor(private service: JobrightBotService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest(); req.workerDigest = await this.service.authenticate(req.headers.authorization); return true;
  }
}
@Public()
@Controller('job-pool/jobright-bot/worker')
@UseGuards(JobrightWorkerGuard)
export class JobrightBotWorkerController {
  constructor(private service: JobrightBotService) {}
  @Get() config(@Req() req: { workerDigest: string }, @Query('instanceId') id: string) { return this.service.workerConfig(req.workerDigest, id); }
  @Post('heartbeat') heartbeat(@Req() req: { workerDigest: string }, @Body() body: Record<string, unknown>) { return this.service.heartbeat(req.workerDigest, body); }
  @Post('jobs') jobs(@Req() req: { workerDigest: string }, @Body() body: Record<string, unknown>) { return this.service.ingest(req.workerDigest, body); }
}
