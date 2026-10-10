import { BadRequestException, ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../entities/customer.entity';
import { CustomerCategory } from '../entities/customer-category.entity';
import { RbacService } from '@modules/auth/services/rbac.service';
import { round } from '@shared/utils/document-totals.util';

/** Users holding this permission may exceed a customer's hard credit limit. */
export const CREDIT_OVERRIDE_PERMISSION = {
  module: 'sales',
  screen: 'credit_limit_override',
  action: 'update',
};

export interface CreditEvaluation {
  /** Balance after the document (balance + amount). */
  exposure: number;
  /** Hard credit limit exceeded (blocking unless overridden). */
  limitExceeded: boolean;
  /** Soft threshold exceeded (warning only). */
  warning: string | null;
}

/** Refuses sales to a blocked (rejected) customer. */
export function assertCustomerNotBlocked(customer: Pick<Customer, 'isBlocked' | 'blockReason'> | null | undefined) {
  if (customer?.isBlocked) {
    throw new BadRequestException(
      `Customer is blocked${customer.blockReason ? `: ${customer.blockReason}` : ''}`,
    );
  }
}

/**
 * Instasoft rule: a sale is blocked when balance + document − already paid
 * exceeds the credit limit (0 = unlimited); above the soft "balance
 * threshold" it is only a warning.
 */
export function evaluateCredit(
  customer: Pick<Customer, 'balance' | 'creditLimit'>,
  amount: number,
  threshold?: number | null,
): CreditEvaluation {
  const exposure = round(Number(customer.balance) + Number(amount), 4);
  const limit = Number(customer.creditLimit);
  const limitExceeded = limit > 0 && exposure > limit + 0.0001;
  const soft = threshold === null || threshold === undefined ? null : Number(threshold);
  const warning =
    soft !== null && soft > 0 && exposure > soft + 0.0001
      ? `Customer balance ${exposure.toFixed(2)} exceeds the warning threshold ${soft.toFixed(2)}`
      : null;
  return { exposure, limitExceeded, warning };
}

/**
 * Credit-limit and balance-threshold checks shared by sales orders and
 * invoices. Hard limit: blocking unless the user holds
 * sales/credit_limit_override/update. Soft threshold (customer, else its
 * category): returns a warning.
 */
@Injectable()
export class CustomerCreditService {
  constructor(
    @InjectRepository(CustomerCategory)
    private readonly categoryRepo: Repository<CustomerCategory>,
    @Optional() private readonly rbac?: RbacService,
  ) {}

  async check(
    tenantId: string,
    userId: string,
    customer: Customer,
    amount: number,
    label: string,
  ): Promise<string[]> {
    assertCustomerNotBlocked(customer);
    let threshold = customer.balanceWarningThreshold;
    if ((threshold === null || threshold === undefined) && customer.categoryId) {
      const category = await this.categoryRepo.findOne({
        where: { id: customer.categoryId, tenantId },
      });
      threshold = category?.balanceWarningThreshold ?? null;
    }
    const result = evaluateCredit(customer, amount, threshold);
    const warnings: string[] = [];
    if (result.limitExceeded) {
      const message = `Credit limit exceeded. Limit: ${customer.creditLimit}, Current balance: ${customer.balance}, ${label}: ${Number(amount).toFixed(2)}`;
      const allowed = this.rbac
        ? await this.rbac.hasPermission(tenantId, userId, CREDIT_OVERRIDE_PERMISSION)
        : false;
      if (!allowed) {
        throw new ForbiddenException(`${message}; requires sales/credit_limit_override/update`);
      }
      warnings.push(`${message} (overridden)`);
    }
    if (result.warning) warnings.push(result.warning);
    return warnings;
  }

  /** Fallback used when the service is not wired (no override, no category threshold). */
  static checkWithoutOverride(customer: Customer, amount: number, label: string): string[] {
    assertCustomerNotBlocked(customer);
    const result = evaluateCredit(customer, amount, customer.balanceWarningThreshold);
    if (result.limitExceeded) {
      throw new BadRequestException(
        `Credit limit exceeded. Limit: ${customer.creditLimit}, Current balance: ${customer.balance}, ${label}: ${Number(amount).toFixed(2)}`,
      );
    }
    return result.warning ? [result.warning] : [];
  }
}
