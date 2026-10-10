import { BadRequestException, ConflictException } from '@nestjs/common';
import { TicketStatus as S } from '../entities/maintenance-ticket.entity';
import { assertEditable, assertTransition, assertWithinApproval, TransitionContext } from './ticket-status';

const ctx = (over: Partial<TransitionContext>): TransitionContext => ({
  from: S.RECEIVED,
  to: S.DIAGNOSING,
  customerApproved: false,
  isWarranty: false,
  totalCost: 0,
  invoiced: false,
  ...over,
});

describe('repair ticket status machine', () => {
  it('walks the happy path', () => {
    const approved = { customerApproved: true, totalCost: 100, invoiced: true };
    const path = [S.RECEIVED, S.DIAGNOSING, S.AWAITING_APPROVAL, S.IN_REPAIR, S.READY, S.DELIVERED];
    for (let i = 0; i < path.length - 1; i++) {
      expect(() => assertTransition(ctx({ ...approved, from: path[i], to: path[i + 1] }))).not.toThrow();
    }
  });

  it('refuses skipping steps', () => {
    expect(() => assertTransition(ctx({ from: S.RECEIVED, to: S.READY }))).toThrow(BadRequestException);
    expect(() => assertTransition(ctx({ from: S.RECEIVED, to: S.DELIVERED }))).toThrow(BadRequestException);
  });

  it('needs the customer approval to start the repair unless under warranty', () => {
    expect(() => assertTransition(ctx({ from: S.AWAITING_APPROVAL, to: S.IN_REPAIR }))).toThrow(/approved/);
    expect(() =>
      assertTransition(ctx({ from: S.AWAITING_APPROVAL, to: S.IN_REPAIR, isWarranty: true })),
    ).not.toThrow();
  });

  it('can cancel before delivery but never after', () => {
    expect(() => assertTransition(ctx({ from: S.IN_REPAIR, to: S.CANCELLED }))).not.toThrow();
    expect(() => assertTransition(ctx({ from: S.DELIVERED, to: S.CANCELLED }))).toThrow(ConflictException);
    expect(() => assertTransition(ctx({ from: S.CANCELLED, to: S.RECEIVED }))).toThrow(ConflictException);
  });

  it('resumes a rescheduled ticket only to the state it was parked from', () => {
    expect(() =>
      assertTransition(ctx({ from: S.RESCHEDULED, to: S.IN_REPAIR, previousStatus: S.IN_REPAIR })),
    ).not.toThrow();
    expect(() =>
      assertTransition(ctx({ from: S.RESCHEDULED, to: S.READY, previousStatus: S.IN_REPAIR })),
    ).toThrow(/resumes to in_repair/);
    expect(() =>
      assertTransition(ctx({ from: S.RESCHEDULED, to: S.CANCELLED, previousStatus: S.IN_REPAIR })),
    ).not.toThrow();
  });

  it('delivers only invoiced, warranty or zero-cost tickets', () => {
    const ready = { from: S.READY, to: S.DELIVERED };
    expect(() => assertTransition(ctx({ ...ready, totalCost: 50 }))).toThrow(/Invoice the ticket/);
    expect(() => assertTransition(ctx({ ...ready, totalCost: 50, invoiced: true }))).not.toThrow();
    expect(() => assertTransition(ctx({ ...ready, totalCost: 50, isWarranty: true }))).not.toThrow();
    expect(() => assertTransition(ctx({ ...ready, totalCost: 0 }))).not.toThrow();
  });

  it('locks lines once invoiced or closed', () => {
    expect(() => assertEditable(S.IN_REPAIR, false)).not.toThrow();
    expect(() => assertEditable(S.IN_REPAIR, true)).toThrow(ConflictException);
    expect(() => assertEditable(S.DELIVERED, false)).toThrow(ConflictException);
  });

  it('refuses a total above the approved maximum', () => {
    expect(() => assertWithinApproval(500, null)).not.toThrow();
    expect(() => assertWithinApproval(500, 500)).not.toThrow();
    expect(() => assertWithinApproval(500.01, 500)).toThrow(/approved maximum/);
  });
});
