function createMusicBrainzService({ safeFetch, config }) {
    async function fetchMusicBrainzTopResult(entityType, query, resultKey, errorContext) {
        try {
            const response = await safeFetch(`${config.musicbrainz_base_url}${entityType}/?fmt=json&query=${query}`, {
                headers: { 'User-Agent': config.musicbrainz_user_agent },
            });

            if (!response?.ok) {
                return null;
            }

            const data = await response.json();
            return data?.[resultKey]?.[0] ?? null;
        } catch (error) {
            console.warn(`Failed to fetch ${errorContext} MBID from MusicBrainz`, error);
            return null;
        }
    }

    function checkValidArtistFromReleaseOrRecording(data, artist) {
        for (const artistTested of data?.['artist-credit'] ?? []) {
            if (artistTested.name?.toLowerCase() === artist.toLowerCase()
                || artistTested?.artist?.name?.toLowerCase() === artist.toLowerCase()) {
                return true;
            }
        }

        return false;
    }

    async function getReleaseIdsFromTrackInfo(title, artist, album) {
        const releaseMbids = [];

        if (album) {
            const release = await fetchMusicBrainzTopResult(
                'release',
                `artist:${encodeURIComponent(artist)}%20AND%20release:${encodeURIComponent(album)}`,
                'releases',
                'release MBID using album info'
            );

            if (release && checkValidArtistFromReleaseOrRecording(release, artist)) {
                releaseMbids.push(release.id);
            }
        }

        if (title && artist) {
            const recording = await fetchMusicBrainzTopResult(
                'recording',
                `artist:${encodeURIComponent(artist)}%20AND%20title:${encodeURIComponent(title)}`,
                'recordings',
                'release MBID using track info'
            );

            if (recording && checkValidArtistFromReleaseOrRecording(recording, artist)) {
                releaseMbids.push(recording.releases?.[0]?.id);
            }
        }

        return releaseMbids.filter(mbid => mbid !== undefined);
    }

    async function getCoverFromMusicBrainz(title, artist, album) {
        try {
            const releaseMbids = await getReleaseIdsFromTrackInfo(title, artist, album);

            for (const releaseMbid of releaseMbids) {
                const caaResponse = await safeFetch(`https://coverartarchive.org/release/${releaseMbid}`, {
                    headers: { 'Accept': 'application/json' },
                    redirect: 'follow',
                });

                if (caaResponse?.ok) {
                    return `https://coverartarchive.org/release/${releaseMbid}/front-250`;
                }
            }
        } catch (error) {
            console.warn('Failed to fetch cover from MusicBrainz', error);
        }

        return null;
    }

    return {
        getCoverFromMusicBrainz,
    };
}

module.exports = {
    createMusicBrainzService,
};