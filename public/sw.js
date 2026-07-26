/**
 * Minimal service worker for OpenHands Agent Canvas PWA support.
 * It provides the fetch handler required for installability while
 * remaining a network-first pass-through; offline fallback is not
 * implemented because the app requires a live backend.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
