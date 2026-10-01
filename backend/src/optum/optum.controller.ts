import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { RcmWorkflowService } from './rcm-workflow.service';

@Controller('api/optum')
export class OptumController {
  constructor(private readonly workflow: RcmWorkflowService) {}

  @Post('eligibility')
  @HttpCode(HttpStatus.OK)
  eligibility(@Body() body: Record<string, unknown>) {
    return this.workflow.checkEligibility(body);
  }

  @Post('claims/validation')
  @HttpCode(HttpStatus.OK)
  validation(@Body() body: Record<string, unknown>) {
    return this.workflow.validateProfessionalClaim(body);
  }

  @Post('claims/submission')
  @HttpCode(HttpStatus.OK)
  submission(@Body() body: Record<string, unknown>) {
    return this.workflow.submitProfessionalClaim(body);
  }

  @Post('claim-status')
  @HttpCode(HttpStatus.OK)
  claimStatus(@Body() body: Record<string, unknown>) {
    return this.workflow.queryClaimStatus(body);
  }

  @Get('reports')
  reports() {
    return this.workflow.listReports();
  }

  @Get('reports/:reportId/277')
  report277(@Param('reportId') reportId: string) {
    return this.workflow.fetch277(reportId);
  }

  @Get('reports/:reportId/835')
  report835(@Param('reportId') reportId: string) {
    return this.workflow.fetch835(reportId);
  }
}
