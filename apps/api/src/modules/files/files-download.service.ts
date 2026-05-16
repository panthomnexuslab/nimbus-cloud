import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, FileStatus, type File } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AppConfigService } from '../../config/app-config.service';
import type { ClientContext } from '../../common/decorators/client-context.decorator';

/**
 * Generates short-lived signed download URLs and records a download
 * audit row. Streaming/HLS playback for video uses the same signed URL
 * scheme but with `Range` requests handed straight to the storage
 * driver — no server-side proxying required.
 */
@Injectable()
export class FilesDownloadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly cfg: AppConfigService,
  ) {}

  async signDownloadUrl(args: {
    userId: string;
    fileId: string;
    asAttachment?: boolean;
    client?: ClientContext;
  }) {
    const file = await this.requireDownloadable(args.userId, args.fileId);
    const driver = this.storage.driverFor(file.storageDriver);
    const url = await driver.signGetUrl({
      bucket: file.storageBucket,
      key: file.storageKey,
      expiresInSeconds: this.cfg.downloadUrlTtl,
      responseContentType: file.mimeType,
      responseContentDisposition: this.buildContentDisposition(
        file.name,
        args.asAttachment ?? false,
      ),
    });
    await this.audit.append({
      userId: args.userId,
      action: AuditAction.FILE_DOWNLOADED,
      resource: `file:${file.id}`,
      client: args.client,
    });
    return { url, expiresInSeconds: this.cfg.downloadUrlTtl };
  }

  /**
   * RFC 6266 `Content-Disposition`. We always set the filename* parameter so
   * non-ASCII names survive round-trips through the storage provider.
   */
  private buildContentDisposition(filename: string, asAttachment: boolean): string {
    const sanitized = filename.replace(/[\\"]/g, '_');
    const encoded = encodeURIComponent(filename);
    const directive = asAttachment ? 'attachment' : 'inline';
    return `${directive}; filename="${sanitized}"; filename*=UTF-8''${encoded}`;
  }

  private async requireDownloadable(userId: string, fileId: string): Promise<File> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file || file.deletedAt) throw new NotFoundException();
    if (file.ownerId !== userId) {
      throw new ForbiddenException({ code: 'NOT_OWNER', message: 'Not authorized' });
    }
    if (file.status !== FileStatus.CLEAN) {
      throw new ForbiddenException({
        code: 'FILE_NOT_READY',
        message: `File is not ready for download (status=${file.status})`,
      });
    }
    return file;
  }
}
