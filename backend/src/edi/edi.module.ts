import { Module } from '@nestjs/common';
import { EdiParserService } from './edi-parser.service';
import { X12BuilderService } from './x12-builder.service';

@Module({
  providers: [X12BuilderService, EdiParserService],
  exports: [X12BuilderService, EdiParserService],
})
export class EdiModule {}
