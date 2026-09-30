/* Atria's service worker: shows the notices pushed to this browser
   (backend: atria.services.notify.push) and opens the visit when tapped. */
self.addEventListener("push", (event) => {
  let notice = { title: "Atria", body: "", url: "/" };
  try {
    notice = { ...notice, ...event.data.json() };
  } catch {
    if (event.data) notice.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(notice.title, {
      body: notice.body,
      icon: "/apple-touch-icon.png",
      badge: "/favicon-32.png",
      data: { url: notice.url },
      tag: notice.url,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((open) => {
      const tab = open.find((c) => c.url.startsWith(self.location.origin));
      if (tab) return tab.focus().then(() => tab.navigate(url));
      return self.clients.openWindow(url);
    }),
  );
});
