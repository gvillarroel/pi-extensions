import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigValidationError, loadMergedYamlConfig } from "../src/shared/config.js";
import { YamlFileError } from "../src/shared/yaml.js";
import { writeYamlFile } from "../src/shared/yaml.js";

describe("loadMergedYamlConfig", () => {
  it("deep merges global config with local overrides while replacing arrays", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-extensions-config-"));
    const homeDir = path.join(root, "home");
    const cwd = path.join(root, "repo");
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });

    writeYamlFile(path.join(homeDir, ".pi-extensions", "jobs.yaml"), {
      jobs: [{ id: "global-job", label: "Global", schedule: "0 0 * * *", target: { type: "script", run: "echo global" } }],
      defaults: {
        timeoutMs: 60_000,
        execution: {
          shell: "powershell",
          retries: 1,
        },
      },
    });
    writeYamlFile(path.join(cwd, "jobs.yaml"), {
      jobs: [{ id: "local-job", label: "Local", schedule: "0 1 * * *", target: { type: "script", run: "echo local" } }],
      defaults: {
        execution: {
          retries: 3,
        },
      },
    });

    const config = loadMergedYamlConfig<{
      jobs: Array<{ id: string }>;
      defaults: {
        timeoutMs: number;
        execution: {
          shell?: string;
          retries: number;
        };
      };
    }>("jobs.yaml", {
      cwd,
      homeDirectory: homeDir,
    });

    expect(config.jobs).toEqual([
      { id: "local-job", label: "Local", schedule: "0 1 * * *", target: { type: "script", run: "echo local" } },
    ]);
    expect(config.defaults).toEqual({
      timeoutMs: 60_000,
      execution: {
        shell: "powershell",
        retries: 3,
      },
    });
  });

  it("reports actionable schema errors with file path and field path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-extensions-config-invalid-"));
    const cwd = path.join(root, "repo");
    fs.mkdirSync(cwd, { recursive: true });

    writeYamlFile(path.join(cwd, "jobs.yaml"), {
      jobs: [
        {
          id: 123,
          schedule: 55,
          target: { type: "script" },
        },
      ],
    });

    expect(() => loadMergedYamlConfig("jobs.yaml", { cwd })).toThrowError(ConfigValidationError);
    expect(() => loadMergedYamlConfig("jobs.yaml", { cwd })).toThrowError(/jobs\[0\]\.id/);
    expect(() => loadMergedYamlConfig("jobs.yaml", { cwd })).toThrowError(/jobs\[0\]\.target\.run/);
  });

  it("reports YAML syntax errors with the source file path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-extensions-config-yaml-"));
    const cwd = path.join(root, "repo");
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(path.join(cwd, "dashboard.sources.yaml"), "sources:\n  - id: broken\n    type: github\n    [\n", "utf8");

    expect(() => loadMergedYamlConfig("dashboard.sources.yaml", { cwd })).toThrowError(YamlFileError);
    expect(() => loadMergedYamlConfig("dashboard.sources.yaml", { cwd })).toThrowError(/dashboard\.sources\.yaml/);
  });
});
