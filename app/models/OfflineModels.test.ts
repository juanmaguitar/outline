import "fake-indexeddb/auto";
import "~/stores";
import RootStore from "~/stores/RootStore";
import StorePersistence from "~/stores/base/StorePersistence";

it("restores document contents, navigation, ownership and dates", async () => {
  const source = new RootStore();
  const owner = source.users.add({ id: "owner", name: "Owner" });
  const document = source.documents.add({
    id: "cached-document",
    title: "Offline",
    urlId: "abcdefghij",
    url: "/doc/offline-abcdefghij",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    publishedAt: "2026-09-01T00:00:00.000Z",
    createdBy: owner,
    data: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Saved text" }] },
      ],
    },
  });
  const persistence = new StorePersistence(
    source.documents,
    "offline-document-test"
  );
  persistence.persist(document.id);
  await persistence.flush();
  const target = new RootStore();
  await new StorePersistence(
    target.documents,
    "offline-document-test"
  ).hydrate();
  const restored = target.documents.get(document.id);
  expect(restored?.data).toEqual(document.data);
  expect(restored?.urlId).toBe(document.urlId);
  expect(restored?.publishedAt).toBe(document.publishedAt);
  expect(restored?.createdBy?.id).toBe("owner");
  expect(restored?.updatedAt).toBe(document.updatedAt);
});

it("restores the collection navigation tree and route", async () => {
  const source = new RootStore();
  const collection = source.collections.add({
    id: "cached-collection",
    name: "Family",
    url: "/collection/family-abcdefghij",
    urlId: "abcdefghij",
    sort: { field: "index", direction: "asc" },
    documents: [
      {
        id: "doc",
        title: "Shopping",
        url: "/doc/shopping-abcdefghij",
        children: [],
      },
    ],
  });
  const persistence = new StorePersistence(
    source.collections,
    "offline-collection-test"
  );
  persistence.persist(collection.id);
  await persistence.flush();
  const target = new RootStore();
  await new StorePersistence(
    target.collections,
    "offline-collection-test"
  ).hydrate();
  expect(target.collections.get(collection.id)?.documents).toEqual(
    collection.documents
  );
  expect(target.collections.get(collection.id)?.path).toBe(collection.path);
});
