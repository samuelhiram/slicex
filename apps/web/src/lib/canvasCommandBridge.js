function createStableId(prefix) {
    const randomId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    return `${prefix}-${randomId}`;
}
function toUtcMidnightIso(value) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())).toISOString();
}
function parseDate(value) {
    if (value == null) {
        return null;
    }
    const parsed = value instanceof Date ? new Date(value) : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function toUtcMidnight(value) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
function addDays(date, days) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
function normalizeDurationDays(value) {
    return Math.max(1, Math.round(value ?? 1));
}
function moveItem(items, fromIndex, toIndex) {
    if (fromIndex === toIndex) {
        return items.slice();
    }
    const nextItems = items.slice();
    const [moved] = nextItems.splice(fromIndex, 1);
    nextItems.splice(Math.max(0, Math.min(toIndex, nextItems.length)), 0, moved);
    return nextItems;
}
function createDraftDocument() {
    return {
        id: createStableId("timeline"),
        tenantId: createStableId("tenant"),
        title: "Untitled timeline",
        items: [],
    };
}
function createDraftItem(document, date, durationDays) {
    return {
        id: createStableId("item"),
        tenantId: document.tenantId,
        name: "New item",
        amount: 0,
        date,
        durationDays,
        recurrence: null,
    };
}
function ensureDocument(document) {
    return document ?? createDraftDocument();
}
function insertItem(document, command) {
    const nextDocument = ensureDocument(document);
    const nextItems = nextDocument.items.slice();
    const insertIndex = Math.max(0, Math.min(command.trackIndex, nextItems.length));
    nextItems.splice(insertIndex, 0, createDraftItem(nextDocument, command.date, normalizeDurationDays(command.durationDays)));
    return {
        ...nextDocument,
        items: nextItems,
    };
}
function moveTimelineItem(document, command) {
    if (!document) {
        return document;
    }
    const fromIndex = document.items.findIndex((item) => item.id === command.itemId);
    if (fromIndex < 0) {
        return document;
    }
    const nextItems = moveItem(document.items, fromIndex, command.trackIndex).map((item) => item.id === command.itemId
        ? {
            ...item,
            date: command.date,
        }
        : item);
    return {
        ...document,
        items: nextItems,
    };
}
function resizeTimelineItem(document, command) {
    if (!document) {
        return document;
    }
    const nextItems = document.items.map((item) => {
        if (item.id !== command.itemId) {
            return item;
        }
        if (command.edge === "end") {
            return {
                ...item,
                date: command.date,
                durationDays: normalizeDurationDays(command.durationDays),
            };
        }
        const currentStart = parseDate(item.date) ?? parseDate(command.date);
        const currentDurationDays = normalizeDurationDays(item.durationDays);
        const currentEnd = currentStart
            ? addDays(currentStart, currentDurationDays - 1)
            : parseDate(command.date) ?? new Date();
        const nextStart = parseDate(command.date) ?? currentStart ?? currentEnd;
        const clampedStart = nextStart && currentEnd && nextStart.getTime() > currentEnd.getTime()
            ? currentEnd
            : nextStart ?? currentEnd;
        return {
            ...item,
            date: toUtcMidnightIso(clampedStart ?? new Date()),
            durationDays: normalizeDurationDays(command.durationDays),
        };
    });
    return {
        ...document,
        items: nextItems,
    };
}
export function resolveInitialViewportOriginDate(snapshot) {
    const explicitOriginDate = parseDate(snapshot.viewport?.originDate);
    if (explicitOriginDate) {
        return toUtcMidnightIso(explicitOriginDate);
    }
    const candidates = [];
    for (const item of snapshot.document?.items ?? []) {
        const itemDate = parseDate(item.date);
        if (itemDate) {
            candidates.push(itemDate);
        }
    }
    const playheadDate = parseDate(snapshot.playheadAt);
    if (playheadDate) {
        candidates.push(playheadDate);
    }
    if (candidates.length === 0) {
        return toUtcMidnightIso(new Date());
    }
    const earliest = candidates.reduce((minimum, candidate) => candidate.getTime() < minimum.getTime() ? candidate : minimum);
    return toUtcMidnightIso(earliest);
}
export function createDraftTimelineDocument() {
    return createDraftDocument();
}
export function applyCanvasCommand(command, port) {
    const snapshot = port.getState();
    switch (command.type) {
        case "viewport/set": {
            port.setViewport({
                ...snapshot.viewport,
                ...command.viewport,
                originDate: command.viewport.originDate ?? snapshot.viewport?.originDate ?? null,
            });
            return;
        }
        case "playhead/set": {
            port.setPlayheadAt(command.playheadAt);
            return;
        }
        case "item/insert": {
            port.patchDocument((document) => insertItem(document, command));
            return;
        }
        case "item/move": {
            port.patchDocument((document) => moveTimelineItem(document, command));
            return;
        }
        case "item/resize": {
            port.patchDocument((document) => resizeTimelineItem(document, command));
            return;
        }
    }
}
