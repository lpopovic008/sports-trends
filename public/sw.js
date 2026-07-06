// Minimal service worker: no offline caching, exists purely so browsers
// (Chrome/Android) treat the site as an installable PWA that opens without
// browser chrome once added to the home screen / installed.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
