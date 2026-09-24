// Requires playwright/test on NODE_PATH and offline-server.cjs listening on port 4389.
const { chromium, webkit, expect } = require("playwright/test");
const target = "http://localhost:4389";
(async () => {
  const engine = process.env.OUTLINE_BROWSER === "webkit" ? webkit : chromium;
  const browser = await engine.launch({ headless: false });
  try {
    await fetch(`${target}/test-network?offline=0`);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const response = await context.request.get(`${target}/test-state`);
    const initial = await response.json();
    await context.addInitScript(
      (auth) => {
        if (
          location.origin === "http://localhost:4389" &&
          !localStorage.getItem("AUTH_STORE")
        )
          localStorage.setItem("AUTH_STORE", JSON.stringify(auth));
      },
      { ...initial.auth, policies: initial.auth.policies }
    );
    let page = await context.newPage();
    await page.goto(`${target}/capture`);
    await expect(page.getByLabel("Note", { exact: true })).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise((resolve) =>
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            resolve,
            { once: true }
          )
        );
      await fetch("/capture");
    });
    await expect
      .poll(() =>
        page.evaluate(async () => {
          for (const key of await caches.keys())
            if (
              key.startsWith("outline-shell-") &&
              (await (await caches.open(key)).match("/capture"))
            )
              return true;
          return false;
        })
      )
      .toBe(true);
    await page.goto(`${target}${initial.reference.url}`);
    try {
      await expect(
        page.getByText("Previously loaded note", { exact: true })
      ).toBeVisible();
    } catch (error) {
      if (await page.getByRole("button", { name: "Show detail…" }).count())
        await page.getByRole("button", { name: "Show detail…" }).click();
      console.log(await page.locator("body").innerText());
      throw error;
    }
    await expect
      .poll(() =>
        page.evaluate(async ({ auth, reference }) => {
          const name = `outline.documents.${auth.team.id}.${auth.user.id}`;
          return new Promise((resolve) => {
            const request = indexedDB.open(name, 1);
            request.onsuccess = () => {
              const db = request.result;
              if (!db.objectStoreNames.contains("items")) {
                db.close();
                return resolve(false);
              }
              const read = db
                .transaction("items")
                .objectStore("items")
                .get(reference.id);
              read.onsuccess = () => {
                db.close();
                resolve(!!read.result?.data);
              };
            };
          });
        }, initial)
      )
      .toBe(true);
    if (engine === webkit) await fetch(`${target}/test-network?offline=1`);
    else await context.setOffline(true);
    await page.close();
    page = await context.newPage();
    const started = Date.now();
    await page.goto(`${target}/capture`);
    await expect(page.getByLabel("Note", { exact: true })).toBeVisible();
    console.log(
      "Offline cold page to editable input (ms):",
      Date.now() - started
    );
    await page.goto(`${target}${initial.reference.url}`);
    await expect(
      page.getByText("Previously loaded note", { exact: true })
    ).toBeVisible();
    console.log("PASS: previously visited document reopened offline.");
    await page.goto(`${target}/capture`);
    await page.getByLabel("Title", { exact: true }).fill("Offline family note");
    await page
      .getByLabel("Note", { exact: true })
      .fill("Written without a network. Last keystroke ✓");
    await expect(
      page.getByRole("status").filter({ hasText: /^Saved on this device$/ })
    ).toBeVisible();
    await page.close();
    page = await context.newPage();
    await page.goto(`${target}/capture`);
    await page.getByRole("button", { name: "Continue writing" }).click();
    await expect(page.getByLabel("Note", { exact: true })).toHaveValue(
      "Written without a network. Last keystroke ✓"
    );
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(
      page.getByText("Saved on this device · Waiting to sync")
    ).toBeVisible();
    await page.screenshot({
      path: `${process.env.TMPDIR || "/tmp/"}outline-${process.env.OUTLINE_BROWSER || "chromium"}-offline.png`,
      fullPage: true,
    });
    // A browser restart can drop session cookies while preserving the queued
    // note and persistent login. Reconnection must restore write protection.
    await context.clearCookies({ name: "csrfToken" });
    await context.clearCookies({ name: "__Host-csrfToken" });
    if (engine === webkit) await fetch(`${target}/test-network?offline=0`);
    else await context.setOffline(false);
    await expect(
      page.getByRole("link", { name: "Open saved note" })
    ).toBeVisible({ timeout: 30000 });
    const result = await (
      await context.request.get(`${target}/test-state`)
    ).json();
    expect(result.creates - initial.creates).toBe(1);
    expect(result.documents.at(-1).text).toBe(
      "Written without a network. Last keystroke ✓"
    );
    await page.reload();
    await expect(
      page.getByRole("link", { name: "Open saved note" })
    ).toBeVisible();
    expect(
      (await (await context.request.get(`${target}/test-state`)).json()).creates
    ).toBe(result.creates);
    console.log(
      "PASS: offline launch, durable draft, close/reopen, reconnect, exactly one server note."
    );
    await page.screenshot({
      path: `${process.env.TMPDIR || "/tmp/"}outline-${process.env.OUTLINE_BROWSER || "chromium"}-synced.png`,
      fullPage: true,
    });
    await context.close();
  } finally {
    await fetch(`${target}/test-network?offline=0`);
    await browser.close();
  }
})();
