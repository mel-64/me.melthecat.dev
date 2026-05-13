const api_base_url = "/api";
const reconnectDelayMs = 5000;

let playing = null;
let currentlyListening = null;

function renderNowPlaying(statusEl, thumbnailEl, title, artist, cover) {
    statusEl.replaceChildren();

    statusEl.append("I'm currently listening to: ");
    statusEl.appendChild(document.createElement('br'));

    const strong = document.createElement('strong');
    strong.textContent = `${title} - ${artist}`;
    statusEl.appendChild(strong);

    thumbnailEl.replaceChildren();
    if (!cover) return;

    const image = document.createElement('img');
    image.id = 'lastfmthumbnailimg';
    image.src = cover;
    thumbnailEl.appendChild(image);
}

function renderNotPlaying(statusEl, thumbnailEl) {
    statusEl.replaceChildren();
    statusEl.append("I'm currently listening to: ");
    statusEl.appendChild(document.createElement('br'));
    statusEl.append('nothing :(');
    thumbnailEl.replaceChildren();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkNowPlaying(statusEl, thumbnailEl) {
    // Keep trying to connect to the NDJSON stream; reconnect after errors/close
    while (true) {
        let reader = null;
        try {
            const response = await fetch(`${api_base_url}/currentlyPlaying`);
            if (!response.ok) throw new Error('Network response not ok');
            if (!response.body) throw new Error('No response body');

            reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            // Read stream continuously and reconnect on error
            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    console.log('Stream closed');
                    break;
                }

                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Get last line

                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    // Handle empty lines
                    if (!line) continue;

                    let dataCurrentlyPlaying;
                    try {
                        dataCurrentlyPlaying = JSON.parse(line);
                    } catch (e) {
                        console.warn('Failed to parse line from stream', line, e);
                        continue;
                    }

                    console.log('Received new data from server:')
                    console.log(dataCurrentlyPlaying);
                    // If the server sends an error, show it
                    if (dataCurrentlyPlaying?.error) {
                        statusEl.replaceChildren();
                        statusEl.append('Last.fm API failure');
                        thumbnailEl.replaceChildren();
                        playing = false;
                        currentlyListening = null;
                        continue;
                    }

                    const title = dataCurrentlyPlaying?.title;
                    const artist = dataCurrentlyPlaying?.artist;
                    const cover = dataCurrentlyPlaying?.cover;

                    if (title && artist) {
                        const songKey = title + artist;
                        playing = true;
                        // Skip if same song
                        if (currentlyListening === songKey) { continue; }
                        renderNowPlaying(statusEl, thumbnailEl, title, artist, cover);
                        currentlyListening = songKey;
                    } else {
                        if (playing === false) { continue; }
                        playing = false;
                        await sleep(5000); // 5 second debounce
                        if (playing) { continue; }
                        renderNotPlaying(statusEl, thumbnailEl);
                        currentlyListening = null;
                    }
                }
            }
        } catch (err) {
            console.warn('Stream error, will reconnect in 5s', err);
        } finally {
            if (reader) {
                try {
                    reader.releaseLock();
                } catch (e) {
                    // If any errors accurred, ignore as we're reconnecting anyway
                    // This can throw if the reader is already released or errored
                    // We're reconnecting anyway, ignore the errors
                }
            }
        }

        await sleep(reconnectDelayMs);
        console.log('Reconnecting to stream...');
    }
}


function startNowPlaying() {
    const start = () => {
        const statusEl = document.getElementById('lastfmsong');
        const thumbnailEl = document.getElementById('lastfmthumbnail');

        if (!statusEl || !thumbnailEl) {
            console.warn('Last.fm UI elements not found');
            return;
        }

        checkNowPlaying(statusEl, thumbnailEl);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
        return;
    }

    start();
}

startNowPlaying();