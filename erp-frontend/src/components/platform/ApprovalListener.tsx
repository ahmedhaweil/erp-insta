'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { APPROVAL_EVENT, type ApprovalEventDetail } from '@/lib/api';

/**
 * Listens for actions blocked by the approval engine (409 + approvalRequestId,
 * raised by the axios interceptor) and shows a toast linking to the request.
 */
export default function ApprovalListener() {
  const t = useTranslations('platform');
  const router = useRouter();
  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<ApprovalEventDetail>).detail;
      if (!detail?.id) return;
      toast.warning(t('approvals.blockedTitle'), {
        id: `approval-${detail.id}`,
        description: detail.requestNumber
          ? t('approvals.blockedBody', { number: detail.requestNumber })
          : t('approvals.blockedBodyNoNumber'),
        duration: 12_000,
        action: { label: t('approvals.viewRequest'), onClick: () => router.push(`/approvals/requests/${detail.id}`) },
      });
    };
    window.addEventListener(APPROVAL_EVENT, onEvent);
    return () => window.removeEventListener(APPROVAL_EVENT, onEvent);
  }, [t, router]);
  return null;
}
