import { describe, expect, it } from "vitest";

import {
  asRecord,
  escapeRegExp,
  getByPath,
  interpolateTemplate,
  validateRecordFields,
} from "../src/shared/paths.js";

describe("paths utilities", () => {
  describe("interpolateTemplate", () => {
    it("renders string values as-is", () => {
      expect(interpolateTemplate("Hello {{name}}", { name: "world" })).toBe("Hello world");
    });

    it("renders arrays as comma-separated values", () => {
      expect(interpolateTemplate("Labels: {{labels}}", { labels: ["bug", "feature"] })).toBe(
        "Labels: bug, feature",
      );
    });

    it("renders empty string for undefined values", () => {
      expect(interpolateTemplate("Value: {{missing}}", {})).toBe("Value: ");
    });

    it("renders nested paths", () => {
      expect(interpolateTemplate("{{item.id}}", { item: { id: "42" } })).toBe("42");
    });

    it("JSON-stringifies objects", () => {
      const result = interpolateTemplate("Data: {{obj}}", { obj: { key: "val" } });
      expect(result).toBe('Data: {"key":"val"}');
    });
  });

  describe("getByPath", () => {
    it("traverses nested objects", () => {
      expect(getByPath({ a: { b: { c: 3 } } }, "a.b.c")).toBe(3);
    });

    it("returns undefined for missing paths", () => {
      expect(getByPath({ a: 1 }, "a.b.c")).toBeUndefined();
    });
  });

  describe("asRecord", () => {
    it("returns the record for plain objects", () => {
      expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    });

    it("returns undefined for arrays", () => {
      expect(asRecord([1, 2])).toBeUndefined();
    });

    it("returns undefined for null", () => {
      expect(asRecord(null)).toBeUndefined();
    });

    it("returns undefined for primitives", () => {
      expect(asRecord("hello")).toBeUndefined();
      expect(asRecord(42)).toBeUndefined();
    });
  });

  describe("escapeRegExp", () => {
    it("escapes regex special characters", () => {
      expect(escapeRegExp("hello.world")).toBe("hello\\.world");
      expect(escapeRegExp("foo[bar](baz)")).toBe("foo\\[bar\\]\\(baz\\)");
      expect(escapeRegExp("a*b+c?")).toBe("a\\*b\\+c\\?");
    });

    it("leaves plain strings unchanged", () => {
      expect(escapeRegExp("hello world")).toBe("hello world");
    });
  });

  describe("validateRecordFields", () => {
    it("returns typed record when all fields are valid strings", () => {
      const result = validateRecordFields<{ name: string; id: string }>(
        { name: "test", id: "42" },
        ["name", "id"],
      );
      expect(result).toEqual({ name: "test", id: "42" });
    });

    it("returns undefined when a required string field is missing", () => {
      expect(validateRecordFields({ name: "test" }, ["name", "id"])).toBeUndefined();
    });

    it("returns undefined when a required string field is not a string", () => {
      expect(validateRecordFields({ name: "test", id: 42 }, ["name", "id"])).toBeUndefined();
    });

    it("validates enum fields", () => {
      const valid = validateRecordFields(
        { status: "passed", id: "x" },
        ["id"],
        { status: ["passed", "failed"] },
      );
      expect(valid).toBeTruthy();

      const invalid = validateRecordFields(
        { status: "unknown", id: "x" },
        ["id"],
        { status: ["passed", "failed"] },
      );
      expect(invalid).toBeUndefined();
    });

    it("returns undefined for non-objects", () => {
      expect(validateRecordFields(null, ["id"])).toBeUndefined();
      expect(validateRecordFields("string", ["id"])).toBeUndefined();
      expect(validateRecordFields([1, 2], ["id"])).toBeUndefined();
    });
  });
});
