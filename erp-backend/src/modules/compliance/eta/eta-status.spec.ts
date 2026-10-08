import { EInvoiceStatus } from '../entities/e-invoice.entity';
import { extractEtaValidationErrors, flattenEtaError, mapEtaStatus } from './eta-status';

describe('ETA status mapping', () => {
  it.each([
    ['Valid', EInvoiceStatus.VALID],
    ['valid', EInvoiceStatus.VALID],
    ['Invalid', EInvoiceStatus.INVALID],
    ['Submitted', EInvoiceStatus.SUBMITTED],
    ['In Progress', EInvoiceStatus.SUBMITTED],
    ['Cancelled', EInvoiceStatus.CANCELLED],
    ['Rejected', EInvoiceStatus.REJECTED],
    ['', EInvoiceStatus.SUBMITTED],
    [undefined, EInvoiceStatus.SUBMITTED],
  ])('maps %p to %p', (input, expected) => {
    expect(mapEtaStatus(input as any)).toBe(expected);
  });

  it('flattens nested ETA errors', () => {
    const errors = flattenEtaError({
      code: 'BadStructure',
      message: 'Document structure is invalid',
      target: 'INV-1',
      details: [
        { code: 'BadArgumentValue', message: 'Value is required', target: 'receiver.id', propertyPath: 'receiver.id' },
      ],
    });
    expect(errors).toEqual([
      { code: 'BadStructure', message: 'Document structure is invalid', target: 'INV-1', path: undefined, severity: 'error' },
      { code: 'BadArgumentValue', message: 'Value is required', target: 'receiver.id', path: 'receiver.id', severity: 'error' },
    ]);
    expect(flattenEtaError(null)).toEqual([]);
  });

  it('extracts failed validation steps from document details', () => {
    const errors = extractEtaValidationErrors({
      validationResults: {
        status: 'Invalid',
        validationSteps: [
          { name: 'Step-01-Structure Validator', status: 'Valid', error: null },
          {
            name: 'Step-03-Signature Validator',
            status: 'Invalid',
            error: { errorCode: 'IncorrectSignature', error: 'Signature is invalid', details: [] },
          },
          { name: 'Step-06-Taxpayer Validator', status: 'Invalid', error: null },
        ],
      },
    });
    expect(errors).toEqual([
      expect.objectContaining({ code: 'IncorrectSignature', message: 'Signature is invalid', category: 'Step-03-Signature Validator' }),
      { message: 'Step-06-Taxpayer Validator failed', category: 'Step-06-Taxpayer Validator', severity: 'error' },
    ]);
  });
});
