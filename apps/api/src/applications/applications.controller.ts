import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApplicationStatus, WorkArrangement } from '@prisma/client';
import { AuthUser } from '../common/types/auth.types';

@Controller('applications')
@UseGuards(JwtAuthGuard)
export class ApplicationsController {
  constructor(private applicationsService: ApplicationsService) {}

  @Get()
  findAll(
    @Req() req: { user: AuthUser },
    @Query('status') status?: ApplicationStatus,
    @Query('profileId') profileId?: string,
    @Query('q') q?: string,
    @Query('scope') scope?: 'mine' | 'team',
    @Query('limit') limit?: string,
  ) {
    return this.applicationsService.findAll(req.user, { status, profileId, q, scope, limit: limit ? Number(limit) : undefined });
  }

  @Get('page')
  page(@Req() req: { user: AuthUser }, @Query() query: Record<string,string|undefined>) {
    return this.applicationsService.page(req.user, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.applicationsService.findOne(id, req.user);
  }

  @Post()
  create(@Body() body: Record<string, unknown>, @Req() req: { user: AuthUser }) {
    return this.applicationsService.create(body, req.user);
  }

  @Post('validate')
  validateDraft(@Body() body: Record<string, unknown>, @Req() req: { user: AuthUser }) {
    return this.applicationsService.validateDraft(body, req.user);
  }

  @Patch('warnings/:warningId/acknowledge')
  acknowledgeWarning(
    @Param('warningId') warningId: string,
    @Body('reason') reason: string,
    @Req() req: { user: AuthUser },
  ) {
    return this.applicationsService.acknowledgeWarning(warningId, req.user, reason);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: ApplicationStatus; note?: string },
    @Req() req: { user: AuthUser },
  ) {
    return this.applicationsService.updateStatus(id, body.status, req.user, body.note);
  }

  @Post(':id/notes')
  addNote(
    @Param('id') id: string,
    @Body('content') content: string,
    @Req() req: { user: AuthUser },
  ) {
    return this.applicationsService.addNote(id, content, req.user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      profileId?: string;
      jobTitle?: string;
      company?: string;
      location?: string;
      workArrangement?: WorkArrangement;
      source?: string;
      jobUrl?: string | null;
      jobDescription?: string;
    },
    @Req() req: { user: AuthUser },
  ) {
    return this.applicationsService.update(id, body, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.applicationsService.remove(id, req.user);
  }
}
