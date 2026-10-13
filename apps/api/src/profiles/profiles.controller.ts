import { Controller, Get, Post, Put, Patch, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../common/types/auth.types';

@Controller('profiles')
@UseGuards(JwtAuthGuard)
export class ProfilesController {
  constructor(private profilesService: ProfilesService) {}

  @Get()
  findAll(@Req() req: { user: AuthUser }) {
    return this.profilesService.findAll(req.user);
  }

  @Get('assigned')
  getAssigned(@Req() req: { user: AuthUser }) {
    return this.profilesService.getAssignedProfiles(req.user.id);
  }

  @Get('default')
  getDefault(@Req() req: { user: AuthUser }) {
    return this.profilesService.getDefaultProfile(req.user.id);
  }

  @Patch(':id/set-default')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.BIDDER)
  setDefault(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.profilesService.setDefaultProfile(id, req.user);
  }

  @Get(':id/prompt-assignments')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getPromptAssignments(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.profilesService.getProfilePromptAssignments(id, req.user);
  }

  @Put(':id/prompt-assignments')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  updatePromptAssignments(
    @Param('id') id: string,
    @Body()
    body: {
      promptVersionId?: string | null;
      assignments?: { userId: string; promptVersionId: string | null }[];
    },
    @Req() req: { user: AuthUser },
  ) {
    return this.profilesService.updateProfilePromptAssignments(
      id,
      body.assignments || [],
      req.user,
      body.promptVersionId,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.profilesService.findOne(id, req.user);
  }

  @Get(':id/generation-preference')
  generationPreference(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.profilesService.getGenerationPreference(id, req.user);
  }

  @Put(':id/generation-preference')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.BIDDER)
  saveGenerationPreference(@Param('id') id: string, @Req() req: { user: AuthUser }, @Body() body: { resumePromptId?: string | null; coverLetterPromptId?: string | null }) {
    return this.profilesService.saveGenerationPreference(id, req.user, body);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  create(@Body() body: Record<string, unknown>) {
    return this.profilesService.create(body);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.profilesService.update(id, body);
  }

  @Patch(':id/archive')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  archive(@Param('id') id: string) {
    return this.profilesService.archive(id);
  }

  @Post(':id/clone')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  clone(@Param('id') id: string) {
    return this.profilesService.clone(id);
  }
}
