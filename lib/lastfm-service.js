function createLastfmService({ state, config, safeFetch, sleep, getCoverFromMusicBrainz }) {
    async function cacheProfilePicture() {
        try {
            const response = await safeFetch(config.gravatar_url, {
                redirect: 'follow',
            });

            if (!response?.ok) {
                console.warn(`Failed to fetch profile picture from Gravatar: ${response?.status ?? 'no response'}`);
                state.profilePictureRetryCount++;

                if (state.profilePictureRetryCount <= config.profile_picture_retry_max) {
                    const retryDelayMs = config.profile_picture_retry_base_delay_ms * (2 ** (state.profilePictureRetryCount - 1));
                    console.log(`Retrying profile picture fetch in ${retryDelayMs}ms (attempt ${state.profilePictureRetryCount}/${config.profile_picture_retry_max})`);
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
            state.cachedProfilePicture = { buffer, contentType };
            state.profilePictureRetryCount = 0;
        } catch (error) {
            console.warn(`Failed to cache profile picture from Gravatar: ${error.message}`);
        }
    }

    function startNowPlayingPolling() {
        if (state.nowPlayingPollTimer) {
            return;
        }

        state.nowPlayingPollTimer = setInterval(() => {
            void getNowPlaying();
        }, config.fetch_interval_ms);
    }

    function stopNowPlayingPolling() {
        if (!state.nowPlayingPollTimer) {
            return;
        }

        clearInterval(state.nowPlayingPollTimer);
        state.nowPlayingPollTimer = null;
    }

    async function getNowPlaying() {
        if (state.isPollingNowPlaying) {
            return;
        }

        state.isPollingNowPlaying = true;
        try {
            const currentlyListeningResponse = await safeFetch(
                `${config.lastfm_base_url}&method=user.getRecentTracks&user=${config.lastfm_user}&extended=1&limit=1`
            );

            if (!currentlyListeningResponse?.ok) {
                throw new Error('Failed to fetch currently playing tracks');
            }

            const currentlyListeningData = await currentlyListeningResponse.json();
            const track = currentlyListeningData.recenttracks?.track?.[0];

            if (!track) {
                state.currentlyListening = {};
                return;
            }

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

            for (const [key, value] of Object.entries(nextState)) {
                if (value === '') {
                    nextState[key] = null;
                }
            }

            const isNowPlaying = String(track['@attr']?.nowplaying).toLowerCase() === 'true';

            if (!nextState.title || !nextState.artist) {
                console.error('Last.fm returned incomplete track data:', { track, nextState });
                state.currentlyListening = { error: 'Last.fm API returned incomplete track data' };
                return;
            }

            if (!isNowPlaying) {
                if (Object.keys(state.currentlyListening).length !== 0) {
                    state.currentlyListening = {};
                    console.log('Not playing');
                }

                return;
            }

            if (state.currentlyListening?.title === nextState.title
                && state.currentlyListening?.artist === nextState.artist) {
                return;
            }

            if (!nextState.cover) {
                nextState.cover = await getCoverFromMusicBrainz(nextState.title, nextState.artist, nextState.album);
                if (nextState.cover) {
                    nextState.cover_source = 'musicbrainz';
                }
            }

            state.currentlyListening = nextState;
            console.log(`Now playing: ${nextState.title} - ${nextState.artist}, cover source: ${nextState.cover_source ?? 'none'}`);
            state.nowPlayingRetryCount = 0;
        } catch (error) {
            console.error('Failed to poll now playing:', error);
            state.currentlyListening = { error: 'Last.fm API failure' };

            state.nowPlayingRetryCount++;
            if (state.nowPlayingRetryCount <= config.now_playing_retry_max) {
                const retryDelayMs = config.now_playing_retry_base_delay_ms * (2 ** (state.nowPlayingRetryCount - 1));
                console.log(`Retrying now playing fetch in ${retryDelayMs}ms (attempt ${state.nowPlayingRetryCount}/${config.now_playing_retry_max})`);
                await sleep(retryDelayMs);
            } else {
                console.warn('Now playing fetch retries exhausted');
                state.nowPlayingRetryCount = 0;
            }
        } finally {
            state.isPollingNowPlaying = false;
        }
    }

    return {
        cacheProfilePicture,
        startNowPlayingPolling,
        stopNowPlayingPolling,
        getNowPlaying,
    };
}

module.exports = {
    createLastfmService,
};