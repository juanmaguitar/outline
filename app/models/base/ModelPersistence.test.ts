import stores from "~/stores";
import Model from "./Model";
import Store from "~/stores/base/Store";

class CachedModel extends Model {
  static modelName = "CachedModel";
  static persistedFields = ["urlId"];
  urlId: string;
}

class CachedStore extends Store<CachedModel> {
  constructor() {
    super(stores, CachedModel);
  }
}

it("round-trips read-only cache fields without sending them to the API", () => {
  const model = new CachedModel(
    { id: "doc", urlId: "abcdefghij", isSaving: true },
    new CachedStore()
  );
  expect(model.toPersisted()).toEqual({ id: "doc", urlId: "abcdefghij" });
  expect(model.toAPI()).not.toHaveProperty("urlId");
  expect(
    CachedModel.fromPersisted({
      ...model.toPersisted(),
      store: "untrusted",
      isSaving: true,
    })
  ).toEqual({ id: "doc", urlId: "abcdefghij" });
});
