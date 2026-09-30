import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { EdiModule } from '../edi/edi.module';
import { SftpPollerCron } from './sftp-poller.cron';
import { SftpService } from './sftp.service';

@Module({
  imports: [ScheduleModule.forRoot(), EdiModule],
  providers: [SftpService, SftpPollerCron],
  exports: [SftpService, SftpPollerCron],
})
export class SftpModule {}
