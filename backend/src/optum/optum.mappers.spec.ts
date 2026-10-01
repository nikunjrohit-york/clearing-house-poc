import {
  claimStatusRequest,
  eligibilityRequest,
  parse277,
  parse835,
  parseClaimStatus,
  parseClaimSubmission,
  parseEligibility,
  readOptumError,
} from './optum.contracts';

describe('optum mappers', () => {
  it('builds the eligibility request for trading partner 87726', () => {
    const body = eligibilityRequest();
    expect(body.tradingPartnerServiceId).toBe('87726');
    expect(body).toHaveProperty('encounter');
    expect(claimStatusRequest().encounter).toMatchObject({
      beginningDateOfService: '20100101',
      endDateOfService: '20100102',
      submittedAmount: '28.75',
    });
  });

  it('maps coverage, copay, deductible, coinsurance, and out-of-pocket amounts', () => {
    const parsed = parseEligibility({
      planStatus: [{ statusCode: '1', status: 'Active Coverage', serviceTypeCodes: ['30'] }],
      benefitsInformation: [
        { code: '1', name: 'Active Coverage', serviceTypeCodes: ['30'] },
        { code: 'B', name: 'Co-Payment', benefitAmount: '20', coverageLevel: 'Individual', serviceTypes: ['Office'] },
        { code: 'C', name: 'Deductible', benefitAmount: '500', timeQualifier: 'Remaining' },
        { code: 'A', name: 'Co-Insurance', benefitPercent: '.2' },
        { code: 'G', name: 'Out of Pocket (Stop Loss)', benefitAmount: '3000' },
      ],
    });

    expect(parsed.activeCoverage).toHaveLength(2);
    expect(parsed.copays[0].amount).toBe('20');
    expect(parsed.deductibles[0].amount).toBe('500');
    expect(parsed.coinsurance[0].percent).toBe('.2');
    expect(parsed.outOfPocketMaximums[0].amount).toBe('3000');
  });

  it('maps the claim control number and validation warnings', () => {
    const parsed = parseClaimSubmission({
      status: 'SUCCESS',
      claimReference: { rhclaimNumber: '2310011234567' },
      errors: [{ field: 'claimInformation.claimChargeAmount', code: '33', description: 'Charge amount is invalid', location: '2300' }],
    });
    expect(parsed).toEqual({
      claimControlNumber: '2310011234567',
      submissionStatus: 'SUCCESS',
      warnings: [{ field: 'claimInformation.claimChargeAmount', code: '33', description: 'Charge amount is invalid', location: '2300' }],
    });
  });

  it('splits 277 acknowledgements from rejections', () => {
    const parsed = parse277(
      {
        transactions: [
          {
            payers: [
              {
                claimStatusTransactions: [
                  {
                    claimStatusDetails: [
                      {
                        patientClaimStatusDetails: [
                          {
                            claims: [
                              {
                                claimStatus: {
                                  informationClaimStatuses: [
                                    {
                                      informationStatuses: [
                                        {
                                          healthCareClaimStatusCategoryCode: 'A1',
                                          healthCareClaimStatusCategoryCodeValue: 'Acknowledgement/Receipt',
                                          statusCode: '19',
                                          statusCodeValue: 'Claim received.',
                                        },
                                        {
                                          healthCareClaimStatusCategoryCode: 'A3',
                                          healthCareClaimStatusCategoryCodeValue: 'Acknowledgement/Returned as unprocessable',
                                          statusCode: '21',
                                          statusCodeValue: 'Missing or invalid information.',
                                        },
                                      ],
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    );

    expect(parsed.acknowledgements.map((line) => line.categoryCode)).toEqual(['A1']);
    expect(parsed.rejections[0]).toMatchObject({ categoryCode: 'A3', description: 'Missing or invalid information.' });
  });

  it('maps claim status adjudication, payer control number, and payment dates', () => {
    const parsed = parseClaimStatus({
      claims: [
        {
          claimStatus: {
            statusCategoryCode: 'F1',
            statusCategoryCodeValue: 'Finalized/Payment',
            statusCode: '65',
            statusCodeValue: 'Claim/line has been paid.',
            tradingPartnerClaimNumber: 'AAAAAAAAAAA1',
            paidDate: '20170415',
            checkIssueDate: '20170415',
          },
        },
      ],
    });
    expect(parsed.adjudication[0]).toMatchObject({
      categoryCode: 'F1',
      payerClaimControlNumber: 'AAAAAAAAAAA1',
      paidDate: '20170415',
      checkIssueDate: '20170415',
    });
  });

  it('maps 835 trace, payment method, paid amount, and CARC/RARC codes', () => {
    const parsed = parse835({
      transactions: [
        {
          paymentAndRemitReassociationDetails: { checkOrEFTTraceNumber: '123456789' },
          financialInformation: { paymentMethodCode: 'ACH', totalActualProviderPaymentAmount: '80.00' },
          detailInfo: [
            {
              paymentInfo: [
                {
                  serviceLines: [
                    {
                      serviceAdjustments: [
                        { claimAdjustmentGroupCode: 'CO', claimAdjustmentGroupCodeValue: 'Contractual Obligations', adjustmentReasonCode1: '45', adjustmentAmount1: '10.00' },
                        { claimAdjustmentGroupCode: 'PR', claimAdjustmentGroupCodeValue: 'Patient Responsibility', adjustmentReasonCode1: '3', adjustmentAmount1: '10.00' },
                      ],
                      healthCareCheckRemarkCodes: [{ remarkCode: 'N130' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(parsed.traceNumber).toBe('123456789');
    expect(parsed.paymentMethod).toBe('ACH');
    expect(parsed.totalPaidAmount).toBe('80.00');
    expect(parsed.adjustments.map((row) => row.group)).toEqual(['CO', 'PR']);
    expect(parsed.remarkCodes).toEqual(['N130']);
  });

  it('formats the Optum error envelope', () => {
    expect(
      readOptumError({ error: 'invalid_request', description: 'bad member id', traceId: 'abc', meta: { applicationMode: 'sandbox' } }, 400),
    ).toEqual({
      httpStatus: 400,
      description: 'bad member id',
      error: 'invalid_request',
      traceId: 'abc',
      applicationMode: 'sandbox',
    });
  });
});
