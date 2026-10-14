import "fake-indexeddb/auto";
import "~/stores";
import RootStore from "~/stores/RootStore";
import StorePersistence from "~/stores/base/StorePersistence";
import { client } from "~/utils/ApiClient";

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

describe("restored collection navigation tree", () => {
  const cachedTree = [
    { id: "old", title: "Old", url: "/doc/old-abcdefghij", children: [] },
  ];
  const freshTree = [
    ...cachedTree,
    { id: "new", title: "New", url: "/doc/new-abcdefghij", children: [] },
  ];

  async function restoredCollection(scope: string) {
    const source = new RootStore();
    const collection = source.collections.add({
      id: "tree-collection",
      name: "Family",
      urlId: "abcdefghij",
      documents: cachedTree,
    });
    const persistence = new StorePersistence(source.collections, scope);
    persistence.persist(collection.id);
    await persistence.flush();
    const target = new RootStore();
    await new StorePersistence(target.collections, scope).hydrate();
    return target.collections.get(collection.id)!;
  }

  const auth = { data: { user: {}, team: {}, groups: [], groupUsers: [] } };

  /** Answers auth requests from RootStore and the tree request with `tree`. */
  function mockTreeRequest(tree: () => Promise<unknown>) {
    const request = vi.spyOn(client, "post");
    request.mockClear();
    return request.mockImplementation((path: string) =>
      path === "/collections.documents" ? tree() : Promise.resolve(auth)
    );
  }

  function treeRequests(request: ReturnType<typeof mockTreeRequest>) {
    return request.mock.calls.filter(
      ([path]) => path === "/collections.documents"
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("revalidates the tree from the server when online", async () => {
    const request = mockTreeRequest(async () => ({ data: freshTree }));
    const collection = await restoredCollection("tree-online");

    await collection.fetchDocuments();

    expect(treeRequests(request)).toEqual([
      ["/collections.documents", { id: collection.id }],
    ]);
    expect(collection.documents?.map((node) => node.id)).toEqual([
      "old",
      "new",
    ]);
  });

  it("only revalidates the tree once per session", async () => {
    const request = mockTreeRequest(async () => ({ data: freshTree }));
    const collection = await restoredCollection("tree-once");

    await collection.fetchDocuments();
    await collection.fetchDocuments();

    expect(treeRequests(request)).toHaveLength(1);
  });

  it("keeps the cached tree without a request while offline", async () => {
    const request = mockTreeRequest(async () => ({ data: freshTree }));
    const collection = await restoredCollection("tree-offline");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    await collection.fetchDocuments();

    expect(treeRequests(request)).toHaveLength(0);
    expect(collection.documents?.map((node) => node.id)).toEqual(["old"]);
  });

  it("keeps the cached tree when revalidation fails", async () => {
    mockTreeRequest(() => Promise.reject(new Error("Network down")));
    const collection = await restoredCollection("tree-failure");

    await collection.fetchDocuments();

    expect(collection.documents?.map((node) => node.id)).toEqual(["old"]);
  });
});
