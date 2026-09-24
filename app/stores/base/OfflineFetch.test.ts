import "fake-indexeddb/auto";
import "~/stores";
import RootStore from "~/stores/RootStore";
import { client } from "~/utils/ApiClient";
import { AuthorizationError, NetworkError, OfflineError } from "~/utils/errors";
import StorePersistence from "./StorePersistence";

let sequence = 0;
const record = { id: "doc-1", title: "Cached", urlId: "abcdefghij" };

beforeEach(() => {
  vi.mocked(client.post).mockResolvedValue({
    data: { user: {}, team: {}, groups: [], groupUsers: [] },
  });
});

async function cachedStore() {
  const scope = `offline-fetch-${++sequence}`;
  const source = new RootStore();
  source.documents.add(record);
  const persistence = new StorePersistence(source.documents, scope);
  persistence.persist(record.id);
  await persistence.flush();
  const target = new RootStore();
  target.documents.persistable = true;
  return { target, scope };
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("fails immediately for an uncached document while offline", async () => {
  const { target } = await cachedStore();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const request = vi.spyOn(client, "post");
  request.mockClear();
  await expect(target.documents.fetch("missing")).rejects.toBeInstanceOf(
    OfflineError
  );
  expect(request).not.toHaveBeenCalled();
});

it("waits for hydration before fetching a cached document offline", async () => {
  const { target, scope } = await cachedStore();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  const request = vi.spyOn(client, "post");
  request.mockClear();
  const ready = target.documents.enablePersistence(scope);
  expect((await target.documents.fetch(record.id)).title).toBe("Cached");
  expect(request).not.toHaveBeenCalled();
  await ready;
});

it("revalidates a restored document when online", async () => {
  const { target, scope } = await cachedStore();
  await target.documents.enablePersistence(scope);
  vi.spyOn(client, "post").mockResolvedValue({
    data: { document: { ...record, title: "Updated" } },
  });
  expect((await target.documents.fetch(record.id)).title).toBe("Updated");
});

it("keeps the cached document when the server cannot be reached", async () => {
  const { target, scope } = await cachedStore();
  await target.documents.enablePersistence(scope);
  vi.spyOn(client, "post").mockRejectedValue(new NetworkError("unreachable"));
  expect((await target.documents.fetch(record.id, { force: true })).title).toBe(
    "Cached"
  );
});

it("does not fall back to cached content after access is revoked", async () => {
  const { target, scope } = await cachedStore();
  await target.documents.enablePersistence(scope);
  vi.spyOn(client, "post").mockRejectedValue(new AuthorizationError());
  await expect(
    target.documents.fetch(record.id, { force: true })
  ).rejects.toThrow();
  expect(target.documents.get(record.id)).toBeUndefined();
});
