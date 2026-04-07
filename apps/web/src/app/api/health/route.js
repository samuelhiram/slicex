import { NextResponse } from "next/server";
import { withRequestId } from "../../../../instrumentation";
export async function GET(request) {
    const log = withRequestId(request.headers.get("x-request-id") ?? undefined);
    log.info({ msg: "health check" });
    return NextResponse.json({ ok: true });
}
