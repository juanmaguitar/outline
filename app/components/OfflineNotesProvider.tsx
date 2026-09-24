import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { observer } from "mobx-react";
import { OfflineDraftsStore } from "~/stores/OfflineDraftsStore";
import useStores from "~/hooks/useStores";
import {
  AuthorizationError,
  BadRequestError,
  NotFoundError,
} from "~/utils/errors";
import { client } from "~/utils/ApiClient";
import { getCSRFToken, refreshCSRFToken } from "~/utils/csrf";

interface OfflineNotesContext {
  store: OfflineDraftsStore;
  online: boolean;
  error: string | undefined;
  sync: () => Promise<void>;
}

const Context = createContext<OfflineNotesContext | undefined>(undefined);

/** Provides locally saved notes and retries delivery while the app is open. */
export const OfflineNotesProvider = observer(function OfflineNotesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { auth, documents } = useStores();
  const teamId = auth.currentTeamId;
  const userId = auth.currentUserId;
  const store = useMemo(
    () => new OfflineDraftsStore(`${teamId}.${userId}`),
    [teamId, userId]
  );
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState<string>();
  const syncing = useRef(false);

  const sync = useCallback(async () => {
    if (
      !navigator.onLine ||
      syncing.current ||
      store.isSyncing ||
      !store.drafts.some((draft) => draft.status === "queued")
    ) {
      return;
    }
    syncing.current = true;
    try {
      // Verify the live session before sending notes from a locally cached user.
      const response = await client.post("/auth.info");
      if (
        response.data.user.id !== userId ||
        response.data.team.id !== teamId
      ) {
        store.close();
        throw new AuthorizationError(
          "Sign in with the account that created these notes to sync them."
        );
      }
      if (!getCSRFToken()) {
        await refreshCSRFToken();
      }
      await store.sync({
        find: async (id) => {
          try {
            return await documents.fetch(id, { force: true });
          } catch (error) {
            if (error instanceof NotFoundError) {
              return undefined;
            }
            throw error;
          }
        },
        create: (draft) =>
          documents.create(
            { id: draft.id, title: draft.title },
            { text: draft.text }
          ),
      });
      setError(undefined);
    } catch (error) {
      setError(
        error instanceof AuthorizationError
          ? "Your notes are still saved on this device. Outline could not authorize synchronization. Open Outline with the account that saved these notes, then try again."
          : error instanceof BadRequestError
            ? "Your notes are still saved on this device. Outline rejected the note. Please try again."
            : "Your notes are still saved on this device. Synchronization will retry when a connection is available."
      );
    } finally {
      syncing.current = false;
    }
  }, [store, documents, teamId, userId]);

  useEffect(() => {
    void store
      .load()
      .then(sync)
      .catch(() =>
        setError("Local storage is unavailable. Your note has not been saved.")
      );
    const handleOnline = () => {
      setOnline(navigator.onLine);
      void sync();
    };
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void store
          .load()
          .then(sync)
          .catch(() => undefined);
      }
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOnline);
    document.addEventListener("visibilitychange", handleVisible);
    const interval = window.setInterval(() => {
      void sync();
    }, 30000);
    return () => {
      store.close();
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOnline);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [store, sync]);

  return (
    <Context.Provider value={{ store, online, error, sync }}>
      {children}
    </Context.Provider>
  );
});

/** Returns the notes belonging to the currently authenticated account. */
export function useOfflineNotes(): OfflineNotesContext {
  const context = useContext(Context);
  if (!context) {
    throw new Error("OfflineNotesProvider is missing");
  }
  return context;
}
