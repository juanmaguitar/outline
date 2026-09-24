import { CSRF } from "@shared/constants";
import { getCSRFToken, refreshCSRFToken } from "./csrf";

afterEach(() => {
  document.cookie = `${CSRF.cookieName}=; Max-Age=0; path=/`;
  vi.unstubAllGlobals();
});

it("restores the write-protection cookie after an offline browser restart", async () => {
  expect(getCSRFToken()).toBe("");
  const request = vi.fn(async () => {
    document.cookie = `${CSRF.cookieName}=fresh-token; path=/`;
    return { ok: true };
  });
  vi.stubGlobal("fetch", request);

  await refreshCSRFToken();

  expect(getCSRFToken()).toBe("fresh-token");
  expect(request).toHaveBeenCalledWith("/capture", {
    method: "HEAD",
    credentials: "same-origin",
    cache: "no-store",
    signal: expect.any(AbortSignal),
  });
});

it("does not allow delivery when the server is unreachable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
  );
  await expect(refreshCSRFToken()).rejects.toThrow();
});

it("does not allow delivery when cookies cannot be restored", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  await expect(refreshCSRFToken()).rejects.toThrow("session");
});

it("rejects a failed server response even when a cookie remains", async () => {
  document.cookie = `${CSRF.cookieName}=old-token; path=/`;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  await expect(refreshCSRFToken()).rejects.toThrow();
});
