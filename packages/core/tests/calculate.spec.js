import { describe, it, expect } from 'vitest';
import { calculateBalanceAt } from '../src/calculateBalanceAt';
describe('calculateBalanceAt', () => {
    it('sums one-time items correctly', () => {
        const doc = {
            id: 't1',
            tenantId: 'tenant1',
            title: 'test',
            items: [
                { id: 'a', tenantId: 'tenant1', name: 'income', amount: 100, date: '2026-01-01', recurrence: null }
            ]
        };
        expect(calculateBalanceAt(doc, '2026-01-02')).toBe(100);
        expect(calculateBalanceAt(doc, '2025-12-31')).toBe(0);
    });
});
