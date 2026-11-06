import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_RETURN_POLICY as p, reduceActiveReturn, parseReturnState } from "../lib/analytics-return";
import { observeActiveReturns } from "../lib/analytics-return-browser";
const start = Date.parse('2026-11-01T12:00:00Z');
const visit = (now = start) => ({ now, kind: 'visit' as const, visible: true, trusted: false });
const active = (now: number) => ({ now, kind: 'interaction' as const, visible: true, trusted: true });
describe('active return contract', () => {
  it('records one measured first visit; passive, hidden and synthetic activity never returns', () => {
    const first = reduceActiveReturn(null, visit());
    assert.deepEqual(first.events.map(e => e.name), [p.firstVisitEvent]);
    assert.deepEqual(reduceActiveReturn(first.state, visit(start + p.minimumGapMs)).events, []);
    assert.deepEqual(reduceActiveReturn(first.state, { ...active(start + p.minimumGapMs), trusted: false }).events, []);
    assert.deepEqual(reduceActiveReturn(first.state, { ...active(start + p.minimumGapMs), visible: false }).events, []);
  });
  it('requires a new idle session at least three hours later and counts only once', () => {
    const first = reduceActiveReturn(null, visit()).state;
    assert.deepEqual(reduceActiveReturn(first, active(start + p.minimumGapMs - 1)).events, []);
    const next = reduceActiveReturn(first, active(start + p.minimumGapMs));
    assert.deepEqual(next.events.map(e => e.name), [p.returnEvent]);
    assert.equal(next.events[0].params.oh_cohort_date, '2026-11-01');
    assert.deepEqual(reduceActiveReturn(next.state, active(start + 2 * p.minimumGapMs)).events, []);
  });
  it('never turns continuous activity into a return', () => {
    let state = reduceActiveReturn(null, visit()).state;
    for (let now = start + 60000; now < start + p.minimumGapMs + 60000; now += 60000) {
      const next = reduceActiveReturn(state, active(now));
      assert.deepEqual(next.events, [], `continuous session at ${now}: expected no return`);
      state = next.state;
    }
  });
  it('refuses expired returns, corrupt state, bad policy and a backwards clock', () => {
    const first = reduceActiveReturn(null, visit()).state;
    assert.deepEqual(reduceActiveReturn(first, active(start + p.observationWindowMs + 1)).events, []);
    assert.throws(() => parseReturnState('invalid', p));
    assert.throws(() => parseReturnState(JSON.stringify({ version: p.version }), p), /firstSeenAt/);
    assert.throws(() => reduceActiveReturn(first, active(start - 1)), /backwards/);
    assert.throws(() => reduceActiveReturn(null, visit(), { ...p, minimumGapMs: -1 }), /minimumGapMs/);
  });
  it('starts changed contracts from the first newly measured visit', () => {
    const first = reduceActiveReturn(null, visit()).state;
    const next = reduceActiveReturn(first, visit(start + 1000), { ...p, version: 'v2' });
    assert.equal(next.state?.firstSeenAt, start + 1000);
  });
  it('respects consent and surfaces storage failure', () => {
    const events: string[] = [], errors: Error[] = []; let consent = false;
    const handlers = new Map<string, EventListener>();
    const stop = observeActiveReturns({ document: { visibilityState: 'visible',
      addEventListener: (n, f) => { handlers.set(n, f as EventListener); }, removeEventListener: n => { handlers.delete(n); } },
      storage: { getItem: () => { throw Error('storage denied'); }, setItem: () => {} },
      now: () => start, consented: () => consent, send: n => { events.push(n); return true; }, onError: e => errors.push(e) });
    assert.deepEqual(events, []); assert.deepEqual(errors, []);
    consent = true; handlers.get('visibilitychange')!(new Event('visibilitychange'));
    assert.equal(errors[0].message, 'storage denied'); assert.deepEqual(events, []);
    stop(); assert.equal(handlers.size, 0);
  });
});
