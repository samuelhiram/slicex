import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const requestId =
    (process as any).env.REQUEST_ID ||
    (globalThis as any).crypto?.randomUUID?.() ||
    "req-unknown";

  const response = NextResponse.next();
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};