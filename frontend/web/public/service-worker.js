/**
 * Self-destructing service worker.
 * 
 * The previous service worker has been removed from this project.
 * This file exists solely to replace any cached SW in users' browsers,
 * clear all stale caches, and then unregister itself.
 */

// On install, skip waiting to activate immediately
self.addEventListener('install', () => {
    self.skipWaiting();
});

// On activate, clear ALL caches and unregister
self.addEventListener('activate', async (event) => {
    event.waitUntil(
        (async () => {
            // Delete all caches
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames.map(name => caches.delete(name))
            );

            // Unregister this service worker
            const registration = await self.registration;
            await registration.unregister();

            // Tell all clients to reload so they get fresh content
            const clients = await self.clients.matchAll({ type: 'window' });
            clients.forEach(client => {
                client.navigate(client.url);
            });
        })()
    );
});

// Don't intercept any fetches — pass everything through to network
self.addEventListener('fetch', () => {
    // No-op: let the browser handle all requests normally
});
