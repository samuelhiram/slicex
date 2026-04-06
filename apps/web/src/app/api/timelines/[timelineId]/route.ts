import { NextResponse } from "next/server";
import {
  getTimelineById as dbGetTimelineById,
  createTimelineRevision,
} from "@slicex/db";
import { z } from "zod";
import { withRequestId } from "../../../../instrumentation";

const ParamsSchema = z.object({ timelineId: z.string() });

export async function GET(_req: Request, ctx: { params: any }) {
  const log = withRequestId();
  const parsed = ParamsSchema.safeParse(ctx.params);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INPUT_VALIDATION_FAILED", message: "Invalid params" },
      { status: 400 },
    );
  }
  const timeline = await dbGetTimelineById(parsed.data.timelineId);
  if (!timeline)
    return NextResponse.json(
      { code: "TIMELINE_NOT_FOUND", message: "Not found" },
      { status: 404 },
    );
  log.info({ timelineId: parsed.data.timelineId, msg: "fetched timeline" });
  return NextResponse.json({ data: timeline });
}

export async function PUT(req: Request, ctx: { params: any }) {
  const log = withRequestId();
  const parsed = ParamsSchema.safeParse(ctx.params);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INPUT_VALIDATION_FAILED", message: "Invalid params" },
      { status: 400 },
    );
  }
  const body = await req.json().catch(() => null);
  if (!body)
    return NextResponse.json(
      { code: "INPUT_VALIDATION_FAILED", message: "Invalid body" },
      { status: 400 },
    );
  // create new revision
  const rev = await createTimelineRevision(parsed.data.timelineId, body);
  log.info({
    timelineId: parsed.data.timelineId,
    revId: rev.id,
    msg: "created revision",
  });
  return NextResponse.json({ data: rev });
}
