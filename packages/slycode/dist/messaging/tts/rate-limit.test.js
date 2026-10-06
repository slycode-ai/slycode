import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RequestLimiter, parseRetryAfterMs } from './rate-limit.js';
import { TtsProviderError } from './errors.js';
function clock() {
    let t = 1_000_000;
    const sleeps = [];
    return {
        now: () => t,
        sleep: async (ms) => { sleeps.push(ms); t += ms; },
        advance: (ms) => { t += ms; },
        sleeps,
    };
}
test('the 11th request in a minute waits for the oldest slot to expire', async () => {
    const c = clock();
    const l = new RequestLimiter({ limit: 10, label: 'Gemini TTS', now: c.now, sleep: c.sleep });
    for (let i = 0; i < 10; i++) {
        await l.acquire('m', c.now() + 120_000);
        c.advance(1000);
    }
    assert.equal(l.waitMs('m'), 50_000);
    await l.acquire('m', c.now() + 120_000);
    assert.deepEqual(c.sleeps, [50_000]);
});
test('a wait that would pass the deadline fails at once, naming the seconds', async () => {
    const c = clock();
    const l = new RequestLimiter({ limit: 2, label: 'Gemini TTS', now: c.now, sleep: c.sleep });
    await l.acquire('m', c.now() + 20_000);
    await l.acquire('m', c.now() + 20_000);
    await assert.rejects(l.acquire('m', c.now() + 20_000), (e) => e instanceof TtsProviderError && e.code === 'rate_limited' && e.status === 429 && /2 requests\/min.*next slot in 60 s/.test(e.message));
    assert.deepEqual(c.sleeps, [], 'never slept');
});
test('keys are independent (Flash and Flash-Lite have separate quotas)', async () => {
    const c = clock();
    const l = new RequestLimiter({ limit: 1, label: 'x', now: c.now, sleep: c.sleep });
    await l.acquire('flash', c.now() + 1000);
    await l.acquire('lite', c.now() + 1000);
    assert.equal(l.waitMs('flash'), 60_000);
    assert.equal(l.waitMs('lite'), 60_000);
});
test('a provider 429 blocks the model until its retry hint has passed', async () => {
    const c = clock();
    const l = new RequestLimiter({ limit: 10, label: 'Gemini TTS', now: c.now, sleep: c.sleep });
    l.noteRejected('m', 30_000);
    await assert.rejects(l.acquire('m', c.now() + 10_000), /next slot in 30 s/);
    await l.acquire('m', c.now() + 60_000);
    assert.deepEqual(c.sleeps, [30_000]);
});
test('a waiting acquire is cancelled by its signal', async () => {
    const l = new RequestLimiter({ limit: 1, label: 'x' });
    await l.acquire('m', Date.now() + 120_000);
    const ac = new AbortController();
    const p = l.acquire('m', Date.now() + 120_000, ac.signal);
    ac.abort(new Error('caller left'));
    await assert.rejects(p, /caller left/);
});
test('retry hints parse from the message or RetryInfo; default 60 s', () => {
    assert.equal(parseRetryAfterMs({ error: { message: 'Quota exceeded ... Please retry in 51.372881596s.' } }), 51_373);
    assert.equal(parseRetryAfterMs({ error: { message: 'x', details: [{ '@type': 'RetryInfo', retryDelay: '12s' }] } }), 12_000);
    assert.equal(parseRetryAfterMs({}), 60_000);
});
//# sourceMappingURL=rate-limit.test.js.map