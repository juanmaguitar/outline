import "fake-indexeddb/auto";
import {
  OfflineDraftConflictError,
  OfflineDraftsStore,
} from "./OfflineDraftsStore";

describe("offline capture", () => {
  const draft = { id: "note-1", title: "Shopping", text: "Milk and bread" };
  let scope = 0;
  const createStore = () => new OfflineDraftsStore(`team.user.${++scope}`);

  const remote = {
    find: async () => ({ ...draft, url: "/doc/saved-abcdefghij", revision: 1 }),
    create: vi.fn(),
    update: vi.fn(),
  };

  it("removes one synced copy durably, leaving other synced copies intact", async () => {
    const store = createStore();
    for (const id of ["one", "two"]) {
      await store.save({ ...draft, id });
      await store.queue(id);
    }
    await store.sync(remote);
    await store.removeSynced("one");
    const reopened = new OfflineDraftsStore(store.scope);
    await reopened.load();
    expect(reopened.drafts.map((note) => note.id)).toEqual(["two"]);
  });

  it("bulk removal preserves unfinished and queued notes, including pending writes", async () => {
    const store = createStore();
    await store.save(draft);
    await store.queue(draft.id);
    await store.sync(remote);
    const writing = store.save({ ...draft, id: "unfinished" });
    const saving = store.save({ ...draft, id: "pending" });
    const queueing = store.queue("pending");
    await store.removeSynced();
    await Promise.all([writing, saving, queueing]);
    const reopened = new OfflineDraftsStore(store.scope);
    await reopened.load();
    expect(reopened.drafts.slice()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "unfinished", status: "draft" }),
        expect.objectContaining({ id: "pending", status: "queued" }),
      ])
    );
    expect(reopened.drafts).toHaveLength(2);
  });

  it("checks persisted status before individual removal and isolates accounts", async () => {
    const store = createStore();
    await store.save(draft);
    await store.removeSynced(draft.id);
    expect(store.drafts).toHaveLength(1);
    await store.queue(draft.id);
    await store.removeSynced(draft.id);
    expect(store.drafts[0].status).toBe("queued");
    await store.sync(remote);
    await createStore().removeSynced();
    await store.load();
    expect(store.drafts).toHaveLength(1);
    const stale = new OfflineDraftsStore(store.scope);
    await stale.removeSynced();
    await store.load();
    expect(store.drafts).toEqual([]);
  });

  it("does not remove a queued note while its server request is in flight", async () => {
    const store = createStore();
    await store.save(draft);
    await store.queue(draft.id);
    await store.sync({
      find: async () => {
        await store.removeSynced();
        expect(store.drafts[0].status).toBe("queued");
        return { ...draft, url: "/doc/saved-abcdefghij", revision: 1 };
      },
      create: vi.fn(),
      update: vi.fn(),
    });
    expect(store.drafts[0].status).toBe("synced");
  });

  it("restores an unfinished note after closing and reopening", async () => {
    const store = createStore();
    await store.save(draft);
    const reopened = new OfflineDraftsStore(store.scope);
    await reopened.load();
    expect(reopened.drafts[0]).toMatchObject({ ...draft, status: "draft" });
  });

  it("isolates users in the same workspace", async () => {
    const first = createStore();
    await first.save(draft);
    const second = createStore();
    await second.load();
    expect(second.drafts).toEqual([]);
  });

  it("preserves the last keystroke when queueing during pending writes", async () => {
    const store = createStore();
    const first = store.save({ ...draft, text: "M" });
    const second = store.save(draft);
    const queued = store.queue(draft.id);
    await Promise.all([first, second, queued]);
    expect(store.drafts[0]).toMatchObject({ ...draft, status: "queued" });
    await store.save({ ...draft, text: "overwrite" });
    expect(store.drafts[0]).toMatchObject({
      text: "overwrite",
      status: "queued",
    });
  });

  it("keeps a synced note editable locally and queues later changes", async () => {
    const store = createStore();
    await store.save(draft);
    await store.queue(draft.id);
    await store.sync({
      find: async () => undefined,
      create: async () => ({ url: "/doc/shopping-abcdefghij", revision: 1 }),
      update: vi.fn(),
    });
    await store.save({ ...draft, text: "Milk, bread and eggs" });
    const reopened = new OfflineDraftsStore(store.scope);
    await reopened.load();
    expect(reopened.drafts[0]).toMatchObject({
      text: "Milk, bread and eggs",
      status: "queued",
      url: "/doc/shopping-abcdefghij",
    });
  });

  it("preserves edits made while the initial create is in flight", async () => {
    const store = createStore();
    await store.save(draft);
    await store.queue(draft.id);
    let online: (typeof draft & { url: string; revision: number }) | undefined;
    const remote = {
      find: vi.fn(async () => online),
      create: vi.fn(async (note: typeof draft) => {
        await store.save({ ...draft, text: "Edited during upload" });
        online = { ...note, url: "/doc/shopping-abcdefghij", revision: 1 };
        return online;
      }),
      update: vi.fn(async (note: typeof draft) => {
        online = { ...note, url: "/doc/shopping-abcdefghij", revision: 2 };
        return online;
      }),
    };
    await store.sync(remote);
    expect(store.drafts[0]).toMatchObject({
      text: "Edited during upload",
      status: "queued",
      remoteRevision: 1,
    });
    await store.sync(remote);
    expect(store.drafts[0]).toMatchObject({
      text: "Edited during upload",
      status: "synced",
      remoteRevision: 2,
    });
    expect(remote.create).toHaveBeenCalledTimes(1);
    expect(remote.update).toHaveBeenCalledTimes(1);
  });

  it("updates notes synchronized by the previous version of Quick Note", async () => {
    const store = createStore();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(
        `outline.offline-drafts.${store.scope}`,
        1
      );
      request.onupgradeneeded = () =>
        request.result.createObjectStore("drafts", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      transaction.objectStore("drafts").put({
        ...draft,
        status: "synced",
        url: "/doc/shopping-abcdefghij",
        updatedAt: new Date().toISOString(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    await store.load();
    await store.save({ ...draft, text: "Edited offline" });
    const remote = {
      find: vi.fn(async () => ({
        ...draft,
        url: "/doc/shopping-abcdefghij",
        revision: 5,
      })),
      create: vi.fn(),
      update: vi.fn(async () => ({
        url: "/doc/shopping-abcdefghij",
        revision: 6,
      })),
    };
    await store.sync(remote);
    expect(remote.create).not.toHaveBeenCalled();
    expect(remote.update).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Edited offline" }),
      5
    );
    expect(store.drafts[0]).toMatchObject({
      status: "synced",
      remoteRevision: 6,
    });
  });

  it("sends later edits to the same document and keeps newer local edits pending", async () => {
    const store = createStore();
    await store.save(draft);
    await store.queue(draft.id);
    let online = { ...draft, url: "/doc/shopping-abcdefghij", revision: 1 };
    const remote = {
      find: vi.fn(async () => online),
      create: vi.fn(),
      update: vi.fn(async (note: typeof draft, revision: number) => {
        expect(revision).toBe(1);
        await store.save({ ...draft, text: "Even newer local text" });
        online = { ...online, title: note.title, text: note.text, revision: 2 };
        return online;
      }),
    };
    await store.sync(remote);
    await store.save({ ...draft, text: "New local text" });
    await store.sync(remote);
    expect(remote.create).not.toHaveBeenCalled();
    expect(remote.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: draft.id, text: "New local text" }),
      1
    );
    expect(store.drafts[0]).toMatchObject({
      text: "Even newer local text",
      status: "queued",
      remoteRevision: 2,
    });
  });

  it("keeps both versions when the online note changed independently", async () => {
    const store = createStore();
    await store.save(draft);
    await store.queue(draft.id);
    let online = { ...draft, url: "/doc/shopping-abcdefghij", revision: 1 };
    const remote = {
      find: vi.fn(async () => online),
      create: vi.fn(),
      update: vi.fn(),
    };
    await store.sync(remote);
    await store.save({ ...draft, text: "Local changes" });
    online = { ...online, text: "Online changes", revision: 2 };
    await expect(store.sync(remote)).rejects.toBeInstanceOf(
      OfflineDraftConflictError
    );
    expect(remote.update).not.toHaveBeenCalled();
    expect(store.drafts[0]).toMatchObject({
      text: "Local changes",
      status: "queued",
      url: online.url,
    });
  });

  it("recovers an update whose response was lost without sending it twice", async () => {
    const store = createStore();
    await store.save(draft);
    await store.queue(draft.id);
    let online = { ...draft, url: "/doc/shopping-abcdefghij", revision: 1 };
    const remote = {
      find: vi.fn(async () => online),
      create: vi.fn(),
      update: vi.fn(async (note: typeof draft) => {
        online = { ...online, text: note.text, revision: 2 };
        throw new Error("response lost after update");
      }),
    };
    await store.sync(remote);
    await store.save({ ...draft, text: "New local text" });
    await expect(store.sync(remote)).rejects.toThrow("response lost");
    await store.sync(remote);
    expect(remote.update).toHaveBeenCalledTimes(1);
    expect(store.drafts[0]).toMatchObject({
      text: "New local text",
      status: "synced",
      remoteRevision: 2,
    });
  });

  it("does not send unfinished notes, and retains queued notes while offline", async () => {
    const store = createStore();
    await store.save(draft);
    const remote = {
      find: vi.fn().mockRejectedValue(new Error("offline")),
      create: vi.fn(),
      update: vi.fn(),
    };
    await store.sync(remote);
    expect(remote.find).not.toHaveBeenCalled();
    await store.queue(draft.id);
    await expect(store.sync(remote)).rejects.toThrow("offline");
    expect(store.drafts[0].status).toBe("queued");
    expect(remote.create).not.toHaveBeenCalled();
  });

  it("recovers a lost create response without creating a duplicate", async () => {
    const store = createStore();
    await store.save(draft);
    await store.queue(draft.id);
    const remote = {
      find: vi.fn().mockResolvedValue(undefined),
      create: vi
        .fn()
        .mockRejectedValue(new Error("connection lost after commit")),
      update: vi.fn(),
    };
    await expect(store.sync(remote)).rejects.toThrow();
    const reopened = new OfflineDraftsStore(store.scope);
    await reopened.load();
    remote.find.mockResolvedValue({
      ...draft,
      url: "/doc/shopping-abcdefghij",
      revision: 1,
    });
    await reopened.sync(remote);
    expect(remote.create).toHaveBeenCalledTimes(1);
    expect(reopened.drafts[0]).toMatchObject({
      status: "synced",
      url: "/doc/shopping-abcdefghij",
    });
  });

  it("sends the same stable identifier and content on retries", async () => {
    const store = createStore();
    await store.save(draft);
    await store.queue(draft.id);
    const remote = {
      find: vi.fn().mockResolvedValue(undefined),
      create: vi
        .fn()
        .mockResolvedValue({ url: "/doc/shopping-abcdefghij", revision: 1 }),
      update: vi.fn(),
    };
    await Promise.all([store.sync(remote), store.sync(remote)]);
    expect(remote.create).toHaveBeenCalledTimes(1);
    expect(remote.create).toHaveBeenCalledWith(expect.objectContaining(draft));
    expect(store.drafts[0].status).toBe("synced");
  });

  it("does not send a note after the session closes during a lookup", async () => {
    const store = createStore();
    await store.save(draft);
    await store.queue(draft.id);
    const remote = {
      find: vi.fn().mockImplementation(async () => {
        store.close();
        return undefined;
      }),
      create: vi.fn(),
      update: vi.fn(),
    };
    await store.sync(remote);
    expect(remote.create).not.toHaveBeenCalled();
    expect(store.drafts[0].status).toBe("queued");
  });
});
