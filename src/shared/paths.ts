import os from "node:os";
import path from "node:path";

export function getHomeConfigDir(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, ".pi-extensions");
}

export function ensureArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function getByPath(source: unknown, pathExpression: string): unknown {
  return pathExpression
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object") {
        return undefined;
      }

      return (current as Record<string, unknown>)[key];
    }, source);
}

export function interpolateTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, token) => {
    const value = getByPath(context, String(token).trim());
    if (value === undefined || value === null) {
      return "";
    }

    return typeof value === "string" ? value : JSON.stringify(value);
  });
}
