import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../common/types/auth.types';
import { JobPoolService } from './job-pool.service';

@Controller('job-pool')
@UseGuards(JwtAuthGuard, RolesGuard)
export class JobPoolController {
  constructor(private service: JobPoolService) {}
  @Get()
  findAll(@Req() req: { user: AuthUser }, @Query() query: Record<string, string | undefined>) { return this.service.list(req.user, query); }

  @Get('updates')
  updates(@Req() req: { user: AuthUser }, @Query() query: Record<string, string | undefined>) { return this.service.updates(req.user, query); }

  @Get('manage')
  @Roles(UserRole.MASTER)
  manage(@Req() req: { user: AuthUser }, @Query('summary') summary?: string) { return this.service.manage(req.user, summary === '1'); }

  @Patch('manage')
  @Roles(UserRole.MASTER)
  settings(@Req() req: { user: AuthUser }, @Body() body: Record<string, unknown>) { return this.service.updateSettings(req.user, body); }

  @Post('sources')
  @Roles(UserRole.MASTER)
  addSource(@Req() req: { user: AuthUser }, @Body() body: Record<string, unknown>) { return this.service.addSource(req.user, body); }

  @Patch('sources/:id')
  @Roles(UserRole.MASTER)
  updateSource(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.updateSource(req.user, id, body); }

  @Post('sync')
  @Roles(UserRole.MASTER)
  sync(@Req() req: { user: AuthUser }, @Body() body: Record<string, unknown>) { return this.service.sync(req.user, body); }

  @Post()
  @Roles(UserRole.MASTER)
  addJob(@Req() req: { user: AuthUser }, @Body() body: Record<string, unknown>) { return this.service.addJob(req.user, body); }

  @Get('jobs/:id')
  detail(@Req() req: { user: AuthUser }, @Param('id') id: string) { return this.service.detail(id, req.user); }

  @Patch('jobs/:id')
  @Roles(UserRole.MASTER)
  hide(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.hide(req.user, id, body); }

  @Post('jobs/:id/apply')
  @Roles(UserRole.ADMIN, UserRole.BIDDER)
  apply(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.apply(req.user, id, body); }

  @Patch('jobs/:id/applied')
  markApplied(@Req() req: { user: AuthUser }, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.markApplied(req.user, id, body); }

  @Patch('jobs/:id/viewed')
  markViewed(@Req() req: { user: AuthUser }, @Param('id') id: string) { return this.service.markViewed(req.user, id); }
}
