import { Module, Global } from '@nestjs/common';
import { AvailityRestService } from './availity-rest.service';
import { AvailityConfigModule } from '../config/availity.config';

@Global()
@Module({
  imports: [AvailityConfigModule],
  providers: [AvailityRestService],
  exports: [AvailityRestService],
})
export class AvailityRestModule {}