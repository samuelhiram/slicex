import { z } from "zod";

export const IDSchema = z.string().min(1);

export const TenantTypeSchema = z.enum(["PERSONAL", "ORGANIZATION"]);

export const RecurrenceRuleSchema = z.object({
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
  interval: z.number().int().min(1).optional(),
  count: z.number().int().positive().optional(),
  until: z.string().optional(),
});

export type RecurrenceRule = z.infer<typeof RecurrenceRuleSchema>;

export const FinancialObjectSchema = z.object({
  id: IDSchema,
  tenantId: IDSchema,
  name: z.string(),
  amount: z.number(),
  date: z.string(),
  durationDays: z.number().int().positive().optional(),
  recurrence: RecurrenceRuleSchema.optional().nullable(),
});

export type FinancialObject = z.infer<typeof FinancialObjectSchema>;

export const TimelineDocumentSchema = z.object({
  id: IDSchema,
  tenantId: IDSchema,
  title: z.string(),
  items: z.array(FinancialObjectSchema),
});

export type TimelineDocument = z.infer<typeof TimelineDocumentSchema>;

export const TimelineRevisionSchema = z.object({
  id: IDSchema,
  timelineId: IDSchema,
  documentJson: z.any(),
  createdAt: z.string(),
});

export type TimelineRevision = z.infer<typeof TimelineRevisionSchema>;

export const ErrorEnvelope = z.object({
  requestId: z.string().optional(),
  code: z.string(),
  message: z.string(),
  details: z.any().optional(),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export * from "./errors";
