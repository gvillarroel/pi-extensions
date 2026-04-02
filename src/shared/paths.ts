import os from "node:os";
import path from "node:path";

export function getHomeConfigDir(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, ".pi-extensions");
}

export function ensureArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function normalizePath(filePath: string): string {
  return path.resolve(filePath);
}

/**
 * Validates that all specified fields on a record are strings.
 * Returns the record cast to T if valid, undefined otherwise.
 */
export function validateRecordFields<T>(
  value: unknown,
  requiredStringFields: string[],
  enumFields?: Record<string, string[]>,
): T | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  for (const field of requiredStringFields) {
    if (typeof record[field] !== "string") return undefined;
  }

  if (enumFields) {
    for (const [field, allowed] of Object.entries(enumFields)) {
      if (!allowed.includes(record[field] as string)) return undefined;
    }
  }

  return record as T;
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

    if (typeof value === "string") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.join(", ");
    }

    return JSON.stringify(value);
  });
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
