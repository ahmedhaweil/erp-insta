import { BadRequestException, ConflictException } from '@nestjs/common';
import { TicketStatus } from '../entities/maintenance-ticket.entity';

const S = TicketStatus;

/**
 * Repair ticket workflow. Instasoft stored a free-text status with no rules;
 * here every change goes through this table.
 *
 *   received -> diagnosing -> awaiting_approval -> in_repair -> ready -> delivered
 *
 * plus a few practical shortcuts (diagnosis showing nothing to repair, a
 * rework sending a ready device back to repair, a second approval round),
 * `cancelled` from any state before delivery, and `rescheduled`, which parks
 * the ticket and can only resume to the state it was parked from.
 */
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  [S.RECEIVED]: [S.DIAGNOSING, S.CANCELLED, S.RESCHEDULED],
  [S.DIAGNOSING]: [S.AWAITING_APPROVAL, S.IN_REPAIR, S.READY, S.CANCELLED, S.RESCHEDULED],
  [S.AWAITING_APPROVAL]: [S.DIAGNOSING, S.IN_REPAIR, S.CANCELLED, S.RESCHEDULED],
  [S.IN_REPAIR]: [S.AWAITING_APPROVAL, S.READY, S.CANCELLED, S.RESCHEDULED],
  [S.READY]: [S.IN_REPAIR, S.DELIVERED, S.CANCELLED, S.RESCHEDULED],
  // resuming is checked against previousStatus in assertTransition
  [S.RESCHEDULED]: [
    S.RECEIVED,
    S.DIAGNOSING,
    S.AWAITING_APPROVAL,
    S.IN_REPAIR,
    S.READY,
    S.CANCELLED,
    S.RESCHEDULED,
  ],
  [S.DELIVERED]: [],
  [S.CANCELLED]: [],
};

export const CLOSED_STATUSES: TicketStatus[] = [S.DELIVERED, S.CANCELLED];

/** Tickets still being worked on (calendar, overdue, workload). */
export const OPEN_STATUSES: TicketStatus[] = [
  S.RECEIVED,
  S.DIAGNOSING,
  S.AWAITING_APPROVAL,
  S.IN_REPAIR,
  S.READY,
  S.RESCHEDULED,
];

/** Statuses in which part / labour lines may still be changed. */
export const EDITABLE_STATUSES: TicketStatus[] = [
  S.RECEIVED,
  S.DIAGNOSING,
  S.AWAITING_APPROVAL,
  S.IN_REPAIR,
  S.READY,
  S.RESCHEDULED,
];

export interface TransitionContext {
  from: TicketStatus;
  to: TicketStatus;
  previousStatus?: TicketStatus | null;
  customerApproved: boolean;
  isWarranty: boolean;
  totalCost: number;
  /** A non-cancelled sales invoice is linked. */
  invoiced: boolean;
}

/** Throws when the move is not allowed; returns nothing on success. */
export function assertTransition(ctx: TransitionContext): void {
  const { from, to } = ctx;
  if (CLOSED_STATUSES.includes(from)) {
    throw new ConflictException(`A ${from} ticket cannot change status`);
  }
  if (!TICKET_TRANSITIONS[from].includes(to)) {
    throw new BadRequestException(`Cannot move a ticket from ${from} to ${to}`);
  }
  if (from === S.RESCHEDULED && to !== S.CANCELLED && to !== S.RESCHEDULED) {
    const back = ctx.previousStatus ?? S.RECEIVED;
    if (to !== back) {
      throw new BadRequestException(`A rescheduled ticket resumes to ${back}, not ${to}`);
    }
    return;
  }
  if (to === S.IN_REPAIR && from !== S.READY && !ctx.customerApproved && !ctx.isWarranty) {
    throw new BadRequestException('The customer has not approved the repair');
  }
  if (to === S.DELIVERED && !ctx.invoiced && !ctx.isWarranty && Number(ctx.totalCost) > 0.0001) {
    throw new BadRequestException('Invoice the ticket before delivering it (only warranty or zero-cost tickets can be delivered without an invoice)');
  }
}

/** Whether lines may be added/changed in the given status. */
export function assertEditable(status: TicketStatus, invoiced: boolean): void {
  if (!EDITABLE_STATUSES.includes(status)) {
    throw new ConflictException(`Lines of a ${status} ticket cannot be changed`);
  }
  if (invoiced) {
    throw new ConflictException('The ticket is already invoiced; its lines cannot be changed');
  }
}

/** Refuses a ticket total above the ceiling the customer approved. */
export function assertWithinApproval(total: number, maxApprovedCost: number | null | undefined): void {
  if (maxApprovedCost === null || maxApprovedCost === undefined) return;
  if (Number(total) > Number(maxApprovedCost) + 0.0001) {
    throw new BadRequestException(
      `Ticket total ${Number(total).toFixed(2)} exceeds the approved maximum ${Number(maxApprovedCost).toFixed(2)}; update the customer approval first`,
    );
  }
}
