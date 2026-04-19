import { z } from 'zod';

export const warehouseSchema = z.object({
  code: z.string().min(1, 'Warehouse code is required'),
  nameAr: z.string().min(1, 'Arabic name is required'),
  nameEn: z.string().optional(),
  branchId: z.string().min(1, 'Branch ID is required'),
  address: z.string().optional(),
});

export type WarehouseFormData = z.infer<typeof warehouseSchema>;
