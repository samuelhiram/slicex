import pino from 'pino';
export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base: { service: 'slicex-web' }
});
export function withRequestId(requestId) {
    return logger.child({ requestId });
}
