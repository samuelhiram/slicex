import { NextResponse } from "next/server";
import { makeErrorEnvelope } from "@slicex/contracts";
export function respondWithError(code, message, status = 500) {
    const env = makeErrorEnvelope(code, message);
    return NextResponse.json(env, { status });
}
