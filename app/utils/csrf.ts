import { getCookie } from "tiny-cookie";
import { CSRF } from "@shared/constants";
import { AuthorizationError, NetworkError } from "./errors";

/**
 * Reads the CSRF token that the server attached to the current document,
 * preferring the host-bound cookie when present.
 *
 * @returns The token, or an empty string when no CSRF cookie is present.
 */
export function getCSRFToken(): string {
  return getCookie(CSRF.secureCookieName) ?? getCookie(CSRF.cookieName) ?? "";
}

/** Restores the session CSRF cookie without loading a cached offline page. */
export async function refreshCSRFToken(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    // HEAD bypasses the service worker's GET navigation cache. Health checks
    // bypass the server's CSRF middleware and cannot restore this cookie.
    const response = await fetch("/capture", {
      method: "HEAD",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new NetworkError("Unable to reach Outline.");
    }
    if (!getCSRFToken()) {
      throw new AuthorizationError("Unable to restore the session cookie.");
    }
  } finally {
    clearTimeout(timeout);
  }
}
