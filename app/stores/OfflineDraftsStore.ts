import { observable, runInAction } from "mobx";

/** A locally durable note; queued content is immutable until synchronization. */
export interface OfflineDraft {
  id: string;
  title: string;
  text: string;
  updatedAt: string;
  status: "draft" | "queued" | "synced";
  url?: string;
}

/** The authenticated document operations needed to deliver a queued note. */
export interface OfflineDraftRemote {
  find(id: string): Promise<{ url: string } | undefined>;
  create(draft: OfflineDraft): Promise<{ url: string }>;
}

/** Stores quick notes separately from the replaceable document cache. */
export class OfflineDraftsStore {
  @observable
  drafts: OfflineDraft[] = [];
  @observable
  isLoaded = false;
  @observable
  isSyncing = false;

  constructor(public readonly scope: string) {}

  /** Loads notes belonging to this workspace and user. */
  async load(): Promise<void> {
    const database = await this.open();
    try {
      const records = await new Promise<OfflineDraft[]>((resolve, reject) => {
        const request = database
          .transaction("drafts")
          .objectStore("drafts")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      runInAction(() => {
        this.drafts = records.sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt)
        );
        this.isLoaded = true;
      });
    } finally {
      database.close();
    }
  }

  /** Durably saves an unfinished note, without requiring a server connection. */
  save(draft: Pick<OfflineDraft, "id" | "title" | "text">): Promise<void> {
    return this.write(draft.id, (previous) => {
      if (previous && previous.status !== "draft") {
        throw new Error("This note is already queued for synchronization");
      }
      return { ...draft, status: "draft", updatedAt: new Date().toISOString() };
    });
  }

  /** Freezes the saved content for retry-safe delivery when connected. */
  queue(id: string): Promise<void> {
    return this.write(id, (draft) => {
      if (!draft || draft.status !== "draft") {
        throw new Error("The draft is not available");
      }
      if (!draft.title.trim() && !draft.text.trim()) {
        throw new Error("The note is empty");
      }
      return { ...draft, status: "queued" };
    });
  }

  /**
   * Delivers queued notes with stable IDs. A lookup recovers successful creates
   * whose response was lost, without overwriting subsequent server-side edits.
   *
   * @param remote authenticated operations for this exact workspace and user.
   */
  async sync(remote: OfflineDraftRemote): Promise<void> {
    if (this.isSyncing || this.closed) {
      return;
    }
    this.isSyncing = true;
    try {
      await this.writes;
      await this.load();
      for (const draft of this.drafts.filter(
        (item) => item.status === "queued"
      )) {
        if (this.closed) {
          return;
        }
        const existing = await remote.find(draft.id);
        if (this.closed) {
          return;
        }
        const document = existing ?? (await remote.create(draft));
        if (this.closed) {
          return;
        }
        await this.write(draft.id, (current) => {
          if (!current) {
            throw new Error("The queued note is not available");
          }
          return { ...current, status: "synced", url: document.url };
        });
      }
    } finally {
      runInAction(() => {
        this.isSyncing = false;
      });
    }
  }

  /**
   * Removes only confirmed synced copies from this account's local storage.
   *
   * @param id the individual copy to remove, or omit to remove all synced copies.
   */
  removeSynced(id?: string): Promise<void> {
    const write = this.writes.then(async () => {
      const database = await this.open();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction("drafts", "readwrite");
          const request = transaction.objectStore("drafts").openCursor(id);
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              return;
            }
            if (cursor.value.status === "synced") {
              cursor.delete();
            }
            cursor.continue();
          };
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () =>
            reject(
              transaction.error ?? new Error("Removing local copies failed")
            );
        });
      } finally {
        database.close();
      }
      await this.load();
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  /** Stops delivery when the owning session is no longer active. */
  close(): void {
    this.closed = true;
  }

  private closed = false;
  private writes: Promise<void> = Promise.resolve();

  private write(
    id: string,
    update: (draft?: OfflineDraft) => OfflineDraft
  ): Promise<void> {
    const write = this.writes.then(async () => {
      const database = await this.open();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction("drafts", "readwrite");
          const store = transaction.objectStore("drafts");
          const request = store.get(id);
          request.onsuccess = () => {
            try {
              store.put(update(request.result));
            } catch (error) {
              transaction.abort();
              reject(error);
            }
          };
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () =>
            reject(transaction.error ?? new Error("Saving the note failed"));
        });
      } finally {
        database.close();
      }
      await this.load();
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(`outline.offline-drafts.${this.scope}`, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("drafts", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("Local storage is blocked by another tab"));
    });
  }
}
