// The open form survives a reload: what the person was writing (the item
// editor, "Registrar") is kept in sessionStorage while the form is
// open and reopened as it was after a reload of the tab. Closing the form
// (Guardar, Cancelar, ×, Escape) forgets it. sessionStorage, not
// localStorage: it lives with the tab (a reload keeps it; another tab or a
// new visit never brings back a stale half-written form).
//
// Never throws: blocked / full / corrupted storage just means "nothing to
// restore". What is read back is checked for shape before it reaches a form.
import type { FinancialItem, FinancialItemKind } from "@slicex/core";
import type { FinancialPlacement } from "./bridge-api";
import type { CaptureValues } from "./components/MovementCaptureDialog";

export const FORM_DRAFT_KEY = "slicex.form-draft.v1";

/** The editor's own choices that are not in the item ("Termina" by date / count, a loan's interest). */
export interface EditorDraftUi {
  endBy: "date" | "count";
  loanInterest: boolean;
}

export type FormDraft =
  | { form: "editor"; mode: "edit"; itemId: string; values: FinancialItem; ui?: EditorDraftUi }
  | {
      form: "editor";
      mode: "create";
      values: FinancialItem;
      placement?: FinancialPlacement;
      ui?: EditorDraftUi;
    }
  | { form: "capture"; movementId: string | null; values: CaptureValues };

const KINDS: ReadonlySet<FinancialItemKind> = new Set([
  "income",
  "expense",
  "loan",
  "credit-card",
  "card-purchase",
  "installment-plan",
]);

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A half-written item: right kind, id, name and schedule start; amounts may be missing. */
function isItemDraft(value: unknown): value is FinancialItem {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.name !== "string") return false;
  if (typeof value.kind !== "string" || !KINDS.has(value.kind as FinancialItemKind)) return false;
  const rule = value.recurrence;
  return isRecord(rule) && typeof rule.frequency === "string" && typeof rule.startDate === "string";
}

function editorUi(value: unknown): EditorDraftUi | undefined {
  if (!isRecord(value)) return undefined;
  if (value.endBy !== "date" && value.endBy !== "count") return undefined;
  return { endBy: value.endBy, loanInterest: value.loanInterest === true };
}

const CAPTURE_TEXT_FIELDS = ["amount", "concept", "category", "paidWith", "date", "time", "notes"] as const;

function isCaptureValues(value: unknown): value is CaptureValues {
  if (!isRecord(value)) return false;
  if (value.kind !== "expense" && value.kind !== "income") return false;
  return CAPTURE_TEXT_FIELDS.every((field) => typeof value[field] === "string");
}

/** The draft as stored, checked (null: nothing usable). Exported for tests. */
export function parseFormDraft(raw: string | null): FormDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  switch (value.form) {
    case "editor": {
      if (!isItemDraft(value.values)) return null;
      const ui = editorUi(value.ui);
      if (value.mode === "edit") {
        if (typeof value.itemId !== "string" || value.itemId === "") return null;
        return { form: "editor", mode: "edit", itemId: value.itemId, values: value.values, ...(ui ? { ui } : {}) };
      }
      if (value.mode !== "create") return null;
      const placement =
        isRecord(value.placement) && Number.isInteger(value.placement.trackIndex)
          ? { trackIndex: value.placement.trackIndex as number }
          : undefined;
      return {
        form: "editor",
        mode: "create",
        values: value.values,
        ...(placement ? { placement } : {}),
        ...(ui ? { ui } : {}),
      };
    }
    case "capture": {
      if (!isCaptureValues(value.values)) return null;
      const movementId = typeof value.movementId === "string" && value.movementId ? value.movementId : null;
      return { form: "capture", movementId, values: value.values };
    }
    default:
      return null;
  }
}

export function loadFormDraft(): FormDraft | null {
  try {
    return parseFormDraft(storage()?.getItem(FORM_DRAFT_KEY) ?? null);
  } catch {
    return null;
  }
}

export function saveFormDraft(draft: FormDraft): void {
  try {
    storage()?.setItem(FORM_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // full / blocked: the form just won't survive a reload
  }
}

export function clearFormDraft(): void {
  try {
    storage()?.removeItem(FORM_DRAFT_KEY);
  } catch {
    // nothing to clear
  }
}
