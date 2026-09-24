import type { RuntimeCaching } from "workbox-build";

/**
 * Caches only the private app shell, preserving its matching CSP headers.
 * Public shares, authentication callbacks and API responses never enter it.
 *
 * @param buildId identifies the assets that this HTML shell was built with.
 * @returns the Workbox runtime navigation rule.
 */
export function offlineNavigation(buildId: string): RuntimeCaching {
  return {
    urlPattern: ({ url, request }) =>
      url.origin === self.location.origin &&
      (request.mode === "navigate" || url.pathname === "/capture") &&
      /^(\/$|\/capture$|\/home(?:\/|$)|\/doc\/|\/collection\/|\/drafts$)/.test(
        url.pathname
      ),
    handler: "StaleWhileRevalidate",
    options: {
      cacheName: `outline-shell-${buildId}`,
      expiration: { maxEntries: 1 },
      plugins: [
        {
          cacheKeyWillBeUsed: async ({ request }) =>
            new URL("/capture", request.url).href,
          cacheWillUpdate: async ({ response }) =>
            response.status === 200 &&
            response.headers.get("X-Outline-App-Shell") === "1" &&
            response.headers.get("Content-Type")?.includes("text/html")
              ? response
              : null,
        },
      ],
    },
  };
}
