import fs from "node:fs";
import path from "node:path";

import type { KnowledgeCandidate, KnowledgeDocument, KnowledgeSignal } from "./types.js";
import { parseFrontmatter, renderFrontmatter } from "./yaml.js";

function walkMarkdownFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const output: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...walkMarkdownFiles(target));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      output.push(target);
    }
  }

  return output;
}

export function loadKnowledgeDocuments(directories: string[]): KnowledgeDocument[] {
  return directories.flatMap((directory) =>
    walkMarkdownFiles(directory).map((filePath) => {
      const content = fs.readFileSync(filePath, "utf8");
      const parsed = parseFrontmatter(content);
      return {
        path: filePath,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
      };
    }),
  );
}

export function collectKnowledgeSignals(document: KnowledgeDocument): KnowledgeSignal[] {
  const signals: KnowledgeSignal[] = [];
  const body = document.body.trim();
  const status = document.frontmatter.status;
  const confidence = document.frontmatter.confidence;

  if (typeof status === "string" && status.toLowerCase() === "draft") {
    signals.push({
      type: "draft-status",
      message: "Document is still marked as draft.",
    });
  }

  if (typeof confidence === "string" && ["low", "unknown"].includes(confidence.toLowerCase())) {
    signals.push({
      type: "low-confidence",
      message: "Document confidence is low and should be reviewed.",
    });
  }

  if (/TODO|TBD|\?\?\?|unclear|unknown/i.test(body)) {
    signals.push({
      type: "placeholder",
      message: "Document contains placeholder or ambiguity markers.",
    });
  }

  if (body.length < 200) {
    signals.push({
      type: "short-body",
      message: "Document body is too short to define boundaries clearly.",
    });
  }

  return signals;
}

export function findKnowledgeCandidates(documents: KnowledgeDocument[]): KnowledgeCandidate[] {
  return documents
    .map((document) => {
      const signals = collectKnowledgeSignals(document);
      return {
        path: document.path,
        title: typeof document.frontmatter.title === "string" ? document.frontmatter.title : path.basename(document.path),
        signals,
      };
    })
    .filter((candidate) => candidate.signals.length > 0)
    .sort((left, right) => right.signals.length - left.signals.length);
}

export function writeClarificationSection(targetFile: string, title: string, body: string): void {
  const existing = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, "utf8") : "";
  const parsed = parseFrontmatter(existing);
  const heading = `## ${title}`;
  const trimmedBody = body.trim();
  const section = `${heading}\n\n${trimmedBody}\n`;
  const bodyWithoutTrailingSpace = parsed.body.trimEnd();
  const nextBody = bodyWithoutTrailingSpace.includes(heading)
    ? bodyWithoutTrailingSpace.replace(new RegExp(`## ${title}[\\s\\S]*?(?=\\n## |$)`), section.trimEnd())
    : `${bodyWithoutTrailingSpace}${bodyWithoutTrailingSpace ? "\n\n" : ""}${section}`.trimEnd();

  const frontmatter = {
    ...parsed.frontmatter,
    lastUpdatedBy: "knowledge-distiller",
  };

  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, renderFrontmatter(frontmatter, nextBody), "utf8");
}
