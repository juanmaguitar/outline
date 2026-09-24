// Local fixture server for the built app. Run from the repository with node.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const port = 4389;
const url = `http://localhost:${port}`;
const team = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Offline test",
  url,
  preferences: {},
  commenting: false,
  sharing: false,
};
const user = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Test user",
  email: "test@example.invalid",
  role: "admin",
  language: "en_US",
  preferences: {},
  notificationSettings: {},
  timezone: "Europe/Madrid",
};
const policies = [
  {
    id: team.id,
    abilities: { createDocument: true, createCollection: true, read: true },
  },
];
const auth = { team, user, groups: [], groupUsers: [], policies };
const documents = new Map();
const reference = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  title: "Offline reference",
  url: "/doc/offline-reference-cachedabcd",
  urlId: "cachedabcd",
  createdBy: user,
  updatedBy: user,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  publishedAt: "2026-09-01T00:00:00.000Z",
  revision: 1,
  tasks: { total: 0, completed: 0 },
  collaboratorIds: [],
  data: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Previously loaded note" }],
      },
    ],
  },
};
documents.set(reference.id, reference);
let creates = 0;
let disconnected = false;
const mime = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
http
  .createServer(async (req, res) => {
    const pathname = new URL(req.url, url).pathname;
    const json = (data, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (pathname === "/test-network") {
      disconnected = new URL(req.url, url).searchParams.get("offline") === "1";
      return json({ disconnected });
    }
    if (disconnected) {
      req.socket.destroy();
      return;
    }
    if (pathname === "/test-state")
      return json({
        auth,
        creates,
        reference,
        documents: [...documents.values()],
      });
    if (pathname.startsWith("/api/")) {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      if (pathname === "/api/auth.info") return json({ data: auth, policies });
      if (pathname === "/api/relationships.list")
        return json({ data: { documents: [], relationships: [] } });
      if (pathname === "/api/shares.info")
        return json({ data: { shares: [] } });
      if (pathname === "/api/notifications.list")
        return json({ data: { notifications: [] } });
      if (pathname === "/api/documents.create") {
        if (documents.has(body.id))
          return json(
            { error: "validation_error", message: "Duplicate id" },
            400
          );
        creates++;
        const doc = {
          ...body,
          url: `/doc/test-abcdefghij`,
          urlId: "abcdefghij",
          createdBy: user,
          updatedBy: user,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          data: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: body.text }],
              },
            ],
          },
        };
        documents.set(doc.id, doc);
        return json({
          data: doc,
          policies: [{ id: doc.id, abilities: { read: true, update: true } }],
        });
      }
      if (pathname === "/api/documents.info") {
        const doc =
          documents.get(body.id) ||
          [...documents.values()].find((d) => body.id?.endsWith(d.urlId));
        return doc
          ? json({
              data: { document: doc },
              policies: [
                { id: doc.id, abilities: { read: true, update: false } },
              ],
            })
          : json({ error: "not_found", message: "Not found" }, 404);
      }
      return json({
        data: [],
        pagination: { total: 0, limit: 100, offset: 0, nextPath: null },
        policies: [],
      });
    }
    if (pathname.startsWith("/static/")) {
      const filename = path.join(root, "build/app", pathname.slice(8));
      if (fs.existsSync(filename) && fs.statSync(filename).isFile()) {
        res.writeHead(200, {
          "Content-Type":
            mime[path.extname(filename)] || "application/octet-stream",
          "Service-Worker-Allowed": "/",
        });
        return fs.createReadStream(filename).pipe(res);
      }
      res.writeHead(404);
      return res.end();
    }
    if (pathname.startsWith("/locales/")) return json({});
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "build/app/.vite/manifest.json"))
    );
    const entry = manifest["app/index.tsx"];
    const env = {
      URL: url,
      ENVIRONMENT: "production",
      DEFAULT_LANGUAGE: "en_US",
      APP_NAME: "Outline test",
      COLLABORATION_URL: url,
      FILE_STORAGE_UPLOAD_MAX_SIZE: 10000000,
      DEPLOYMENT: "test",
      analytics: [],
    };
    const html = fs
      .readFileSync(path.join(root, "build/app/index.html"), "utf8")
      .replace("{env}", `<script>window.env=${JSON.stringify(env)}</script>`)
      .replace(
        "{script-tags}",
        `<script type="module" src="/static/${entry.file}"></script>`
      )
      .replaceAll("{head-tags}", "")
      .replaceAll("{content}", "")
      .replaceAll("{title}", "Offline test")
      .replaceAll("{lang}", "en")
      .replaceAll("{csp-nonce}", "test");
    res.writeHead(200, {
      "Content-Type": "text/html",
      "X-Outline-App-Shell": "1",
    });
    res.end(html);
  })
  .listen(port, "127.0.0.1", () => console.log(url));
