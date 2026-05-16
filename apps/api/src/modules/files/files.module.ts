import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FilesDownloadService } from './files-download.service';
import { UsersModule } from '../users/users.module';
import { FoldersModule } from '../folders/folders.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [UsersModule, FoldersModule, AuditModule],
  controllers: [FilesController],
  providers: [FilesService, FilesDownloadService],
  exports: [FilesService, FilesDownloadService],
})
export class FilesModule {}
