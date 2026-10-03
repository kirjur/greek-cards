// Offline cache: app shell is stale-while-revalidate, data/*.json and config.js are network-first.
const VERSION = 'gk-v2';
const SHELL = [
	'./',
	'./index.html',
	'./style.css',
	'./app.js',
	'./config.js',
	'./vendor/fsrs.umd.js',
	'./vendor/marked.umd.js',
	'./manifest.webmanifest',
	'./icons/icon-192.png',
	'./icons/icon-512.png',
	'./icons/apple-touch-icon.png',
	'./data/words.json',
	'./data/notes.json',
];

self.addEventListener('install', (e) => {
	e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
	e.waitUntil(
		caches.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener('fetch', (e) => {
	const req = e.request;
	const url = new URL(req.url);
	if (req.method !== 'GET' || url.origin !== location.origin) return;

	if (url.pathname.includes('/data/') || url.pathname.endsWith('/config.js')) {
		e.respondWith(
			fetch(req)
				.then((res) => {
					if (res.ok) {
						const copy = res.clone();
						caches.open(VERSION).then((c) => c.put(url.pathname, copy));
					}
					return res;
				})
				.catch(() => caches.match(url.pathname)),
		);
		return;
	}

	e.respondWith(
		caches.match(req, { ignoreSearch: true }).then((cached) => {
			const fresh = fetch(req)
				.then((res) => {
					if (res.ok) {
						const copy = res.clone();
						caches.open(VERSION).then((c) => c.put(req, copy));
					}
					return res;
				})
				.catch(() => cached);
			return cached || fresh;
		}),
	);
});
