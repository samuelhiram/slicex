import { NextResponse } from 'next/server';
export function middleware(req) {
    const requestId = process.env.REQUEST_ID || globalThis.crypto?.randomUUID?.() || 'req-unknown';
    const res = NextResponse.next();
    res.headers.set('x-request-id', requestId);
    return res;
}
