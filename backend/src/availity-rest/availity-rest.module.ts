import { Global, Module } from '@nestjs/common';
import { AvailityRestService } from './availity-rest.service';

@Global()
@Module({
  providers: [AvailityRestService],
  exports: [AvailityRestService],
})
export class AvailityRestModule {}