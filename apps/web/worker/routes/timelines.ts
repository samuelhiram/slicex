import { Hono } from "hono";
import { z } from "zod";
import {
  ERROR_CODES,
  TimelineDocumentSchema,
  makeErrorEnvelope,
  statusForError,
  type ErrorCode,
} from "@slicex/contracts";
import {
  createTimelineRevisionAndSetHead,
  getTimelineById,
} from "@slicex/db";
import { getDb } from "../db";
import type { Env, Variables } from "../env";

export const timelines = new Hono<{ Bindings: Env; Variables: Variables }>();

const ParamsSchema = z.object({ timelineId: z.string().min(1) });

function errorResponse(
  code: ErrorCode,
  message: string,
  requestId?: string,
  details?: unknown,
) {
  return Response.json(makeErrorEnvelope(code, message, details, requestId), {
    status: statusForError(code),
  });
}

timelines.get("/timelines/:timelineId", async (c) => {
  const requestId = c.get("requestId");
  const log = c.get("logger");

  const parsed = ParamsSchema.safeParse({ timelineId: c.req.param("timelineId") });
  if (!parsed.success) {
    return errorResponse(
      ERROR_CODES.INPUT_VALIDATION_FAILED,
      "Invalid params",
      requestId,
      parsed.error.flatten(),
    );
  }

  try {
    const db = getDb(c.env);
    const timeline = await getTimelineById(parsed.data.timelineId, db);
    if (!timeline) {
      return errorResponse(
        ERROR_CODES.TIMELINE_NOT_FOUND,
        "Not found",
        requestId,
      );
    }
    log.info({ timelineId: parsed.data.timelineId }, "fetched timeline");
    return c.json({ data: timeline });
  } catch (error) {
    log.error(
      { err: String(error), timelineId: parsed.data.timelineId },
      "failed to fetch timeline",
    );
    return errorResponse(
      ERROR_CODES.INTERNAL_UNEXPECTED,
      "Unexpected error",
      requestId,
    );
  }
});

timelines.put("/timelines/:timelineId", async (c) => {
  const requestId = c.get("requestId");
  const log = c.get("logger");

  const parsedParams = ParamsSchema.safeParse({
    timelineId: c.req.param("timelineId"),
  });
  if (!parsedParams.success) {
    return errorResponse(
      ERROR_CODES.INPUT_VALIDATION_FAILED,
      "Invalid params",
      requestId,
      parsedParams.error.flatten(),
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorResponse(
      ERROR_CODES.INPUT_VALIDATION_FAILED,
      "Invalid body",
      requestId,
      { reason: "Request body must be valid JSON" },
    );
  }

  const parsedBody = TimelineDocumentSchema.safeParse(body);
  if (!parsedBody.success) {
    return errorResponse(
      ERROR_CODES.TIMELINE_INVALID_DOCUMENT,
      "Invalid timeline document",
      requestId,
      parsedBody.error.flatten(),
    );
  }

  if (parsedBody.data.id !== parsedParams.data.timelineId) {
    return errorResponse(
      ERROR_CODES.TIMELINE_INVALID_DOCUMENT,
      "Timeline document id must match timelineId",
      requestId,
      {
        timelineId: parsedParams.data.timelineId,
        documentId: parsedBody.data.id,
      },
    );
  }

  try {
    const db = getDb(c.env);
    const timeline = await getTimelineById(parsedParams.data.timelineId, db);
    if (!timeline) {
      return errorResponse(
        ERROR_CODES.TIMELINE_NOT_FOUND,
        "Not found",
        requestId,
      );
    }

    if (parsedBody.data.tenantId !== timeline.tenantId) {
      return errorResponse(
        ERROR_CODES.TIMELINE_INVALID_DOCUMENT,
        "Timeline document tenantId does not match persisted timeline",
        requestId,
        {
          expectedTenantId: timeline.tenantId,
          documentTenantId: parsedBody.data.tenantId,
        },
      );
    }

    const revision = await createTimelineRevisionAndSetHead(
      parsedParams.data.timelineId,
      parsedBody.data,
      parsedBody.data.title,
      db,
    );

    log.info(
      { timelineId: parsedParams.data.timelineId, revId: revision.id },
      "created revision",
    );
    return c.json({ data: revision });
  } catch (error) {
    log.error(
      { err: String(error), timelineId: parsedParams.data.timelineId },
      "failed to create revision",
    );
    return errorResponse(
      ERROR_CODES.INTERNAL_UNEXPECTED,
      "Unexpected error",
      requestId,
    );
  }
});
