import { z } from 'zod';

export const productSchema = z.object({
  code: z.string().min(1, 'Product code is required'),
  nameAr: z.string().min(1, 'Arabic name is required'),
  nameEn: z.string().optional(),
  type: z.enum(['goods', 'service']),
  barcode: z.string().optional(),
  sku: z.string().optional(),
  categoryId: z.string().min(1, 'Category is required'),
  unitId: z.string().min(1, 'Unit is required'),
  costPrice: z.string().optional(),
  sellPrice: z.string().optional(),
  reorderLevel: z.string().optional(),
  reorderQty: z.string().optional(),
  description: z.string().optional(),
});

export type ProductFormData = z.infer<typeof productSchema>;
