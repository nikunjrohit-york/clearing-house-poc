import { Injectable, Logger } from '@nestjs/common';

export type ClaimStatusCode = 'A' | 'R' | 'U';
export type PipeReportType = 'IBR' | 'IBRP' | 'EBR' | 'DPR' | 'PIPE';

export interface ClaimNote {
  initiator: string;
  code: string;
  message: string;
  loop?: string;
  segment?: string;
  element?: string;
}

export interface PipeClaim {
  patientName: string;
  dateOfService: string;
  patientControlNumber: string;
  chargeAmount?: number;
  providerNpi?: string;
  status: ClaimStatusCode;
  statusDescription: string;
  errors: ClaimNote[];
  warnings: ClaimNote[];
  adjudications: ClaimNote[];
  cleanNotes: ClaimNote[];
}

export interface PipeDelimitedReport {
  reportType: PipeReportType;
  fileName?: string;
  header: {
    dateTime: string;
    batchId: string;
    fileControlNumber: string;
    totalSubmitted: number;
    totalAccepted: number;
    totalRejected: number;
  };
  payer?: {
    payerId: string;
    payerName: string;
  };
  claims: PipeClaim[];
  unassignedNotes: ClaimNote[];
  summary: {
    totalSubmitted: number;
    totalAccepted: number;
    totalRejected: number;
    acceptanceRate: string;
    totalErrors: number;
    totalWarnings: number;
  };
  rowErrors: string[];
}

export interface SegmentError {
  segmentId: string;
  segmentPosition: string;
  loopId?: string;
  errorCode: string;
  errorDescription: string;
}

export interface ElementError {
  elementPosition: string;
  dataElementRefNumber?: string;
  errorCode: string;
  badData?: string;
  errorDescription: string;
}

export interface AcknowledgmentTransaction {
  transactionSetId: string;
  controlNumber: string;
  implementationRef?: string;
  status?: string;
  statusDescription?: string;
  segmentErrors: SegmentError[];
  elementErrors: ElementError[];
}

export interface Acknowledgment999 {
  reportType: '999';
  fileName?: string;
  functionalGroup: {
    functionalId: string;
    groupControlNumber: string;
    version: string;
  };
  transactions: AcknowledgmentTransaction[];
  groupAcknowledgment: {
    status: string;
    statusDescription: string;
    includedSets: number;
    receivedSets: number;
    acceptedSets: number;
  errorCodes: string[];
  originalInterchangeControlNumber?: string;
};
  rowErrors: string[];
}

export interface UnknownReport {
  reportType: 'UNKNOWN';
  fileName?: string;
  rowErrors: string[];
}

export interface Ta1Report {
  reportType: 'TA1';
  fileName?: string;
  interchangeControlNumber: string;
  acknowledgmentCode: string;
  noteCode: string;
  rowErrors: string[];
}

export type ParsedEdiReport = PipeDelimitedReport | Acknowledgment999 | Ta1Report | UnknownReport;

export interface ReportSummary {
  reportType: string;
  batchId?: string;
  fileControlNumber?: string;
  functionalId?: string;
  groupControlNumber?: string;
  status?: string;
  statusDescription?: string;
  totalSubmitted?: number;
  totalAccepted?: number;
  totalRejected?: number;
  includedSets?: number;
  receivedSets?: number;
  acceptedSets?: number;
  segmentErrors?: number;
  elementErrors?: number;
  totalErrors?: number;
  totalWarnings?: number;
  rowErrors: string[];
}

const AK9_STATUS: Record<string, string> = {
  A: 'Accepted',
  P: 'Partial',
  R: 'Rejected',
  E: 'Accepted with errors noted',
  M: 'Rejected, message authentication code failed',
  W: 'Rejected, assurance failed validity tests',
  X: 'Rejected, content after decryption could not be analyzed',
};

const IK3_ERRORS: Record<string, string> = {
  '1': 'Unrecognized segment ID',
  '2': 'Unexpected segment',
  '3': 'Mandatory segment missing',
  '4': 'Loop occurs over maximum times',
  '5': 'Segment exceeds maximum use',
  '6': 'Segment not in defined transaction set',
  '7': 'Segment not in proper sequence',
  '8': 'Segment has data element errors',
};

const IK4_ERRORS: Record<string, string> = {
  '1': 'Mandatory data element missing',
  '2': 'Conditional required data element missing',
  '3': 'Too many data elements',
  '4': 'Data element too short',
  '5': 'Data element too long',
  '6': 'Invalid character in data element',
  '7': 'Invalid code value',
  '8': 'Invalid date',
  '9': 'Invalid time',
  '10': 'Exclusion condition violated',
};

@Injectable()
export class EdiParserService {
  private readonly logger = new Logger(EdiParserService.name);

  parse(content: string, fileName?: string): ParsedEdiReport {
    const extension = this.extensionOf(fileName);
    const text = content ?? '';
    if (!text.trim()) {
      return this.emptyReport(extension, fileName, 'File is empty');
    }

    try {
      if (extension === '999' || this.looksLike999(text)) {
        return this.parse999(text, fileName);
      }
      if (extension === 'ta1' || extension === 'tat' || this.looksLikeTa1(text)) {
        return this.parseTa1(text, fileName);
      }
      if (this.isPipeExtension(extension) || this.looksLikePipeReport(text)) {
        return this.parsePipeReport(text, fileName, extension);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown parse error';
      this.logger.error(`Failed to parse ${fileName || 'EDI content'}: ${message}`);
      return {
        reportType: 'UNKNOWN',
        fileName,
        rowErrors: [message],
      };
    }

    return {
      reportType: 'UNKNOWN',
      fileName,
      rowErrors: ['Unsupported EDI report. Expected .ibr, .ibrp, .ebr, .dpr, or .999'],
    };
  }

  summarize(report: ParsedEdiReport): ReportSummary {
    if (report.reportType === '999') {
      const segmentErrors = report.transactions.reduce((sum, transaction) => sum + transaction.segmentErrors.length, 0);
      const elementErrors = report.transactions.reduce((sum, transaction) => sum + transaction.elementErrors.length, 0);
      return {
        reportType: '999',
        functionalId: report.functionalGroup.functionalId,
        groupControlNumber: report.functionalGroup.groupControlNumber,
        status: report.groupAcknowledgment.status,
        statusDescription: report.groupAcknowledgment.statusDescription,
        includedSets: report.groupAcknowledgment.includedSets,
        receivedSets: report.groupAcknowledgment.receivedSets,
        acceptedSets: report.groupAcknowledgment.acceptedSets,
        segmentErrors,
        elementErrors,
        rowErrors: report.rowErrors,
      };
    }

    if (report.reportType === 'TA1') {
      return {
        reportType: 'TA1',
        fileControlNumber: report.interchangeControlNumber,
        status: report.acknowledgmentCode,
        statusDescription: report.noteCode,
        rowErrors: report.rowErrors,
      };
    }

    if (report.reportType === 'UNKNOWN') {
      return {
        reportType: 'UNKNOWN',
        rowErrors: report.rowErrors,
      };
    }

    return {
      reportType: report.reportType,
      batchId: report.header.batchId,
      fileControlNumber: report.header.fileControlNumber,
      status: report.summary.totalRejected > 0 ? 'R' : 'A',
      totalSubmitted: report.summary.totalSubmitted,
      totalAccepted: report.summary.totalAccepted,
      totalRejected: report.summary.totalRejected,
      totalErrors: report.summary.totalErrors,
      totalWarnings: report.summary.totalWarnings,
      rowErrors: report.rowErrors,
    };
  }

  private parsePipeReport(content: string, fileName: string | undefined, extension: string): PipeDelimitedReport {
    const lines = content.split(/\r?\n/);
    const rowErrors: string[] = [];
    const claims: PipeClaim[] = [];
    const unassignedNotes: ClaimNote[] = [];
    let unassignedErrors = 0;
    let unassignedWarnings = 0;
    let currentClaim: PipeClaim | undefined;
    let header = {
      dateTime: '',
      batchId: '',
      fileControlNumber: '',
      totalSubmitted: 0,
      totalAccepted: 0,
      totalRejected: 0,
    };
    let headerSeen = false;
    let payer: PipeDelimitedReport['payer'];

    lines.forEach((rawLine, index) => {
      const lineNumber = index + 1;
      const line = rawLine.trim();
      if (!line) {
        return;
      }

      try {
        const parts = line.split('|').map((part) => part.trim());
        const recordType = (parts[0] || '').toLowerCase();
        switch (recordType) {
          case '1': {
            header = this.parseHeader(parts, lineNumber, rowErrors);
            headerSeen = true;
            break;
          }
          case '2': {
            payer = this.parsePayer(parts, lineNumber, rowErrors);
            break;
          }
          case '3': {
            const parsedClaim = this.parseClaim(parts, lineNumber, rowErrors);
            if (!parsedClaim) {
              break;
            }
            currentClaim = parsedClaim;
            claims.push(parsedClaim);
            break;
          }
          case '3e': {
            const note = this.parseNote(parts, lineNumber, rowErrors);
            if (currentClaim) {
              currentClaim.errors.push(note);
            } else {
              unassignedErrors += 1;
              unassignedNotes.push(note);
              rowErrors.push(`Line ${lineNumber}: error note appeared before a claim row`);
            }
            break;
          }
          case '3w': {
            const note = this.parseNote(parts, lineNumber, rowErrors);
            if (currentClaim) {
              currentClaim.warnings.push(note);
            } else {
              unassignedWarnings += 1;
              unassignedNotes.push(note);
              rowErrors.push(`Line ${lineNumber}: warning note appeared before a claim row`);
            }
            break;
          }
          case '3a':
          case '3c': {
            const note = this.parseNote(parts, lineNumber, rowErrors);
            if (!currentClaim) {
              unassignedNotes.push(note);
              rowErrors.push(`Line ${lineNumber}: ${recordType} note appeared before a claim row`);
              break;
            }
            if (recordType === '3a') {
              currentClaim.adjudications.push(note);
            } else {
              currentClaim.cleanNotes.push(note);
            }
            break;
          }
          default:
            rowErrors.push(`Line ${lineNumber}: unrecognized record type "${parts[0] || ''}"`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to read row';
        rowErrors.push(`Line ${lineNumber}: ${message}`);
      }
    });

    if (!headerSeen) {
      rowErrors.push('File header row (record type 1) is missing');
    }

    const totalSubmitted = header.totalSubmitted;
    const totalAccepted = header.totalAccepted;
    const totalRejected = header.totalRejected;
    const totalErrors = claims.reduce((sum, claim) => sum + claim.errors.length, 0) + unassignedErrors;
    const totalWarnings = claims.reduce((sum, claim) => sum + claim.warnings.length, 0) + unassignedWarnings;

    return {
      reportType: this.pipeReportType(extension),
      fileName,
      header: {
        ...header,
        totalSubmitted,
        totalAccepted,
        totalRejected,
      },
      payer,
      claims,
      unassignedNotes,
      summary: {
        totalSubmitted,
        totalAccepted,
        totalRejected,
        acceptanceRate: totalSubmitted > 0 ? `${((totalAccepted / totalSubmitted) * 100).toFixed(1)}%` : '0.0%',
        totalErrors,
        totalWarnings,
      },
      rowErrors,
    };
  }

  private parseHeader(parts: string[], lineNumber: number, rowErrors: string[]): PipeDelimitedReport['header'] {
    const submitted = this.readCount(parts[4]);
    const accepted = this.readCount(parts[5]);
    const rejected = this.readCount(parts[6]);
    if (parts.length < 7 || submitted === undefined || accepted === undefined || rejected === undefined) {
      rowErrors.push(`Line ${lineNumber}: file header is missing batch totals`);
    }
    return {
      dateTime: parts[1] || '',
      batchId: parts[2] || '',
      fileControlNumber: parts[3] || '',
      totalSubmitted: submitted ?? 0,
      totalAccepted: accepted ?? 0,
      totalRejected: rejected ?? 0,
    };
  }

  private parsePayer(parts: string[], lineNumber: number, rowErrors: string[]): { payerId: string; payerName: string } {
    const first = parts[1] || '';
    const second = parts[2] || '';
    if (!first && !second) {
      rowErrors.push(`Line ${lineNumber}: payer row is missing payer ID and name`);
    }
    const firstIsName = /[A-Za-z]{2,}[\s,]/.test(first);
    const secondIsName = /[A-Za-z]{2,}[\s,]/.test(second);
    if (firstIsName && !secondIsName) {
      return { payerName: first, payerId: second };
    }
    return { payerId: first, payerName: second };
  }

  private parseClaim(parts: string[], lineNumber: number, rowErrors: string[]): PipeClaim | null {
    const patientName = parts[1] || '';
    const dateOfService = parts[2] || '';
    const patientControlNumber = parts[3] || '';
    if (!patientName || !patientControlNumber) {
      rowErrors.push(`Line ${lineNumber}: claim row is missing patient name or patient control number`);
      return null;
    }

    const statusIndex = this.findStatusIndex(parts);
    const status = statusIndex >= 0 ? (parts[statusIndex] as 'A' | 'R') : 'U';
    if (status === 'U') {
      rowErrors.push(`Line ${lineNumber}: claim status is not A or R`);
    }

    let chargeAmount: number | undefined;
    let providerNpi: string | undefined;
    if (statusIndex > 4 && parts[4] && /^-?\d+(\.\d+)?$/.test(parts[4])) {
      chargeAmount = Number(parts[4]);
    }
    if (statusIndex > 5 && parts[5]) {
      providerNpi = parts[5];
    }

    return {
      patientName,
      dateOfService,
      patientControlNumber,
      chargeAmount,
      providerNpi,
      status,
      statusDescription: status === 'A' ? 'Accepted' : status === 'R' ? 'Rejected' : 'Unknown',
      errors: [],
      warnings: [],
      adjudications: [],
      cleanNotes: [],
    };
  }

  private parseNote(parts: string[], lineNumber: number, rowErrors: string[]): ClaimNote {
    const initiator = parts[1] || '';
    const code = parts[2] || '';
    const message = parts[3] || '';
    if (!code && !message) {
      rowErrors.push(`Line ${lineNumber}: note row is missing an error code and message`);
    }
    const location = this.noteLocation(parts[4], parts[5]);
    return {
      initiator,
      code,
      message,
      loop: location.loop || undefined,
      segment: location.segment || undefined,
      element: parts[6] || undefined,
    };
  }

  private noteLocation(fourth?: string, fifth?: string): { loop: string; segment: string } {
    const left = fourth || '';
    const right = fifth || '';
    if (this.looksLikeSegment(left) && this.looksLikeLoop(right)) {
      return { segment: left, loop: right };
    }
    if (this.looksLikeLoop(left) && this.looksLikeSegment(right)) {
      return { loop: left, segment: right };
    }
    return { loop: left, segment: right };
  }

  private parse999(content: string, fileName?: string): Acknowledgment999 {
    const segments = this.x12Segments(content);
    const rowErrors: string[] = [];
    const functionalGroup = {
      functionalId: '',
      groupControlNumber: '',
      version: '',
    };
    const transactions: AcknowledgmentTransaction[] = [];
    let current: AcknowledgmentTransaction | undefined;
    let groupAcknowledgment: Acknowledgment999['groupAcknowledgment'] = {
      status: '',
      statusDescription: 'Missing AK9 group acknowledgment',
      includedSets: 0,
      receivedSets: 0,
      acceptedSets: 0,
      errorCodes: [],
    };
    let sawAk9 = false;
    let originalInterchangeControlNumber = '';

    segments.forEach((segment, index) => {
      const segmentNumber = index + 1;
      try {
        const elements = segment.split('*');
        const tag = (elements[0] || '').toUpperCase();
        switch (tag) {
          case 'AK1':
            functionalGroup.functionalId = elements[1] || '';
            functionalGroup.groupControlNumber = elements[2] || '';
            functionalGroup.version = elements[3] || '';
            if (!functionalGroup.functionalId || !functionalGroup.groupControlNumber) {
              rowErrors.push(`Segment ${segmentNumber}: AK1 is missing the functional id or group control number`);
            }
            break;
          case 'AK2':
            current = {
              transactionSetId: elements[1] || '',
              controlNumber: elements[2] || '',
              implementationRef: elements[3] || undefined,
              segmentErrors: [],
              elementErrors: [],
            };
            transactions.push(current);
            if (!current.transactionSetId || !current.controlNumber) {
              rowErrors.push(`Segment ${segmentNumber}: AK2 is missing the transaction set id or control number`);
            }
            break;
          case 'IK3': {
            const target = this.currentTransaction(transactions, current, rowErrors, segmentNumber, 'IK3');
            current = target;
            target.segmentErrors.push({
              segmentId: elements[1] || '',
              segmentPosition: elements[2] || '',
              loopId: elements[3] || undefined,
              errorCode: elements[4] || '',
              errorDescription: IK3_ERRORS[elements[4] || ''] || `Segment error ${elements[4] || 'unknown'}`,
            });
            if (!elements[1]) {
              rowErrors.push(`Segment ${segmentNumber}: IK3 is missing the segment id`);
            }
            break;
          }
          case 'IK4': {
            const target = this.currentTransaction(transactions, current, rowErrors, segmentNumber, 'IK4');
            current = target;
            target.elementErrors.push({
              elementPosition: elements[1] || '',
              dataElementRefNumber: elements[2] || undefined,
              errorCode: elements[3] || '',
              badData: elements[4] || undefined,
              errorDescription: IK4_ERRORS[elements[3] || ''] || `Element error ${elements[3] || 'unknown'}`,
            });
            if (!elements[1]) {
              rowErrors.push(`Segment ${segmentNumber}: IK4 is missing the element position`);
            }
            break;
          }
          case 'IK5':
            if (current) {
              current.status = elements[1] || '';
              current.statusDescription = AK9_STATUS[elements[1] || ''] || elements[1] || '';
            } else {
              rowErrors.push(`Segment ${segmentNumber}: IK5 appeared before AK2`);
            }
            break;
          case 'TA1':
            originalInterchangeControlNumber = elements[1] || '';
            break;
          case 'AK9':
            sawAk9 = true;
            groupAcknowledgment = {
              status: elements[1] || '',
              statusDescription: AK9_STATUS[elements[1] || ''] || `Unknown status ${elements[1] || ''}`.trim(),
              includedSets: this.readCount(elements[2]) ?? 0,
              receivedSets: this.readCount(elements[3]) ?? 0,
              acceptedSets: this.readCount(elements[4]) ?? 0,
              errorCodes: elements.slice(5).filter((code) => code !== ''),
            };
            if (!['A', 'R', 'P', 'E', 'M', 'W', 'X'].includes(groupAcknowledgment.status)) {
              rowErrors.push(`Segment ${segmentNumber}: AK9 status "${groupAcknowledgment.status}" is not A, R, or P`);
            }
            break;
          default:
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to read segment';
        rowErrors.push(`Segment ${segmentNumber}: ${message}`);
      }
    });

    if (!sawAk9) {
      rowErrors.push('AK9 group acknowledgment is missing');
    }

    if (originalInterchangeControlNumber) {
      groupAcknowledgment.originalInterchangeControlNumber = originalInterchangeControlNumber;
    }

    return {
      reportType: '999',
      fileName,
      functionalGroup,
      transactions,
      groupAcknowledgment,
      rowErrors,
    };
  }

  private currentTransaction(
    transactions: AcknowledgmentTransaction[],
    current: AcknowledgmentTransaction | undefined,
    rowErrors: string[],
    segmentNumber: number,
    tag: string,
  ): AcknowledgmentTransaction {
    if (current) {
      return current;
    }
    rowErrors.push(`Segment ${segmentNumber}: ${tag} appeared before AK2`);
    const created: AcknowledgmentTransaction = {
      transactionSetId: '',
      controlNumber: '',
      segmentErrors: [],
      elementErrors: [],
    };
    transactions.push(created);
    return created;
  }

  private emptyReport(extension: string, fileName: string | undefined, message: string): ParsedEdiReport {
    if (extension === '999') {
      return {
        reportType: '999',
        fileName,
        functionalGroup: { functionalId: '', groupControlNumber: '', version: '' },
        transactions: [],
        groupAcknowledgment: {
          status: '',
          statusDescription: 'Missing AK9 group acknowledgment',
          includedSets: 0,
          receivedSets: 0,
          acceptedSets: 0,
          errorCodes: [],
        },
        rowErrors: [message, 'AK9 group acknowledgment is missing'],
      };
    }
    if (this.isPipeExtension(extension)) {
      return {
        reportType: this.pipeReportType(extension),
        fileName,
        header: {
          dateTime: '',
          batchId: '',
          fileControlNumber: '',
          totalSubmitted: 0,
          totalAccepted: 0,
          totalRejected: 0,
        },
        claims: [],
        unassignedNotes: [],
        summary: {
          totalSubmitted: 0,
          totalAccepted: 0,
          totalRejected: 0,
          acceptanceRate: '0.0%',
          totalErrors: 0,
          totalWarnings: 0,
        },
        rowErrors: [message, 'File header row (record type 1) is missing'],
      };
    }
    return {
      reportType: 'UNKNOWN',
      fileName,
      rowErrors: [message],
    };
  }

  private x12Segments(content: string): string[] {
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!normalized) {
      return [];
    }
    if (normalized.includes('~')) {
      return normalized
        .split('~')
        .map((segment) => segment.replace(/\n/g, '').trim())
        .filter((segment) => segment.length > 0);
    }
    return normalized
      .split('\n')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
  }

  private findStatusIndex(parts: string[]): number {
    for (let index = parts.length - 1; index >= 1; index -= 1) {
      if (parts[index] === 'A' || parts[index] === 'R') {
        return index;
      }
    }
    return -1;
  }

  private readCount(value: string | undefined): number | undefined {
    if (value === undefined || value === '') {
      return undefined;
    }
    if (!/^\d+$/.test(value)) {
      return undefined;
    }
    return Number(value);
  }

  private looksLike999(content: string): boolean {
    return /(?:^|~|\n)\s*(ST\*999\*|AK1\*)/i.test(content);
  }

  private looksLikeTa1(content: string): boolean {
    return /(?:^|~|\n)\s*TA1\*/i.test(content) && !this.looksLike999(content);
  }

  private parseTa1(content: string, fileName?: string): Ta1Report {
    const segment = this.x12Segments(content).find((entry) => entry.toUpperCase().startsWith('TA1*'));
    const elements = segment?.split('*') ?? [];
    const rowErrors: string[] = [];
    if (!elements[1]) {
      rowErrors.push('TA101 interchange control number is missing');
    }
    return {
      reportType: 'TA1',
      fileName,
      interchangeControlNumber: elements[1] || '',
      acknowledgmentCode: elements[4] || '',
      noteCode: elements[5] || '',
      rowErrors,
    };
  }

  private looksLikePipeReport(content: string): boolean {
    return /^\s*[123]\|/m.test(content) || /^\s*3[ewac]\|/im.test(content);
  }

  private looksLikeSegment(value: string): boolean {
    return /^[A-Z]{2,3}\d?$/.test(value);
  }

  private looksLikeLoop(value: string): boolean {
    return /^\d{3,4}[A-Z]{0,2}$/.test(value);
  }

  private extensionOf(fileName?: string): string {
    const match = fileName?.toLowerCase().match(/\.([a-z0-9]+)$/);
    return match?.[1] || '';
  }

  private isPipeExtension(extension: string): boolean {
    return extension === 'ibr' || extension === 'ibrp' || extension === 'ebr' || extension === 'dpr';
  }

  private pipeReportType(extension: string): PipeReportType {
    switch (extension) {
      case 'ibr':
        return 'IBR';
      case 'ibrp':
        return 'IBRP';
      case 'ebr':
        return 'EBR';
      case 'dpr':
        return 'DPR';
      default:
        return 'PIPE';
    }
  }
}
