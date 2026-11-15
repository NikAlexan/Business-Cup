// Loaded into the generated service worker via workbox.importScripts (vite.config.ts).
self.addEventListener('push', (event) => {
  const msg = event.data ? event.data.json() : { title: 'Resonance', body: 'Time for a short session.', url: '/' }
  event.waitUntil(
    self.registration.showNotification(msg.title, { body: msg.body, icon: '/icons/icon-192.png', data: { url: msg.url || '/' } }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.location.origin))
      return open ? open.focus() : self.clients.openWindow(url)
    }),
  )
})
