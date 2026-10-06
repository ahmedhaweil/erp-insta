'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Wraps a document workflow action (post, deliver, receive, refund...) in a
 * mutation that refreshes the affected lists and reports the outcome.
 */
export function useDocumentAction<TArg>(
  action: (arg: TArg) => Promise<unknown>,
  options: { invalidate: string[]; success: string; error: string },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: () => {
      options.invalidate.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
      toast.success(options.success);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error?.message || err.response?.data?.message || options.error);
    },
  });
}
