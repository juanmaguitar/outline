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
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState(false);
  const revision = useRef(0);
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
        revision.current++;
        setDraft({ id: uuid(), title: "", text: "" });
        setStatus("empty");
      }
    } catch (_error) {
      setRemoveError(true);
    } finally {
      setRemoving(false);
    }
  };

  useEffect(() => {
    if (status !== "saving" && status !== "error") {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [status]);

  const handleChange = (field: "title" | "text", value: string) => {
    const next = { ...draft, [field]: value };
    const currentRevision = ++revision.current;
    setDraft(next);
    setStatus("saving");
    void store
      .save(next)
      .then(() => {
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
      setStatus("saved");
      void sync();
    } catch (_error) {
      setStatus("error");
    } finally {
      setQueueing(false);
    }
  };

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
          disabled={queueing}
          onChange={(event) => handleChange("title", event.target.value)}
        />
        <label htmlFor="quick-note-text">{t("Note")}</label>
        <NoteInput
          id="quick-note-text"
          value={draft.text}
          disabled={queueing}
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
            disabled={queueing || status === "saving" || status === "error"}
            onClick={() => {
              revision.current++;
              setDraft({ id: uuid(), title: "", text: "" });
              setStatus("empty");
            }}
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
              <strong>{item.title || t("Untitled")}</strong>
              <Preview>{item.text}</Preview>
              <Button
                neutral
                disabled={queueing || status === "saving" || status === "error"}
                onClick={() => {
                  revision.current++;
                  setDraft({ id: item.id, title: item.title, text: item.text });
                  setStatus("saved");
                }}
              >
                {t("Continue writing")}
              </Button>
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
const Preview = styled.p`
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 8em;
  overflow: auto;
`;
