const express = require('express');
const { getConfig, validateConfig } = require('./lib/config');
const { createSafeFetch } = require('./lib/fetch');
const { createMusicBrainzService } = require('./lib/musicbrainz');
const { createLastfmService } = require('./lib/lastfm-service');
const { createCurrentlyPlayingHandler } = require('./lib/currently-playing-handler');
const { sleep } = require('./lib/sleep');

const app = express();
const state = {
    currentlyListening: {},
    isPollingNowPlaying: false,
    cachedProfilePicture: null,
    clientSet: new Set(),
    nowPlayingPollTimer: null,
    cleanupTimer: null,
    profilePictureRetryCount: 0,
    nowPlayingRetryCount: 0,
};

validateConfig();

const config = getConfig();

const safeFetch = createSafeFetch(config.request_timeout_ms);
const musicBrainzService = createMusicBrainzService({
    safeFetch,
    config,
});
const lastfmService = createLastfmService({
    state,
    config,
    safeFetch,
    sleep,
    getCoverFromMusicBrainz: musicBrainzService.getCoverFromMusicBrainz,
});
const handleCurrentlyPlaying = createCurrentlyPlayingHandler({
    state,
    config,
    sleep,
    startNowPlayingPolling: lastfmService.startNowPlayingPolling,
    stopNowPlayingPolling: lastfmService.stopNowPlayingPolling,
    getNowPlaying: lastfmService.getNowPlaying,
});

app.use(express.static('public'));

app.get('/api/pfp', (req, res) => {
    if (!state.cachedProfilePicture) {
        res.status(503).type('text/plain').send('Profile picture not cached yet');
        return;
    }

    res.setHeader('Content-Type', state.cachedProfilePicture.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(state.cachedProfilePicture.buffer);
});

app.get('/api/currentlyPlaying', handleCurrentlyPlaying);

app.listen(config.port, () => {
    console.log(`Listening on port ${config.port}`);
});

void lastfmService.cacheProfilePicture();
