import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { v4 as uuid } from "uuid";
import Button from "~/components/Button";
import Heading from "~/components/Heading";
import Scene from "~/components/Scene";
import { useOfflineNotes } from "~/components/OfflineNotesProvider";

/** A small, immediately editable capture surface backed by local storage. */
export const QuickNote = observer(function QuickNote() {
  const { t } = useTranslation();
  const { store, online, error, sync } = useOfflineNotes();
  const [draft, setDraft] = useState({ id: uuid(), title: "", text: "" });
  const [status, setStatus] = useState<"empty" | "saving" | "saved" | "error">(
    "empty"
  );
  const [queueing, setQueueing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState(false);
  const [readyScope, setReadyScope] = useState<string>();
  const revision = useRef(0);
  const restoredScope = useRef<string>();
  const syncedCount = store.drafts.filter(
    (item) => item.status === "synced"
  ).length;
  const activeNote = store.drafts.find((item) => item.id === draft.id);

  const handleRemove = async (id?: string) => {
    setRemoving(true);
    setRemoveError(false);
    try {
      await store.removeSynced(id);
      if (id === draft.id || (!id && activeNote?.status === "synced")) {
        const next = { id: uuid(), title: "", text: "" };
        await store.setActive(next.id);
        revision.current++;
        setDraft(next);
        setStatus("empty");
      }
    } catch (_error) {
      setRemoveError(true);
    } finally {
      setRemoving(false);
    }
  };

  useEffect(() => {
    if (!store.isLoaded || restoredScope.current === store.scope) {
      return;
    }
    restoredScope.current = store.scope;
    const saved = store.drafts.find((item) => item.id === store.activeId);
    if (saved) {
      setDraft({ id: saved.id, title: saved.title, text: saved.text });
      setStatus("saved");
      setReadyScope(store.scope);
      return;
    }
    if (store.activeId) {
      setDraft({ id: store.activeId, title: "", text: "" });
      setStatus("empty");
      setReadyScope(store.scope);
      return;
    }
    const recent = store.drafts[0];
    if (recent) {
      setDraft({ id: recent.id, title: recent.title, text: recent.text });
      setStatus("saved");
      void store.setActive(recent.id).catch(() => setStatus("error"));
    } else {
      setDraft({ id: uuid(), title: "", text: "" });
      setStatus("empty");
    }
    setReadyScope(store.scope);
  }, [store, store.isLoaded]);

  const handleSwitch = async (next: {
    id: string;
    title: string;
    text: string;
  }) => {
    setSwitching(true);
    try {
      await store.setActive(next.id);
      const current = store.drafts.find((item) => item.id === next.id);
      revision.current++;
      setDraft(
        current
          ? { id: current.id, title: current.title, text: current.text }
          : next
      );
      setStatus(current || next.title || next.text ? "saved" : "empty");
    } catch (_error) {
      setStatus("error");
    } finally {
      setSwitching(false);
    }
  };

  useEffect(() => {
    if (status !== "saving" && status !== "error" && !switching) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [status, switching]);

  const handleChange = (field: "title" | "text", value: string) => {
    const next = { ...draft, [field]: value };
    const currentRevision = ++revision.current;
    setDraft(next);
    setStatus("saving");
    void store
      .save(next)
      .then(async () => {
        if (store.activeId !== next.id) {
          await store.setActive(next.id);
        }
        if (revision.current === currentRevision) {
          setStatus("saved");
        }
      })
      .catch(() => {
        if (revision.current === currentRevision) {
          setStatus("error");
        }
      });
  };

  const handleSave = async () => {
    setQueueing(true);
    try {
      await store.save(draft);
      await store.queue(draft.id);
      if (store.activeId !== draft.id) {
        await store.setActive(draft.id);
      }
      setStatus("saved");
      void sync();
    } catch (_error) {
      setStatus("error");
    } finally {
      setQueueing(false);
    }
  };

  if (readyScope !== store.scope) {
    return (
      <Scene title={t("Quick note")}>
        <Heading>{t("Quick note")}</Heading>
        <p role="status">{t("Opening your note on this device…")}</p>
      </Scene>
    );
  }

  return (
    <Scene title={t("Quick note")}>
      <Heading>{t("Quick note")}</Heading>
      <p>
        {t(
          "Write and keep editing offline. Changes sync to Drafts when a connection is available."
        )}
      </p>
      <Form
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <label htmlFor="quick-note-title">{t("Title")}</label>
        <TitleInput
          id="quick-note-title"
          value={draft.title}
          disabled={queueing || switching || removing}
          onChange={(event) => handleChange("title", event.target.value)}
        />
        <label htmlFor="quick-note-text">{t("Note")}</label>
        <NoteInput
          id="quick-note-text"
          value={draft.text}
          disabled={queueing || switching || removing}
          onChange={(event) => handleChange("text", event.target.value)}
          placeholder={t("Start writing…")}
        />
        <p role="status" aria-live="polite">
          {status === "saving"
            ? t("Saving on this device…")
            : status === "saved"
              ? t("Saved on this device")
              : status === "error"
                ? t("Not saved. Keep this page open and try again.")
                : online
                  ? t("Ready to write")
                  : t("You’re offline. You can keep writing.")}
        </p>
        <Button
          type="submit"
          disabled={
            queueing ||
            switching ||
            removing ||
            activeNote?.status === "synced" ||
            (!draft.title.trim() && !draft.text.trim())
          }
        >
          {t(
            activeNote?.status === "synced"
              ? "Synced"
              : activeNote?.status === "queued"
                ? "Sync note"
                : "Save note"
          )}
        </Button>
        {activeNote && (
          <Button
            neutral
            type="button"
            disabled={
              queueing ||
              switching ||
              removing ||
              status === "saving" ||
              status === "error"
            }
            onClick={() =>
              void handleSwitch({ id: uuid(), title: "", text: "" })
            }
          >
            {t("New note")}
          </Button>
        )}
      </Form>
      {activeNote?.status === "queued" && (
        <>
          <p role="status">{t("Saved on this device · Waiting to sync")}</p>
          {activeNote.url?.startsWith("/doc/") && (
            <Link to={activeNote.url}>{t("Open in Outline")}</Link>
          )}
        </>
      )}
      {activeNote?.status === "synced" && (
        <>
          <SyncedStatus role="status">
            <span aria-hidden="true">✓ </span>
            {t("Synced with Outline · Available offline")}
          </SyncedStatus>
          <Actions>
            {activeNote.url?.startsWith("/doc/") && (
              <Link to={activeNote.url}>{t("Open in Outline")}</Link>
            )}
            <Button
              neutral
              disabled={removing}
              onClick={() => void handleRemove(activeNote.id)}
            >
              {t("Remove local copy")}
            </Button>
          </Actions>
        </>
      )}
      {error && <p role="alert">{t(error)}</p>}
      <h2>{t("Notes on this device")}</h2>
      <p>
        {t(
          "Removing local copies keeps your notes in Outline. Unsent notes are kept on this device."
        )}
      </p>
      {removeError && (
        <p role="alert">
          {t("Could not remove local copies. Please try again.")}
        </p>
      )}
      {store.isSyncing && <p role="status">{t("Syncing…")}</p>}
      <Button
        neutral
        onClick={() => {
          void sync();
        }}
        disabled={!online || store.isSyncing}
      >
        {t("Sync now")}
      </Button>
      {syncedCount > 0 && (
        <Button neutral disabled={removing} onClick={() => void handleRemove()}>
          {t("Remove all synced local copies")} ({syncedCount})
        </Button>
      )}
      <Notes>
        {store.drafts
          .filter((item) => item.id !== draft.id)
          .map((item) => (
            <li key={item.id}>
              <TitleButton
                type="button"
                disabled={
                  queueing ||
                  switching ||
                  removing ||
                  status === "saving" ||
                  status === "error"
                }
                onClick={() =>
                  void handleSwitch({
                    id: item.id,
                    title: item.title,
                    text: item.text,
                  })
                }
              >
                {item.title || t("Untitled")}
              </TitleButton>
              <Preview>{item.text}</Preview>
              {item.status === "draft" ? null : item.status === "queued" ? (
                <>
                  <span>{t("Saved on this device · Waiting to sync")}</span>
                  {item.url?.startsWith("/doc/") && (
                    <Link to={item.url}>{t("Open in Outline")}</Link>
                  )}
                </>
              ) : (
                <>
                  <SyncedStatus role="status">
                    <span aria-hidden="true">✓ </span>
                    {t("Synced with Outline · Available offline")}
                  </SyncedStatus>
                  <Actions>
                    {item.url?.startsWith("/doc/") && (
                      <Link to={item.url}>{t("Open in Outline")}</Link>
                    )}
                    <Button
                      neutral
                      disabled={removing}
                      onClick={() => void handleRemove(item.id)}
                    >
                      {t("Remove local copy")}
                    </Button>
                  </Actions>
                </>
              )}
            </li>
          ))}
      </Notes>
    </Scene>
  );
});

const Form = styled.form`
  display: grid;
  gap: 8px;
  margin: 24px 0;
`;
const SyncedStatus = styled.p`
  font-weight: 600;
`;
const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
`;
const TitleInput = styled.input`
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 6px;
  padding: 12px;
  font-size: 18px;
`;
const NoteInput = styled.textarea`
  font: inherit;
  color: inherit;
  background: transparent;
  border: 1px solid ${(props) => props.theme.divider};
  border-radius: 6px;
  padding: 12px;
  font-size: 16px;
  line-height: 1.6;
  min-height: 35vh;
  resize: vertical;
`;
const Notes = styled.ul`
  list-style: none;
  padding: 0;
  li {
    padding: 16px 0;
    border-bottom: 1px solid ${(props) => props.theme.divider};
  }
`;
const TitleButton = styled.button`
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    text-decoration: underline;
  }

  &:disabled {
    cursor: default;
  }
`;
const Preview = styled.p`
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 8em;
  overflow: auto;
`;
