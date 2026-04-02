import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  findKnowledgeCandidates,
  loadKnowledgeDocuments,
  writeClarificationSection,
} from "../src/shared/knowledge.js";

describe("knowledge helpers", () => {
  it("finds unclear concepts from markdown heuristics", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-knowledge-"));
    const filePath = path.join(root, "concept.md");
    fs.writeFileSync(
      filePath,
      `---\ntitle: Concept A\nstatus: draft\nconfidence: low\n---\n\nTODO: define this better.\n`,
      "utf8",
    );

    const documents = loadKnowledgeDocuments([root]);
    const candidates = findKnowledgeCandidates(documents);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].signals.map((signal) => signal.type)).toEqual(
      expect.arrayContaining(["draft-status", "low-confidence", "placeholder", "short-body"]),
    );
  });

  it("writes or replaces a clarification section while preserving frontmatter", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-knowledge-write-"));
    const filePath = path.join(root, "guide.md");
    fs.writeFileSync(filePath, `---\ntitle: Guide\n---\n\n# Guide\n`, "utf8");

    writeClarificationSection(filePath, "Scope", "The scope is explicit.");
    const written = fs.readFileSync(filePath, "utf8");

    expect(written).toContain("lastUpdatedBy: knowledge-distiller");
    expect(written).toContain("## Scope");
    expect(written).toContain("The scope is explicit.");
  });

  it("handles titles with regex special characters safely", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-knowledge-regex-"));
    const filePath = path.join(root, "guide.md");
    fs.writeFileSync(filePath, `---\ntitle: Guide\n---\n\n# Guide\n`, "utf8");

    const specialTitle = "Config (v2.0) [beta]";
    writeClarificationSection(filePath, specialTitle, "First version.");
    writeClarificationSection(filePath, specialTitle, "Updated version.");
    const written = fs.readFileSync(filePath, "utf8");

    // Should contain only one instance of the heading (replaced, not duplicated)
    const headingCount = (written.match(/## Config \(v2\.0\) \[beta\]/g) || []).length;
    expect(headingCount).toBe(1);
    expect(written).toContain("Updated version.");
    expect(written).not.toContain("First version.");
  });
});
