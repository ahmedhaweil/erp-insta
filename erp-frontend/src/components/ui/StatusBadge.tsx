'use client';

import { clsx } from 'clsx';

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  posted: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  paid: 'bg-green-100 text-green-700',
  partial: 'bg-yellow-100 text-yellow-700',
  overdue: 'bg-red-100 text-red-700',
  delivered: 'bg-green-100 text-green-700',
  sent: 'bg-blue-100 text-blue-700',
  open: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-700',
  pending: 'bg-yellow-100 text-yellow-700',
  submitted: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  approved: 'bg-green-100 text-green-700',
  received: 'bg-green-100 text-green-700',
  completed: 'bg-green-100 text-green-700',
  refunded: 'bg-orange-100 text-orange-700',
  void: 'bg-red-100 text-red-700',
};

export default function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={clsx(
        'inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium',
        statusColors[status] || 'bg-gray-100 text-gray-700',
      )}
    >
      {label}
    </span>
  );
}
