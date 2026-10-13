import {
  Controller,
  Get,
  Param,
  Res,
  UseGuards,
  NotFoundException,
  ForbiddenException,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser } from '../common/types/auth.types';
import { isAdmin, isMaster } from '../common/utils/roles.util';
import { COVER_LETTER_UNAVAILABLE, usableCoverLetter } from '../deepseek/cover-letter';
import { documentAttachmentHeader, documentDownloadFilename } from './download-filename';
import { hasProfileIdentityConflict } from '../generations/profile-output';

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  @Get(':fileId/download')
  async download(
    @Param('fileId') fileId: string,
    @Req() req: { user: AuthUser },
    @Res() res: Response,
  ) {
    const file = await this.prisma.generationFile.findUnique({
      where: { id: fileId },
      include: {
        generation: {
          include: { application: true, creator: true },
        },
      },
    });
    if (!file) throw new NotFoundException('File not found');

    const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!isMaster(req.user.role) && (!user || !user.canDownloadDocuments)) {
      throw new ForbiddenException('You do not have permission to download documents');
    }

    const app = file.generation.application;
    if (!isMaster(req.user.role)) {
      if (isAdmin(req.user.role)) {
        const ok =
          app.bidderId === req.user.id ||
          (
            await this.prisma.user.findUnique({ where: { id: app.bidderId } })
          )?.managedByAdminId === req.user.id;
        if (!ok) throw new ForbiddenException('Access denied');
      } else if (app.bidderId !== req.user.id) {
        throw new ForbiddenException('Access denied');
      }
    }

    if (file.kind === 'COVER_LETTER' && !usableCoverLetter((file.generation.structuredOutputJson as { coverLetter?: unknown } | null)?.coverLetter)) {
      throw new BadRequestException(COVER_LETTER_UNAVAILABLE);
    }
    const snapshot = file.generation.profileSnapshotJson as { firstName?: string; lastName?: string } | null;
    if (hasProfileIdentityConflict(file.generation.structuredOutputJson as any, snapshot)) {
      throw new BadRequestException('This old file may contain another candidate’s identity. Export the document again from its preview to use the saved profile.');
    }
    const exists = await this.storage.fileExists(file.storagePath);
    if (!exists) throw new NotFoundException('File not found on disk');

    const content = await this.storage.readFile(file.storagePath);
    const mimeTypes: Record<string, string> = {
      PDF: 'application/pdf',
      DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      TXT: 'text/plain',
    };

    res.setHeader('Content-Type', mimeTypes[file.type] || 'application/octet-stream');
    const filename = documentDownloadFilename(
      file.generation.profileSnapshotJson, file.generation.structuredOutputJson, file.kind, file.type,
    );
    res.setHeader('Content-Disposition', documentAttachmentHeader(filename));
    res.send(content);
  }
}
