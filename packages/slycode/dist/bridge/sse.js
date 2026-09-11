export function formatSseEvent(event, payload) {
    return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}
/**
 * Write one event to every client in `clients`. Dead clients (write throws)
 * are removed from the set. Returns counts so callers can update client
 * bookkeeping when `dead > 0`.
 */
export function broadcastSse(clients, event, payload, opts = {}) {
    const frame = formatSseEvent(event, payload);
    const dead = [];
    let sent = 0;
    let skipped = 0;
    for (const client of clients) {
        if (opts.maxWritableLength !== undefined) {
            const queued = client.socket?.writableLength ?? 0;
            if (queued > opts.maxWritableLength) {
                skipped++;
                opts.onSkipped?.(client);
                continue;
            }
        }
        try {
            client.write(frame);
            sent++;
        }
        catch {
            dead.push(client);
        }
    }
    for (const client of dead)
        clients.delete(client);
    return { sent, dead: dead.length, skipped };
}
//# sourceMappingURL=sse.js.map