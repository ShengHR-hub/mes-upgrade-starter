/*
 * B13 PWA Service Worker（只缓存应用外壳）。
 *
 * 硬性边界（任务书 §B13 要求 10）：
 * - **不缓存任何 /api/ 响应**：业务数据、令牌、错误包体一律不进 Cache API；
 * - **不缓存敏感业务数据**：只预缓存静态外壳（HTML 入口、manifest、图标、favicon）；
 * - 不对 POST/PUT/PATCH/DELETE 做任何拦截（追加写入不重发、不排队）；
 * - 同源静态资源才允许运行时缓存；跨域请求直接放行；
 * - 导航请求 network-first，离线时回退到缓存外壳（明确由页面提示离线状态，
 *   不在后台补发任何写入）。
 */
const CACHE_NAME = 'mes-shell-v1';
const SHELL_URLS = [
  '/',
  '/mobile',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 逐个加入：单个资源失败不阻塞整个安装
      await Promise.all(
        SHELL_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch {
            /* 忽略单个外壳资源失败 */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request.url.startsWith(self.location.origin)) return; // 跨域放行
  if (request.method !== 'GET') return; // 写请求一律直连，绝不拦截/重发

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return; // 业务 API 不缓存（数据与令牌边界）

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(CACHE_NAME);
          return (
            (await cache.match('/')) ||
            (await cache.match('/mobile')) ||
            new Response('离线且无可用外壳缓存', { status: 504, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
          );
        }
      })(),
    );
    return;
  }

  // 同源静态资源：cache-first，运行时补充缓存
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
