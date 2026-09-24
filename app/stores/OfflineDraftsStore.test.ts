import "fake-indexeddb/auto";
import { OfflineDraftsStore } from "./OfflineDraftsStore";

describe("offline capture", () => {
  const draft = { id: "note-1", title: "Shopping", text: "Milk and bread" };
  let scope = 0;
  const createStore = () => new OfflineDraftsStore(`team.user.${++scope}`);

  const remote = {
    find: async () => ({ url: "/doc/saved-abcdefghij" }),
    create: vi.fn(),
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
        return { url: "/doc/saved-abcdefghij" };
      },
      create: vi.fn(),
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
    await expect(store.save({ ...draft, text: "overwrite" })).rejects.toThrow();
    expect(store.drafts[0].text).toBe(draft.text);
  });

  it("does not send unfinished notes, and retains queued notes while offline", async () => {
    const store = createStore();
    await store.save(draft);
    const remote = {
      find: vi.fn().mockRejectedValue(new Error("offline")),
      create: vi.fn(),
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
    };
    await expect(store.sync(remote)).rejects.toThrow();
    const reopened = new OfflineDraftsStore(store.scope);
    await reopened.load();
    remote.find.mockResolvedValue({ url: "/doc/shopping-abcdefghij" });
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
      create: vi.fn().mockResolvedValue({ url: "/doc/shopping-abcdefghij" }),
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
    };
    await store.sync(remote);
    expect(remote.create).not.toHaveBeenCalled();
    expect(store.drafts[0].status).toBe("queued");
  });
});
