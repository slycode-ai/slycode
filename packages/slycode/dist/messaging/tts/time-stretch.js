/** Int16 PCM → Float32 in [-1, 1] (copies, so odd Buffer offsets are fine). */
function toFloat(data) {
    const n = data.length >> 1;
    const i16 = new Int16Array(n);
    new Uint8Array(i16.buffer).set(data.subarray(0, n * 2));
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++)
        f[i] = i16[i] / 32768;
    return f;
}
/** Similarity of two segments, sampling every `step`th point. */
function corr(x, a, b, len, step) {
    let s = 0;
    for (let i = 0; i < len; i += step)
        s += x[a + i] * x[b + i];
    return s;
}
export function timeStretch(pcm, factor) {
    if (!Number.isFinite(factor) || factor <= 0)
        throw new RangeError(`invalid speed factor ${factor}`);
    if (Math.abs(factor - 1) < 1e-3)
        return pcm;
    const rate = pcm.sampleRate;
    const src = toFloat(pcm.data);
    const n = src.length;
    const W = Math.max(64, Math.round(rate * 0.03)); // 30 ms analysis window
    const H = Math.round(W / 2); // 50% overlap
    const S = Math.round(rate * 0.01); // ±10 ms similarity search
    if (n < W + 2 * S)
        return pcm; // too short to stretch meaningfully
    // Pad H zeros in front and W + 2S behind, so the first and the LAST input
    // samples sit inside full-weight windows and every frame up to the end of
    // the input is rendered (P2, #0369: the final window used to be dropped,
    // silencing the tail). Frame 0 is identity-aligned, so the output starts at
    // P; it ends where the frame carrying the last input sample put it (tracked
    // exactly), so both the first and the last sample survive. Length is
    // n / factor within about one window.
    const P = H;
    const x = new Float32Array(P + n + W + 2 * S);
    x.set(src, P);
    const N = x.length;
    const inputEnd = P + n;
    const win = new Float32Array(W);
    for (let i = 0; i < W; i++)
        win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (W - 1));
    const outLen = Math.ceil(inputEnd / factor) + 2 * W;
    const y = new Float32Array(outLen);
    const norm = new Float32Array(outLen);
    let prev = 0;
    let outPos = 0;
    let lastOut = -1; // output index of the last input sample
    for (let k = 0;; k++) {
        const nominal = Math.round(k * H * factor);
        if (nominal >= inputEnd || outPos + W > outLen)
            break;
        let best = Math.min(nominal, N - W);
        if (k > 0) {
            // Pick the segment near `nominal` that best continues the previous one:
            // a coarse pass (every 3rd offset, every 4th sample), then a fine pass.
            const target = prev + H;
            if (target + W <= N) {
                let bestScore = -Infinity;
                for (let d = -S; d <= S; d += 3) {
                    const c = nominal + d;
                    if (c < 0 || c + W > N)
                        continue;
                    const score = corr(x, target, c, W, 4);
                    if (score > bestScore) {
                        bestScore = score;
                        best = c;
                    }
                }
                const coarse = best;
                bestScore = corr(x, target, coarse, W, 2); // same resolution as the fine pass
                for (let c = coarse - 2; c <= coarse + 2; c++) {
                    if (c < 0 || c + W > N || c === coarse)
                        continue;
                    const score = corr(x, target, c, W, 2);
                    if (score > bestScore) {
                        bestScore = score;
                        best = c;
                    }
                }
            }
        }
        for (let i = 0; i < W; i++) {
            y[outPos + i] += x[best + i] * win[i];
            norm[outPos + i] += win[i];
        }
        if (best <= inputEnd - 1 && inputEnd - 1 < best + W)
            lastOut = Math.max(lastOut, outPos + (inputEnd - 1 - best));
        prev = best;
        outPos += H;
    }
    const start = P;
    const end = lastOut >= 0 ? lastOut + 1 : Math.round(inputEnd / factor);
    const len = Math.max(0, Math.min(end, outLen) - start);
    const out = new Int16Array(len);
    for (let i = 0; i < len; i++) {
        const j = start + i;
        const v = norm[j] > 1e-3 ? y[j] / norm[j] : 0;
        out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    }
    return { data: Buffer.from(out.buffer, out.byteOffset, out.byteLength), sampleRate: rate };
}
//# sourceMappingURL=time-stretch.js.map