import { Module } from '@nestjs/common';
import { AvailityRestModule } from './availity-rest/availity-rest.module';
import { AvailityConfigModule } from './config/availity.config';
import { AvailityController } from './controllers/availity.controller';
import { EdiModule } from './edi/edi.module';
import { OptumModule } from './optum/optum.module';
import { SftpModule } from './sftp/sftp.module';

@Module({
  imports: [AvailityConfigModule, AvailityRestModule, EdiModule, SftpModule, OptumModule],
  controllers: [AvailityController],
})
export class AppModule {}

