// Generic history wrapper for any state shape. Stack-based, with bounded depth.
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export interface HistoryLimits {
  maxDepth: number;
}

export const DEFAULT_HISTORY_LIMITS: HistoryLimits = {
  maxDepth: 200,
};

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

// Push a new present onto the stack. Drops the oldest entry if maxDepth is reached.
// Clears the redo stack — any future timeline branched off the previous present is gone.
export function pushHistory<T>(
  history: History<T>,
  next: T,
  limits: HistoryLimits = DEFAULT_HISTORY_LIMITS,
): History<T> {
  if (next === history.present) {
    return history;
  }
  const past = history.past.length >= limits.maxDepth
    ? [...history.past.slice(history.past.length - limits.maxDepth + 1), history.present]
    : [...history.past, history.present];
  return { past, present: next, future: [] };
}

// Replace the present without touching past/future. Used for transient (in-gesture, UI-only) updates.
export function replacePresent<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) {
    return history;
  }
  return { ...history, present: next };
}

// Move one step back. No-op if past is empty.
export function undoHistory<T>(history: History<T>): History<T> {
  if (history.past.length === 0) {
    return history;
  }
  const previous = history.past[history.past.length - 1]!;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

// Move one step forward. No-op if future is empty.
export function redoHistory<T>(history: History<T>): History<T> {
  if (history.future.length === 0) {
    return history;
  }
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next!,
    future: rest,
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}
