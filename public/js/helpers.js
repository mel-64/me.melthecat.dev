function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sleep };
}

if (typeof window !== 'undefined') {
    window.sleep = sleep;
}