function createSafeFetch(requestTimeoutMs) {
    return async function safeFetch(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

        try {
            return await fetch(url, {
                ...options,
                signal: controller.signal,
            });
        } catch (error) {
            const cleanedUrl = url.replace(/([?&])api_key=[^&]+(&|$)/, '$1api_key=XXXXXX$2');
            console.error(`Fetch failed for ${cleanedUrl}:`, error.message);
            return undefined;
        } finally {
            clearTimeout(timeoutId);
        }
    };
}

module.exports = {
    createSafeFetch,
};