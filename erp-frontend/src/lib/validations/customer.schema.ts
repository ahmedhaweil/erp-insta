import { z } from 'zod';

export const customerSchema = z.object({
  code: z.string().min(1, 'Customer code is required'),
  nameAr: z.string().min(1, 'Arabic name is required'),
  nameEn: z.string().optional(),
  phone: z.string().min(1, 'Phone is required'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  taxId: z.string().optional(),
  address: z.string().optional(),
  creditLimit: z.string().optional(),
});

export type CustomerFormData = z.infer<typeof customerSchema>;
