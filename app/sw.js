// Pocket Room service worker: the PWA share target. Android's share sheet POSTs a picture to /share
// (manifest.webmanifest share_target); it waits in a cache and the app opens on "Add piece" with it.
// No offline cache of the app itself: the API needs the network anyway.
const SHARE = "pocket-room-share";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "POST" || url.pathname !== "/share") return;
  e.respondWith((async () => {
    const form = await e.request.formData();
    const file = form.getAll("image").find((f) => f && typeof f !== "string");
    if (file) {
      const cache = await caches.open(SHARE);
      await cache.put("/shared/latest", new Response(file, { headers: { "content-type": file.type || "image/jpeg" } }));
      return Response.redirect("/?shared=1&tab=add", 303);
    }
    // a link without a picture (Instagram sometimes shares only the post URL): open Add piece
    return Response.redirect("/?tab=add", 303);
  })());
});
