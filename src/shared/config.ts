import path from "node:path";

import type { DashboardConfigFile, GatesConfigFile, JobsConfigFile, WorkflowConfigFile } from "./types.js";
import {
  type ConfigValidationIssue,
  validateDashboardConfig,
  validateGatesConfig,
  validateJobsConfig,
  validateWorkflowConfig,
} from "./config-schema.js";
import { getHomeConfigDir } from "./paths.js";
import { readYamlFile } from "./yaml.js";

export interface ConfigLoadOptions {
  cwd?: string;
  homeDirectory?: string;
}

export class ConfigValidationError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly issues: ConfigValidationIssue[],
  ) {
    super(
      `${filePath}: Invalid configuration.\n${issues
        .map((issue) => `- ${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
    this.name = "ConfigValidationError";
  }
}

type ConfigValidator = (value: unknown, issues: ConfigValidationIssue[]) => boolean;

const validators: Record<string, ConfigValidator> = {
  "dashboard.sources.yaml": validateDashboardConfig,
  "workflows.yaml": validateWorkflowConfig,
  "gates.yaml": validateGatesConfig,
  "jobs.yaml": validateJobsConfig,
};

function mergeValues(globalValue: unknown, localValue: unknown): unknown {
  if (Array.isArray(localValue)) {
    return [...localValue];
  }

  if (localValue === undefined) {
    if (Array.isArray(globalValue)) {
      return [...globalValue];
    }

    if (globalValue && typeof globalValue === "object") {
      return mergeValues({}, globalValue);
    }

    return globalValue;
  }

  if (
    globalValue &&
    localValue &&
    typeof globalValue === "object" &&
    typeof localValue === "object" &&
    !Array.isArray(globalValue) &&
    !Array.isArray(localValue)
  ) {
    const mergedEntries = new Map<string, unknown>();
    for (const [key, value] of Object.entries(globalValue as Record<string, unknown>)) {
      mergedEntries.set(key, value);
    }
    for (const [key, value] of Object.entries(localValue as Record<string, unknown>)) {
      mergedEntries.set(key, mergeValues(mergedEntries.get(key), value));
    }
    return Object.fromEntries(mergedEntries);
  }

  return localValue;
}

function validateKnownConfig(filename: string, filePath: string, value: unknown): void {
  const validator = validators[filename];
  if (!validator || value === undefined) {
    return;
  }

  const issues: ConfigValidationIssue[] = [];
  validator(value, issues);
  if (issues.length > 0) {
    throw new ConfigValidationError(filePath, issues);
  }
}

export function loadMergedYamlConfig<T extends object>(
  filename: string,
  options: ConfigLoadOptions = {},
): T {
  const cwd = options.cwd ?? process.cwd();
  const globalFile = path.join(getHomeConfigDir(options.homeDirectory), filename);
  const localFile = path.join(cwd, filename);
  const globalValue = readYamlFile<T>(globalFile) ?? ({} as T);
  const localValue = readYamlFile<T>(localFile) ?? ({} as T);
  validateKnownConfig(filename, globalFile, globalValue);
  validateKnownConfig(filename, localFile, localValue);

  return mergeValues(globalValue, localValue) as T;
}

export type KnownConfigFile =
  | DashboardConfigFile
  | WorkflowConfigFile
  | GatesConfigFile
  | JobsConfigFile;
