export type TenantType = "PERSONAL" | "ORGANIZATION";

export interface Tenant {
  id: string;
  type: TenantType;
  name?: string;
  createdAt: string;
}

export type ID = string;

export interface RecurrenceRule {
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval?: number; // default 1
  count?: number;
  until?: string; // ISO date
}

export interface FinancialObject {
  id: ID;
  tenantId: ID;
  name: string;
  amount: number; // positive income, negative expense
  date: string; // ISO date of first occurrence
  durationDays?: number;
  recurrence?: RecurrenceRule | null;
}

export interface TimelineDocument {
  id: ID;
  tenantId: ID;
  title: string;
  items: FinancialObject[];
}
