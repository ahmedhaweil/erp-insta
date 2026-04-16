'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountingService } from '@/services/accounting.service';
import { toast } from 'sonner';

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountingService.getAccounts(),
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => accountingService.createAccount(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] });
      toast.success('Account created successfully');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to create account');
    },
  });
}

export function useJournalEntries() {
  return useQuery({
    queryKey: ['journal-entries'],
    queryFn: () => accountingService.getJournalEntries(),
  });
}

export function useJournalEntry(id: string) {
  return useQuery({
    queryKey: ['journal-entries', id],
    queryFn: () => accountingService.getJournalEntry(id),
    enabled: !!id,
  });
}

export function usePostJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => accountingService.postJournalEntry(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal-entries'] });
      toast.success('Journal entry posted');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to post journal entry');
    },
  });
}
