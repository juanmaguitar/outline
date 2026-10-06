import { CollectionPermission } from "@shared/types";
import {
  CollectionsCreateSchema,
  CollectionsImportSchema,
  CollectionsUpdateSchema,
} from "./schema";

// Fork: every collection must stay shared with the whole workspace, so a
// missing or null permission falls back to read_write.
describe("CollectionsCreateSchema", () => {
  it("should default a missing permission to read_write", () => {
    const { body } = CollectionsCreateSchema.parse({
      query: {},
      body: { name: "Casa" },
    });
    expect(body.permission).toEqual(CollectionPermission.ReadWrite);
  });

  it("should turn a private (null) permission into read_write", () => {
    const { body } = CollectionsCreateSchema.parse({
      query: {},
      body: { name: "Casa", permission: null },
    });
    expect(body.permission).toEqual(CollectionPermission.ReadWrite);
  });

  it("should keep an explicit read permission", () => {
    const { body } = CollectionsCreateSchema.parse({
      query: {},
      body: { name: "Casa", permission: CollectionPermission.Read },
    });
    expect(body.permission).toEqual(CollectionPermission.Read);
  });
});

describe("CollectionsUpdateSchema", () => {
  const id = "a3f4b6c2-1d2e-4f5a-8b9c-0d1e2f3a4b5c";

  it("should turn a private (null) permission into read_write", () => {
    const { body } = CollectionsUpdateSchema.parse({
      query: {},
      body: { id, permission: null },
    });
    expect(body.permission).toEqual(CollectionPermission.ReadWrite);
  });

  it("should leave permission untouched when not sent", () => {
    const { body } = CollectionsUpdateSchema.parse({
      query: {},
      body: { id, name: "Casa" },
    });
    expect(body.permission).toBeUndefined();
  });
});

describe("CollectionsImportSchema", () => {
  it("should turn a private (null) permission into read_write", () => {
    const { body } = CollectionsImportSchema.parse({
      query: {},
      body: {
        attachmentId: "b4e5c7d3-2e3f-4a6b-9c0d-1e2f3a4b5c6d",
        permission: null,
      },
    });
    expect(body.permission).toEqual(CollectionPermission.ReadWrite);
  });
});
