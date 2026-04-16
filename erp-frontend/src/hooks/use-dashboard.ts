'use client';

import { useQuery } from '@tanstack/react-query';
import { reportsService } from '@/services/reports.service';

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => reportsService.getDashboard(),
    refetchInterval: 60 * 1000, // Refresh every minute
  });
}

export function useTrialBalance(from?: string, to?: string) {
  return useQuery({
    queryKey: ['trial-balance', from, to],
    queryFn: () => reportsService.getTrialBalance(from, to),
  });
}

export function useProfitLoss(from?: string, to?: string) {
  return useQuery({
    queryKey: ['profit-loss', from, to],
    queryFn: () => reportsService.getProfitLoss(from, to),
  });
}

export function useBalanceSheet(asOf?: string) {
  return useQuery({
    queryKey: ['balance-sheet', asOf],
    queryFn: () => reportsService.getBalanceSheet(asOf),
  });
}
