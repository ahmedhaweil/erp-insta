import { ComplianceMessage, EInvoiceStatus } from '../entities/e-invoice.entity';

/**
 * Maps an ETA document / receipt status (as returned by GET
 * /api/v1/documents/{uuid}/details or the submission summary) to ours.
 */
export function mapEtaStatus(status: string | null | undefined): EInvoiceStatus {
  switch ((status || '').trim().toLowerCase()) {
    case 'valid':
      return EInvoiceStatus.VALID;
    case 'invalid':
      return EInvoiceStatus.INVALID;
    case 'cancelled':
    case 'canceled':
      return EInvoiceStatus.CANCELLED;
    case 'rejected':
      return EInvoiceStatus.REJECTED;
    case 'submitted':
    case 'in progress':
    case 'inprogress':
    default:
      return EInvoiceStatus.SUBMITTED;
  }
}

/** Statuses that ETA can still change on its side (poll them). */
export const ETA_OPEN_STATUSES = [EInvoiceStatus.SUBMITTED];

/** Flattens an ETA error object ({code,message,target,details[]}) to messages. */
export function flattenEtaError(error: any, path = ''): ComplianceMessage[] {
  if (!error) return [];
  const own: ComplianceMessage[] = [];
  const details: any[] = Array.isArray(error.details) ? error.details : [];
  // Submission errors use {code, message}; validation steps use {errorCode, error}.
  const code = error.code || error.errorCode;
  const message = error.message || (typeof error.error === 'string' ? error.error : undefined);
  if (message || code) {
    own.push({
      code,
      message: message || String(code),
      target: error.target,
      path: error.propertyPath || path || undefined,
      severity: 'error',
    });
  }
  return [...own, ...details.flatMap((d) => flattenEtaError(d, d.propertyPath || path))];
}

/** Extracts the failed validation steps from a document details response. */
export function extractEtaValidationErrors(details: any): ComplianceMessage[] {
  const steps: any[] = details?.validationResults?.validationSteps || [];
  return steps
    .filter((s) => (s.status || '').toLowerCase() === 'invalid' || s.error)
    .flatMap((s) => {
      const messages = flattenEtaError(s.error);
      return messages.length
        ? messages.map((m) => ({ ...m, category: s.name }))
        : [{ message: `${s.name} failed`, category: s.name, severity: 'error' as const }];
    });
}
