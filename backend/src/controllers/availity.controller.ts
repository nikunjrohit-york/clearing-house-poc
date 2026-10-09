import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AvailityRestService } from '../availity-rest/availity-rest.service';
import { ClaimStatusQueryDto } from '../availity-rest/dto/claim-status-query.dto';
import { CoverageInquiryDto } from '../availity-rest/dto/coverage-inquiry.dto';
import { ClaimInputDto } from '../edi/dto/claim-input.dto';
import { X12BuilderService } from '../edi/x12-builder.service';
import { SftpPollerCron } from '../sftp/sftp-poller.cron';
import { SftpService } from '../sftp/sftp.service';

@Controller('api/availity')
export class AvailityController {
  constructor(
    private readonly restService: AvailityRestService,
    private readonly x12Builder: X12BuilderService,
    private readonly sftpService: SftpService,
    private readonly poller: SftpPollerCron,
  ) {}

  @Post('eligibility')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  checkEligibility(@Body() query: CoverageInquiryDto) {
    return this.restService.checkEligibility(query);
  }

  @Post('claim-status')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  submitClaimStatus(@Body() query: ClaimStatusQueryDto) {
    return this.restService.submitClaimStatus(query);
  }

  @Get('claim-status/:id')
  getClaimStatus(@Param('id') id: string) {
    return this.restService.getClaimStatus(id);
  }

  @Post('claims/validate')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async validateClaim(@Body() claim: ClaimInputDto) {
    const x12Payload = this.x12Builder.build837Claim(claim);
    const edits = await this.restService.validateClaimX12(x12Payload, claim.billingProvider.taxId, claim.tradingPartnerId);
    return {
      valid: edits.triggeredResult.length === 0,
      triggeredResult: edits.triggeredResult,
      transactionIdentifier: edits.transactionIdentifier,
      x12Payload,
    };
  }

  @Post('claims/batch-submit')
  @HttpCode(HttpStatus.ACCEPTED)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async submitBatchClaim(@Body() claim: ClaimInputDto) {
    const edi = this.x12Builder.build837Claim(claim);
    const interchangeControlNumber = this.interchangeControlNumber(edi);
    const fileName = `BATCH_${interchangeControlNumber}.txt`;
    const upload = await this.sftpService.uploadBatchFile(fileName, edi);
    return {
      ...upload,
      claimControlNumber: claim.claimControlNumber,
      interchangeControlNumber,
      statusUrl: `/api/availity/claims/batch-status/${encodeURIComponent(fileName)}`,
    };
  }

  @Get('claims/batch-status/:fileName')
  checkBatchStatus(@Param('fileName') fileName: string) {
    return this.sftpService.checkUploadNotification(fileName);
  }

  @Get('reports')
  listReports() {
    const reports = this.poller.getReports();
    return { count: reports.length, reports };
  }

  @Post('reports/poll')
  @HttpCode(HttpStatus.OK)
  async pollReports() {
    const polled = await this.poller.pollReceiveFiles();
    const reports = this.poller.getReports();
    return { polled: polled.length, count: reports.length, reports };
  }

  private interchangeControlNumber(edi: string): string {
    const isa = edi.split('~')[0] ?? '';
    const controlNumber = isa.split('*')[13] ?? '';
    if (!/^\d{9}$/.test(controlNumber)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Generated 837P is missing a 9-digit interchange control number',
          error: 'EDI error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return controlNumber;
  }
}
