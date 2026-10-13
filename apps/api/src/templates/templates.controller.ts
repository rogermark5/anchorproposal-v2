import { Controller, Get, Post, Put, Patch, Body, Param, UseGuards, Req } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../common/types/auth.types';

@Controller('templates')
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private templatesService: TemplatesService) {}

  @Get()
  findAll(@Req() req: { user: AuthUser }) {
    return this.templatesService.findAllForUser(req.user);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  create(@Body() body: { name: string; preset?: string; configJson?: object }) {
    return this.templatesService.create(body);
  }

  @Post('preview')
  previewConfig(@Body() body: { configJson?: object }) {
    return {
      html: this.templatesService.renderPreviewHtml(
        this.templatesService.getSamplePreviewContent(),
        body?.configJson ?? {},
      ),
    };
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.templatesService.checkAccess(id, req.user);
  }

  @Get(':id/preview')
  async preview(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    const template = await this.templatesService.checkAccess(id, req.user);
    return {
      html: this.templatesService.renderPreviewHtml(
        this.templatesService.getSamplePreviewContent(),
        template.configJson as object,
      ),
    };
  }

  @Post(':id/preview')
  async previewDraft(
    @Param('id') id: string,
    @Body() body: { configJson?: object },
    @Req() req: { user: AuthUser },
  ) {
    const template = await this.templatesService.checkAccess(id, req.user);
    const config = body?.configJson ?? (template.configJson as object);
    return {
      html: this.templatesService.renderPreviewHtml(
        this.templatesService.getSamplePreviewContent(),
        config,
      ),
    };
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: { name?: string; configJson?: object }, @Req() req: { user: AuthUser }) {
    return this.templatesService.customize(id, req.user, body);
  }

  @Patch(':id/set-default')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.BIDDER)
  setDefault(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.templatesService.setDefaultTemplate(id, req.user);
  }

  @Patch(':id/publish')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  publish(@Param('id') id: string) {
    return this.templatesService.publish(id);
  }

  @Patch(':id/archive')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  archive(@Param('id') id: string) {
    return this.templatesService.archive(id);
  }

  @Post(':id/clone')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  clone(@Param('id') id: string) {
    return this.templatesService.clone(id);
  }
}
