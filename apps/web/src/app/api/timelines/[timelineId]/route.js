import { NextResponse } from "next/server";
import { makeErrorEnvelope, TimelineDocumentSchema } from "@slicex/contracts";
import { createTimelineRevisionAndSetHead, getTimelineById as dbGetTimelineById, } from "@slicex/db";
import { z } from "zod";
import { withRequestId } from "../../../../instrumentation";
const ParamsSchema = z.object({ timelineId: z.string().min(1) });
function requestIdFrom(request) {
    return request.headers.get("x-request-id") ?? undefined;
}
function errorResponse(code, message, status, requestId, details) {
    return NextResponse.json(makeErrorEnvelope(code, message, details, requestId), {
        status,
    });
}
export async function GET(request, ctx) {
    const requestId = requestIdFrom(request);
    const log = withRequestId(requestId);
    try {
        const parsed = ParamsSchema.safeParse(ctx.params);
        if (!parsed.success) {
            return errorResponse("INPUT_VALIDATION_FAILED", "Invalid params", 400, requestId, parsed.error.flatten());
        }
        const timeline = await dbGetTimelineById(parsed.data.timelineId);
        if (!timeline) {
            return errorResponse("TIMELINE_NOT_FOUND", "Not found", 404, requestId);
        }
        log.info({ timelineId: parsed.data.timelineId, msg: "fetched timeline" });
        return NextResponse.json({ data: timeline });
    }
    catch (error) {
        log.error({ err: error, timelineId: ctx.params.timelineId }, "failed to fetch timeline");
        return errorResponse("INTERNAL_UNEXPECTED", "Unexpected error", 500, requestId);
    }
}
export async function PUT(request, ctx) {
    const requestId = requestIdFrom(request);
    const log = withRequestId(requestId);
    try {
        const parsedParams = ParamsSchema.safeParse(ctx.params);
        if (!parsedParams.success) {
            return errorResponse("INPUT_VALIDATION_FAILED", "Invalid params", 400, requestId, parsedParams.error.flatten());
        }
        const timeline = await dbGetTimelineById(parsedParams.data.timelineId);
        if (!timeline) {
            return errorResponse("TIMELINE_NOT_FOUND", "Not found", 404, requestId);
        }
        const body = await request.json().catch(() => null);
        if (body == null) {
            return errorResponse("INPUT_VALIDATION_FAILED", "Invalid body", 400, requestId, { reason: "Request body must be valid JSON" });
        }
        const parsedBody = TimelineDocumentSchema.safeParse(body);
        if (!parsedBody.success) {
            return errorResponse("TIMELINE_INVALID_DOCUMENT", "Invalid timeline document", 400, requestId, parsedBody.error.flatten());
        }
        if (parsedBody.data.id !== parsedParams.data.timelineId) {
            return errorResponse("TIMELINE_INVALID_DOCUMENT", "Timeline document id must match timelineId", 400, requestId, {
                timelineId: parsedParams.data.timelineId,
                documentId: parsedBody.data.id,
            });
        }
        if (parsedBody.data.tenantId !== timeline.tenantId) {
            return errorResponse("TIMELINE_INVALID_DOCUMENT", "Timeline document tenantId does not match persisted timeline", 400, requestId, {
                expectedTenantId: timeline.tenantId,
                documentTenantId: parsedBody.data.tenantId,
            });
        }
        const revision = await createTimelineRevisionAndSetHead(parsedParams.data.timelineId, parsedBody.data, parsedBody.data.title);
        log.info({
            timelineId: parsedParams.data.timelineId,
            revId: revision.id,
            msg: "created revision",
        });
        return NextResponse.json({ data: revision });
    }
    catch (error) {
        log.error({ err: error, timelineId: ctx.params.timelineId }, "failed to create revision");
        return errorResponse("INTERNAL_UNEXPECTED", "Unexpected error", 500, requestId);
    }
}
