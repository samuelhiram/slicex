import { NextResponse } from "next/server";
import { withRequestId } from "../../../../instrumentation";

export async function GET(request: Request) {
  const log = withRequestId(request.headers.get("x-request-id") ?? undefined);
  log.info({ msg: "keepalive ping" });
  return NextResponse.json({ ok: true });
}
