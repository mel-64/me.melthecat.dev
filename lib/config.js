const getenv = require('getenv');

const defaultGravatarUrl = 'https://gravatar.com/avatar/1b5e72e77dfd844154dcb15de04a3a63e02cca25cad1e72313cdd55716f46701?s=753';

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

function getConfig() {
    return {
        port: 3000,
        max_clients: getenv.int('MAX_CLIENTS', 100),
        client_timeout_ms: getenv.int('CLIENT_TIMEOUT_MS', 300000),
        lastfm_user: getenv.string('LASTFM_USER'),
        fetch_interval_ms: getenv.int('FETCH_INTERVAL_MS', 3000),
        request_timeout_ms: getenv.int('REQUEST_TIMEOUT_MS', 5000),
        gravatar_url: getenv.string('GRAVATAR_URL', defaultGravatarUrl),
        lastfm_base_url: `https://ws.audioscrobbler.com/2.0/?api_key=${getenv.string('LASTFM_API_KEY')}&format=json`,
        musicbrainz_base_url: 'https://musicbrainz.org/ws/2/',
        musicbrainz_user_agent: 'me.melthecat.dev/0.1.0 (https://me.melthecat.dev)',
        profile_picture_retry_max: 5,
        profile_picture_retry_base_delay_ms: 1000,
        now_playing_retry_max: 10,
        now_playing_retry_base_delay_ms: 1000,
    };
}

module.exports = {
    getConfig,
    validateConfig,
};