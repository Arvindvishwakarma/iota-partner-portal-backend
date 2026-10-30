import { z } from 'zod';

export const reportFilterSchema = z.object({
  startDate: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  endDate: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  city: z.string().max(100).optional(),
  partnerId: z.string().uuid().optional(),
  counsellorId: z.string().uuid().optional()
});

export const exportQuerySchema = z.object({
  type: z.enum(['leads', 'settlements', 'partners', 'visits'], {
    errorMap: () => ({ message: "Export type must be 'leads', 'settlements', 'partners', or 'visits'" })
  }),
  format: z.enum(['csv']).default('csv'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  city: z.string().optional(),
  status: z.string().optional()
});

export type ReportFilterInput = z.infer<typeof reportFilterSchema>;
export type ExportQueryInput = z.infer<typeof exportQuerySchema>;
