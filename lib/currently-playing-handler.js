function createCurrentlyPlayingHandler({ state, config, sleep, startNowPlayingPolling, stopNowPlayingPolling, getNowPlaying }) {
    function cleanupStaleClients() {
        const now = Date.now();
        let removedCount = 0;

        for (const clientEntry of state.clientSet) {
            const inactiveTime = now - clientEntry.lastActivityTime;

            if (inactiveTime > config.client_timeout_ms) {
                try {
                    clientEntry.res.end();
                } catch (error) {
                    // Connection already closed
                }

                state.clientSet.delete(clientEntry);
                removedCount++;
            }
        }

        if (removedCount > 0) {
            console.log(`Cleaned up ${removedCount} stale clients, remaining: ${state.clientSet.size}`);
        }
    }

    function startClientCleanup() {
        if (state.cleanupTimer) {
            return;
        }

        state.cleanupTimer = setInterval(cleanupStaleClients, 60000);
        console.log('Client cleanup monitoring started');
    }

    function stopClientCleanup() {
        if (!state.cleanupTimer) {
            return;
        }

        clearInterval(state.cleanupTimer);
        state.cleanupTimer = null;
        console.log('Client cleanup monitoring stopped');
    }

    return async function handleCurrentlyPlaying(req, res) {
        res.setHeader('Content-Type', 'application/x-ndjson');

        if (res.flushHeaders) res.flushHeaders();

        const heartbeatMs = 25000;
        let lastSent = null;
        let closed = false;
        let lastWriteTime = Date.now();

        if (state.clientSet.size >= config.max_clients) {
            res.status(503).type('text/plain').send('Server at max capacity');
            console.warn(`Client rejected: max clients (${config.max_clients}) reached`);
            return;
        }

        const clientData = {
            res,
            connectedAt: Date.now(),
            lastActivityTime: Date.now(),
        };

        state.clientSet.add(clientData);
        console.log('New client connected, total clients:', state.clientSet.size);
        if (state.clientSet.size === 1) {
            startNowPlayingPolling();
            startClientCleanup();
            console.log('Started polling');
        }

        void getNowPlaying();
        req.on('close', () => { closed = true; });

        while (!closed) {
            const payload = JSON.stringify(state.currentlyListening ?? {});

            if (payload !== lastSent) {
                try {
                    res.write(`${payload}\n`);
                    lastSent = payload;
                    lastWriteTime = Date.now();
                    clientData.lastActivityTime = Date.now();
                } catch (error) {
                    break;
                }
            } else if (Date.now() - lastWriteTime >= heartbeatMs) {
                try {
                    res.write('\n');
                    lastWriteTime = Date.now();
                    clientData.lastActivityTime = Date.now();
                } catch (error) {
                    break;
                }
            }

            await sleep(config.fetch_interval_ms);
        }

        try {
            res.end();
        } catch (error) {
            /* connection already closed */
        } finally {
            state.clientSet.delete(clientData);
            console.log('Client disconnected, total clients:', state.clientSet.size);
            if (state.clientSet.size === 0) {
                stopNowPlayingPolling();
                stopClientCleanup();
                console.log('Stopped polling');
            }
        }
    };
}

module.exports = {
    createCurrentlyPlayingHandler,
};