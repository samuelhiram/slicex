import { NextResponse } from "next/server";
import { makeErrorEnvelope } from "@slicex/contracts";

export function respondWithError(code: string, message: string, status = 500) {
  const env = makeErrorEnvelope(code as any, message);
  return NextResponse.json(env, { status });
}
