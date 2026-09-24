import { offlineNavigation } from "./offlineNavigation";

it("uses a build-specific shell cache", () => {
  expect(offlineNavigation("one").options?.cacheName).not.toBe(
    offlineNavigation("two").options?.cacheName
  );
});

it("only caches marked HTML, never login redirects, shares or errors", async () => {
  const plugin = offlineNavigation("test").options?.plugins?.[0];
  const update = plugin?.cacheWillUpdate;
  expect(update).toBeDefined();
  if (!update) {
    return;
  }
  const event = {} as Parameters<typeof update>[0]["event"];
  const request = new Request("https://outline.test/capture");
  for (const response of [
    new Response("login"),
    new Response("share", { headers: { "Content-Type": "text/html" } }),
    new Response("failure", {
      status: 500,
      headers: { "X-Outline-App-Shell": "1" },
    }),
  ]) {
    expect(await update({ request, response, event })).toBeNull();
  }
  const response = new Response("app", {
    headers: {
      "Content-Type": "text/html",
      "X-Outline-App-Shell": "1",
      "Content-Security-Policy": "script-src 'nonce-example'",
    },
  });
  expect(await update({ request, response, event })).toBe(response);
});
