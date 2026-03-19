import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export class YamlFileError extends Error {
  constructor(
    public readonly filePath: string,
    message: string,
  ) {
    super(`${filePath}: ${message}`);
    this.name = "YamlFileError";
  }
}

export function readYamlFile<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  const text = fs.readFileSync(filePath, "utf8");
  try {
    return YAML.parse(text) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new YamlFileError(filePath, `Invalid YAML syntax. ${reason}`);
  }
}

export function writeYamlFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, YAML.stringify(value), "utf8");
}

export function parseFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!markdown.startsWith("---\n")) {
    return { frontmatter: {}, body: markdown };
  }

  const closingIndex = markdown.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return { frontmatter: {}, body: markdown };
  }

  const frontmatterText = markdown.slice(4, closingIndex);
  const body = markdown.slice(closingIndex + 5);
  let frontmatter: Record<string, unknown>;

  try {
    frontmatter = (YAML.parse(frontmatterText) as Record<string, unknown>) ?? {};
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YAML frontmatter. ${reason}`);
  }

  return {
    frontmatter,
    body,
  };
}

export function renderFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const yamlBlock = YAML.stringify(frontmatter).trimEnd();
  return `---\n${yamlBlock}\n---\n${body.replace(/^\n*/, "")}`;
}
