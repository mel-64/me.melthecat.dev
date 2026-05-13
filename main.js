const express = require('express')
const getenv = require('getenv')
const app = express()

const port = 3000
const max_clients = getenv.int('MAX_CLIENTS', 100);
const client_timeout_ms = getenv.int('CLIENT_TIMEOUT_MS', 300000); // 5 minutes
const lastfm_user = getenv.string('LASTFM_USER');
const fetch_interval_ms = getenv.int('FETCH_INTERVAL_MS', 3000);
const request_timeout_ms = getenv.int('REQUEST_TIMEOUT_MS', 5000);
const gravatar_url = getenv.string('GRAVATAR_URL', 'https://gravatar.com/avatar/1b5e72e77dfd844154dcb15de04a3a63e02cca25cad1e72313cdd55716f46701?s=753');
const lastfm_base_url = "https://ws.audioscrobbler.com/2.0/?api_key="
    + getenv.string('LASTFM_API_KEY')
    + "&format=json";

const musicbrainz_base_url = "https://musicbrainz.org/ws/2/";
const musicbrainz_user_agent = "me.melthecat.dev/0.1.0 (https://me.melthecat.dev)";
const { sleep } = require('./public/js/helpers');

const profile_picture_retry_max = 5;
const profile_picture_retry_base_delay_ms = 1000;
const now_playing_retry_max = 10;
const now_playing_retry_base_delay_ms = 1000;

let currentlyListening = {};
let isPollingNowPlaying = false;
let cachedProfilePicture = null;
let clientSet = new Set();
let nowPlayingPollTimer = null;
let cleanupTimer = null;
let profilePictureRetryCount = 0;
let nowPlayingRetryCount = 0;

function cleanupStaleClients() {
    const now = Date.now();
    let removedCount = 0;

    for (const clientEntry of clientSet) {
        const clientData = clientEntry;
        const inactiveTime = now - clientData.lastActivityTime;

        // Remove client if inactive for too long
        if (inactiveTime > client_timeout_ms) {
            try {
                clientData.res.end();
            } catch (e) {
                // Connection already closed
            }
            clientSet.delete(clientEntry);
            removedCount++;
        }
    }

    if (removedCount > 0) {
        console.log(`Cleaned up ${removedCount} stale clients, remaining: ${clientSet.size}`);
    }
}

function startClientCleanup() {
    if (cleanupTimer) {
        return;
    }
    cleanupTimer = setInterval(cleanupStaleClients, 60000); // Cleanup every minute
    console.log('Client cleanup monitoring started');
}

function stopClientCleanup() {
    if (!cleanupTimer) {
        return;
    }
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    console.log('Client cleanup monitoring stopped');
}

function validateConfig() {
    const required = ['LASTFM_USER', 'LASTFM_API_KEY'];
    const missing = [];
    
    for (const key of required) {
        if (!process.env[key]) {
            missing.push(key);
        }
    }
    
    if (missing.length > 0) {
        console.error(`Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }
    
    console.log('Configuration loaded successfully');
}

async function safeFetch(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), request_timeout_ms);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
        });
    } catch (error) {
        console.error(`Fetch failed for ${url}:`, error.message);
        return undefined;

    } finally {
        clearTimeout(timeoutId);
    }
}

app.use(express.static('public'))

// Cached pfp
app.get('/api/pfp', (req, res) => {
    if (!cachedProfilePicture) {
        res.status(503).type('text/plain').send('Profile picture not cached yet');
        return;
    }

    res.setHeader('Content-Type', cachedProfilePicture.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(cachedProfilePicture.buffer);
});

app.get('/api/currentlyPlaying', async (req, res) => {

    res.setHeader("Content-Type", "application/x-ndjson");

    // Flush headers ASAP
    if (res.flushHeaders) res.flushHeaders();

    const heartbeatMs = 25000;
    let lastSent = null;
    let closed = false;
    let lastWriteTime = Date.now();

    // Check max client limit
    if (clientSet.size >= max_clients) {
        res.status(503).type('text/plain').send('Server at max capacity');
        console.warn(`Client rejected: max clients (${max_clients}) reached`);
        return;
    }

    // Store client metadata
    const clientData = {
        res,
        connectedAt: Date.now(),
        lastActivityTime: Date.now(),
    };

    clientSet.add(clientData);
    console.log('New client connected, total clients:', clientSet.size);
    if (clientSet.size === 1) {
        startNowPlayingPolling();
        startClientCleanup();
        console.log('Started polling');
    }
    getNowPlaying(); // Poll immediately on new connection
    req.on('close', () => { closed = true; });


    while (!closed) {
        const payload = JSON.stringify(currentlyListening ?? {});
        // Only send payload if different to last sent
        if (payload !== lastSent) {
            try {
                res.write(payload + "\n");
                lastSent = payload;
                lastWriteTime = Date.now();
                clientData.lastActivityTime = Date.now();
            } catch (e) {
                break; 
            }
        // Send keep-alive
        } else if (Date.now() - lastWriteTime >= heartbeatMs) {
            try {
                res.write("\n");
                lastWriteTime = Date.now();
                clientData.lastActivityTime = Date.now();
            } catch (e) {
                break;
            }
        }
        await sleep(fetch_interval_ms);
    }
    try {
        res.end();
    } catch (e) {
        /* connection already closed */
    } finally {
        clientSet.delete(clientData);
        console.log('Client disconnected, total clients:', clientSet.size);
        if (clientSet.size === 0) {
            stopNowPlayingPolling();
            stopClientCleanup();
            console.log('Stopped polling');
        }
    }
});

validateConfig();

app.listen(port, () => {
  console.log(`Listening on port ${port}`)
})

async function cacheProfilePicture() {
    try {
        const response = await safeFetch(gravatar_url, {
            redirect: 'follow',
        });

        if (!response?.ok) {
            console.warn(`Failed to fetch profile picture from Gravatar: ${response?.status ?? 'no response'}`);
            profilePictureRetryCount++;

            if (profilePictureRetryCount <= profile_picture_retry_max) {
                const retryDelayMs = profile_picture_retry_base_delay_ms * (2 ** (profilePictureRetryCount - 1));
                console.log(`Retrying profile picture fetch in ${retryDelayMs}ms (attempt ${profilePictureRetryCount}/${profile_picture_retry_max})`);
                await sleep(retryDelayMs);
                await cacheProfilePicture();
                return;
            }

            console.warn('Profile picture fetch retries exhausted');
            return;
        }

        const contentType = response.headers.get('content-type');
        const buffer = Buffer.from(await response.arrayBuffer());
        console.log('Cached profile picture from Gravatar');
        cachedProfilePicture = { buffer, contentType };
        profilePictureRetryCount = 0;
    } catch (e) {
        console.warn(`Failed to cache profile picture from Gravatar: ${e.message}`);
    }
}

function startNowPlayingPolling() {
    if (nowPlayingPollTimer) {
        return;
    }

    nowPlayingPollTimer = setInterval(getNowPlaying, fetch_interval_ms);
}

function stopNowPlayingPolling() {
    if (!nowPlayingPollTimer) {
        return;
    }

    clearInterval(nowPlayingPollTimer);
    nowPlayingPollTimer = null;
}


async function getNowPlaying() {
    if (isPollingNowPlaying) {
        return;
    }

    isPollingNowPlaying = true;
    try {
        // Fetch recent tracks
        const currentlyListeningResponse = await safeFetch(
            `${lastfm_base_url}&method=user.getRecentTracks&user=${lastfm_user}&extended=1&limit=1`
        );
        if (!currentlyListeningResponse?.ok) {
            throw new Error('Failed to fetch currently playing tracks');
        }
        const currentlyListeningData = await currentlyListeningResponse.json();
        const track = currentlyListeningData.recenttracks?.track?.[0];
        
        // Handle new user with no scrobbles
        if (!track) {
            currentlyListening = {};
            return;
        }
        
        // Setup next state and handle API errors
        const nextState = {
            title: track.name ?? null,
            album: track.album?.['#text'] ?? null,
            artist: track.artist?.name ?? null,
            cover: (track.image && track.image.length)
                ? track.image[track.image.length - 1]['#text'] : null,
            cover_source: track.image && track.image.length ? 'lastfm' : null,
        };

        if (nextState.cover === '') {
            nextState.cover = null;
            nextState.cover_source = null;
        }


        // Last.fm API returns empty strings for missing data
        // Handle by setting those fields to null
        for (const [key, value] of Object.entries(nextState)) {
            if (value === "") {
                nextState[key] = null;
            }
        }

        // Last.fm api sends booleans as strings???
        const isNowPlaying = String(track['@attr']?.nowplaying).toLowerCase() === 'true';

        // Send error and return on incomplete data
        if (!nextState.title || !nextState.artist) {
            console.error('Last.fm returned incomplete track data:', { track, nextState });
            currentlyListening = { error: 'Last.fm API returned incomplete track data' };
            return;
        }

        // If not playing, return
        if (!isNowPlaying) {
            // If current listening state is not empty, clear it
            if (Object.keys(currentlyListening).length !== 0) {
                currentlyListening = {};
                console.log('Not playing');
            }
            return;
        }
       
        // If state unchanged, return
        if (currentlyListening?.title === nextState.title
            && currentlyListening?.artist === nextState.artist) {
            return;
        }
        
        if (!nextState.cover) {
            nextState.cover = await getCoverFromMusicBrainz(nextState.title, nextState.artist, nextState.album);
            if (nextState.cover) {
                nextState.cover_source = 'musicbrainz';
            }
        }

        currentlyListening = nextState;
        console.log(`Now playing: ${nextState.title} - ${nextState.artist}, cover source: ${nextState.cover_source ?? 'none'}`);
        nowPlayingRetryCount = 0;
        return;
    } catch (e) {
        console.error('Failed to poll now playing:', e);
        currentlyListening = { error: 'Last.fm API failure' };

        nowPlayingRetryCount++;
        if (nowPlayingRetryCount <= now_playing_retry_max) {
            const retryDelayMs = now_playing_retry_base_delay_ms * (2 ** (nowPlayingRetryCount - 1));
            console.log(`Retrying now playing fetch in ${retryDelayMs}ms (attempt ${nowPlayingRetryCount}/${now_playing_retry_max})`);
            await sleep(retryDelayMs);
        } else {
            console.warn('Now playing fetch retries exhausted');
            nowPlayingRetryCount = 0;
        }
    } finally {
        isPollingNowPlaying = false;
    }
}

async function getCoverFromMusicBrainz(title, artist, album) {
    try {
        const releaseMbids = await getReleaseIdsFromTrackInfo(title, artist, album);

        // Just check if the cover art exists, front should be there in 99% of cases if release exists
        for (const releaseMbid of releaseMbids) {
            const caaResponse = await safeFetch(`https://coverartarchive.org/release/${releaseMbid}`, {
                headers: { 'Accept': 'application/json' },
                redirect: 'follow',
            });
            if (caaResponse?.ok) {
                return `https://coverartarchive.org/release/${releaseMbid}/front-250`;
            }
        }

    } catch (e) {
        console.warn('Failed to fetch cover from MusicBrainz', e);
    }

    return null;
}

async function getReleaseIdsFromTrackInfo(title, artist, album) {
    let releaseMbids = [];
    if (album) {
        try {
            const mbReleaseResponse = await safeFetch(`${musicbrainz_base_url}release/?fmt=json` +
                `&query=artist:${encodeURIComponent(artist)}%20AND%20` +
                `release:${encodeURIComponent(album)}`,
                { headers: { 'User-Agent': musicbrainz_user_agent } }
            );
            if (mbReleaseResponse?.ok) {
                const mbReleaseData = await mbReleaseResponse.json();
                const release = mbReleaseData.releases?.[0];
                if ( release && checkValidArtistFromReleaseOrRecording(release, artist)) {
                    releaseMbids.push(release.id);
                };
            };
        } catch (e) {
            console.warn('Failed to fetch release MBID from MusicBrainz using album info', e);
        };
    };

    if (title && artist) {
        try {
            const mbRecordingResponse = await safeFetch(`${musicbrainz_base_url}recording/?fmt=json` +
                `&query=artist:${encodeURIComponent(artist)}%20AND%20` +
                `title:${encodeURIComponent(title)}`,
                { headers: { 'User-Agent': musicbrainz_user_agent } }
            );
            if (mbRecordingResponse?.ok) {
                const mbRecordingData = await mbRecordingResponse.json();
                const recording = mbRecordingData.recordings?.[0];
                if (recording && checkValidArtistFromReleaseOrRecording(recording, artist)) {
                    releaseMbids.push(recording.releases?.[0]?.id);
                }
            }
        } catch (e) {
            console.warn('Failed to fetch release MBID from MusicBrainz using track info', e);
        };
    };
    return releaseMbids.filter(mbid => mbid !== undefined);
};

function checkValidArtistFromReleaseOrRecording (data, artist) {
    let validArtist = false;
    for (const artistTested of data?.["artist-credit"] ?? []) {
        if (artistTested.name?.toLowerCase() === artist.toLowerCase()
            || artistTested?.artist?.name?.toLowerCase() === artist.toLowerCase()) {
            validArtist = true;
            break;
        };
    };
    return validArtist;
};

cacheProfilePicture();
