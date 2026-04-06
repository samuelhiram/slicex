import { NextResponse } from 'next/server';
import { withRequestId } from '../../../../instrumentation';

export async function GET() {
  const log = withRequestId();
  log.info({ msg: 'keepalive ping' });
  return NextResponse.json({ ok: true });
}
