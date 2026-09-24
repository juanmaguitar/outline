import "fake-indexeddb/auto";
import { OfflineDraftsStore } from "./OfflineDraftsStore";

describe("offline capture", () => {
  const draft = { id: "note-1", title: "Shopping", text: "Milk and bread" };
  let scope = 0;
  const createStore = () => new OfflineDraftsStore(`team.user.${++scope}`);

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
