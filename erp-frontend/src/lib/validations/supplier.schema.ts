import { z } from 'zod';

export const supplierSchema = z.object({
  code: z.string().min(1, 'Supplier code is required'),
  nameAr: z.string().min(1, 'Arabic name is required'),
  nameEn: z.string().optional(),
  phone: z.string().min(1, 'Phone is required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  taxId: z.string().optional(),
  address: z.string().optional(),
});

export type SupplierFormData = z.infer<typeof supplierSchema>;
