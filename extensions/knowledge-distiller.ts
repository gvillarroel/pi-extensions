import os from "node:os";
import path from "node:path";

import {
  findKnowledgeCandidates,
  loadKnowledgeDocuments,
  writeClarificationSection,
} from "../src/shared/knowledge.js";
import type { ExtensionContext } from "../src/shared/types.js";

const STATUS_SLOT = "knowledge";

function getKnowledgeRoots(cwd = process.cwd()): string[] {
  return [path.join(os.homedir(), ".knowledge"), path.join(cwd, "knowledge")];
}

export function scanKnowledgeBase(cwd?: string) {
  const roots = getKnowledgeRoots(cwd);
  const documents = loadKnowledgeDocuments(roots);
  const candidates = findKnowledgeCandidates(documents);
  return {
    roots,
    documents,
    candidates,
  };
}

export function writeKnowledgeClarification(
  title: string,
  content: string,
  targetFile: string,
): void {
  writeClarificationSection(targetFile, title, content);
}

function renderCandidates(cwd?: string): string {
  const { candidates } = scanKnowledgeBase(cwd);
  if (!candidates.length) {
    return "No unclear concepts were found.";
  }

  return candidates
    .map((candidate) => {
      const signals = candidate.signals.map((signal) => signal.type).join(", ");
      return `${candidate.title} | ${signals} | ${candidate.path}`;
    })
    .join("\n");
}

export default function registerKnowledgeDistiller(pi: any) {
  // Next expected extension point: add richer ambiguity heuristics without changing the command contract.
  pi.registerCommand?.("knowledge_scan", {
    description: "Scan markdown knowledge roots for unclear concepts.",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const report = renderCandidates(ctx.cwd);
      console.log(report);
      ctx?.ui?.notify?.("Knowledge scan completed.", "info");
      ctx?.ui?.setStatus?.(STATUS_SLOT, "Knowledge scan completed.");
      ctx?.ui?.setEditorText?.(report);
    },
  });

  pi.registerCommand?.("knowledge_write", {
    description: "Write a clarification section using /knowledge_write <title> <targetFile>.",
    handler: async (args: string, ctx: ExtensionContext) => {
      const [title, targetFile, ...bodyParts] = args.split(/\s+/);
      if (!title || !targetFile) {
        throw new Error("Usage: /knowledge_write <title> <targetFile> [content...]");
      }

      const content =
        bodyParts.join(" ").trim() ||
        `Definition for ${title}\n\nBoundary notes:\n- Define expected inputs.\n- Define expected outputs.\n- Add one worked example.\n`;
      writeKnowledgeClarification(title, content, path.resolve(ctx.cwd ?? process.cwd(), targetFile));
      ctx?.ui?.notify?.(`Clarification written to ${targetFile}.`, "info");
      ctx?.ui?.setStatus?.(STATUS_SLOT, `Clarification written for ${title}.`);
    },
  });

  pi.registerTool?.({
    name: "knowledge_list_candidates",
    description: "List unclear concepts discovered in markdown knowledge files.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async () => ({
      content: [{ type: "text", text: renderCandidates() }],
    }),
  });
}
