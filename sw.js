// Service worker minimal — tujuannya HANYA agar browser menganggap situs ini
// "installable" (syarat PWA di Chrome perlu ada fetch handler). Tidak melakukan
// caching apa pun, jadi tidak ada risiko menyajikan versi lama yang basi.
// Data selalu diambil langsung dari jaringan/API seperti biasa.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
