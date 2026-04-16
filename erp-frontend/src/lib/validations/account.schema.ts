import { z } from 'zod';

export const accountSchema = z.object({
  code: z.string().min(1, 'Account code is required'),
  nameAr: z.string().min(1, 'Arabic name is required'),
  nameEn: z.string().optional(),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  parentId: z.string().optional(),
  description: z.string().optional(),
});

export type AccountFormData = z.infer<typeof accountSchema>;
