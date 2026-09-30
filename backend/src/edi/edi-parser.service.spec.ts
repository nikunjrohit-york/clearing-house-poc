import { EdiParserService, Acknowledgment999, PipeDelimitedReport } from './edi-parser.service';

const ibr = [
  '1|2026-09-28 14:32:00|BAT-992014|FCN-00049281|2|1|1',
  '2|00001|Aetna Commercial Payer',
  '3|DOE, JOHN|20260920|PCN-2023-001|250.00|1234567890|A',
  '3|SMITH, JANE|20260922|PCN-2023-002|180.00|1234567890|R',
  '3e|HIPAA|E102|Invalid or missing Subscriber ID qualifier|NM1|2010BA|09',
  '3w|Availity|W201|Provider taxonomy code recommended|PRV|2000A|03',
  'NOT-A-ROW',
].join('\n');

const ack = [
  'ISA*00*          *00*          *ZZ*030240928      *01*AV09311993     *260928*1435*^*00501*000000099*0*P*:~',
  'GS*FA*030240928*AV09311993*20260928*1435*1*X*005010X231A1~',
  'ST*999*0001*005010X231A1~',
  'AK1*HC*100001*005010X222A1~',
  'AK2*837*0001*005010X222A1~',
  'IK3*CLM*25*2300*8~',
  'IK4*1*1028*7*ABC~',
  'IK5*R~',
  'AK9*P*1*1*0*5~',
  'SE*8*0001~',
].join('\n');

describe('EdiParserService', () => {
  const parser = new EdiParserService();

  it('parses IBR header, payer, claims, errors, and warnings', () => {
    const report = parser.parse(ibr, 'batch.ibr') as PipeDelimitedReport;

    expect(report.reportType).toBe('IBR');
    expect(report.header).toMatchObject({
      dateTime: '2026-09-28 14:32:00',
      batchId: 'BAT-992014',
      fileControlNumber: 'FCN-00049281',
      totalSubmitted: 2,
      totalAccepted: 1,
      totalRejected: 1,
    });
    expect(report.payer).toEqual({ payerId: '00001', payerName: 'Aetna Commercial Payer' });
    expect(report.claims[0]).toMatchObject({
      patientName: 'DOE, JOHN',
      dateOfService: '20260920',
      patientControlNumber: 'PCN-2023-001',
      chargeAmount: 250,
      providerNpi: '1234567890',
      status: 'A',
    });
    expect(report.claims[1].status).toBe('R');
    expect(report.claims[1].errors[0]).toMatchObject({
      initiator: 'HIPAA',
      code: 'E102',
      message: 'Invalid or missing Subscriber ID qualifier',
      segment: 'NM1',
      loop: '2010BA',
      element: '09',
    });
    expect(report.claims[1].warnings[0]).toMatchObject({
      initiator: 'Availity',
      code: 'W201',
      segment: 'PRV',
      loop: '2000A',
      element: '03',
    });
    expect(report.summary).toMatchObject({ totalErrors: 1, totalWarnings: 1, acceptanceRate: '50.0%' });
    expect(report.rowErrors).toEqual(['Line 7: unrecognized record type "NOT-A-ROW"']);
  });

  it('keeps later claims when an earlier claim row is incomplete', () => {
    const content = ['1|2026-09-28|BAT-1|FCN-1|1|1|0', '3|ONLYNAME', '3|DOE, JOHN|20260920|PCN-9|A'].join('\n');
    const report = parser.parse(content, 'batch.ebr') as PipeDelimitedReport;

    expect(report.reportType).toBe('EBR');
    expect(report.claims).toHaveLength(2);
    expect(report.claims[1]).toMatchObject({ patientControlNumber: 'PCN-9', status: 'A' });
    expect(report.rowErrors.some((error) => error.includes('Line 2'))).toBe(true);
  });

  it('reads payer name before payer id when the name comes first', () => {
    const content = '1|2026-09-28|BAT-1|FCN-1|0|0|0\n2|Aetna Commercial|00001\n';
    const report = parser.parse(content, 'batch.dpr') as PipeDelimitedReport;
    expect(report.payer).toEqual({ payerId: '00001', payerName: 'Aetna Commercial' });
  });

  it('parses a 999 acknowledgment through AK9 partial status', () => {
    const report = parser.parse(ack, 'ack.999') as Acknowledgment999;

    expect(report.functionalGroup).toEqual({
      functionalId: 'HC',
      groupControlNumber: '100001',
      version: '005010X222A1',
    });
    expect(report.transactions[0]).toMatchObject({
      transactionSetId: '837',
      controlNumber: '0001',
      status: 'R',
    });
    expect(report.transactions[0].segmentErrors[0]).toMatchObject({
      segmentId: 'CLM',
      segmentPosition: '25',
      loopId: '2300',
      errorCode: '8',
      errorDescription: 'Segment has data element errors',
    });
    expect(report.transactions[0].elementErrors[0]).toMatchObject({
      elementPosition: '1',
      dataElementRefNumber: '1028',
      errorCode: '7',
      badData: 'ABC',
      errorDescription: 'Invalid code value',
    });
    expect(report.groupAcknowledgment).toMatchObject({
      status: 'P',
      statusDescription: 'Partial',
      includedSets: 1,
      receivedSets: 1,
      acceptedSets: 0,
      errorCodes: ['5'],
    });
    expect(report.rowErrors).toEqual([]);
  });

  it('records a truncated IK4 without discarding the AK9 status', () => {
    const report = parser.parse('AK1*HC*1*005010X222A1~\nIK4~\nAK9*A*1*1*1~', 'ack.999') as Acknowledgment999;

    expect(report.groupAcknowledgment.status).toBe('A');
    expect(report.transactions[0].elementErrors[0].elementPosition).toBe('');
    expect(report.rowErrors.some((error) => error.includes('IK4'))).toBe(true);
  });
});
