import { Module } from '@nestjs/common';
import { OptumApiClient } from './optum-api.client';
import { OptumAuthService } from './optum-auth.service';
import { OptumController } from './optum.controller';
import { RcmWorkflowService } from './rcm-workflow.service';

@Module({
  controllers: [OptumController],
  providers: [OptumAuthService, OptumApiClient, RcmWorkflowService],
})
export class OptumModule {}
