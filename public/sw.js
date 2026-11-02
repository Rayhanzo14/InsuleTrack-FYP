/**
 * InsuleTrack Service Worker
 * Minimal SW to allow ServiceWorkerRegistration.showNotification()
 * which is required for reliable notification delivery in Chrome.
 */

// Install & activate immediately — no caching strategy needed here
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Handle notification click — focus or open the app
self.addEventListener('notificationclick', (e) => {
    e.notification.close();
    e.waitUntil(
        self.clients
            .matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // If the app is already open, focus it
                for (const client of clientList) {
                    if ('focus' in client) return client.focus();
                }
                // Otherwise open a new window
                if (self.clients.openWindow) {
                    return self.clients.openWindow('/dashboard');
                }
            })
    );
});
