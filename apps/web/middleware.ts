import { NextResponse } from 'next/server';

export function middleware(req: Request) {
  const requestId = (process as any).env.REQUEST_ID || (globalThis as any).crypto?.randomUUID?.() || 'req-unknown';
  const res = NextResponse.next();
  res.headers.set('x-request-id', requestId);
  return res;
}
