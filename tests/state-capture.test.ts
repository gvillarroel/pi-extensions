import { describe, expect, it, vi } from "vitest";

import type { CommandDefinition, EventHandler, PiExtensionHost, ToolDefinition } from "../src/shared/types.js";
import registerStateCaptureReporter from "../extensions/state-capture-reporter.js";

function createMockHost() {
  const events = new Map<string, EventHandler>();
  const commands = new Map<string, CommandDefinition>();
  const tools = new Map<string, ToolDefinition>();

  const host: PiExtensionHost = {
    on(event: string, handler: EventHandler) {
      events.set(event, handler);
    },
    registerCommand(name: string, definition: CommandDefinition) {
      commands.set(name, definition);
    },
    registerTool(definition: ToolDefinition) {
      tools.set(definition.name, definition);
    },
  };

  return { host, events, commands, tools };
}

describe("state-capture-reporter", () => {
  it("registers handlers for all known lifecycle events", () => {
    const { host, events } = createMockHost();
    registerStateCaptureReporter(host);

    expect(events.size).toBeGreaterThan(20);
    expect(events.has("session_start")).toBe(true);
    expect(events.has("turn_start")).toBe(true);
    expect(events.has("tool_call")).toBe(true);
    expect(events.has("input")).toBe(true);
  });

  it("registers the /captured_states command", () => {
    const { host, commands } = createMockHost();
    registerStateCaptureReporter(host);

    expect(commands.has("captured_states")).toBe(true);
  });

  it("logs events when handlers fire and tracks them as observed", async () => {
    const { host, events, commands } = createMockHost();
    registerStateCaptureReporter(host);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // Fire a session_start event
      const sessionHandler = events.get("session_start");
      expect(sessionHandler).toBeDefined();
      sessionHandler!({ state: "ready" }, { hasUI: false } as any);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[state-capture] session_start"),
      );

      // Now check /captured_states reports it as observed
      consoleSpy.mockClear();
      const capturedStates = commands.get("captured_states");
      await capturedStates!.handler("", { hasUI: false } as any);

      const output = consoleSpy.mock.calls.map((args) => args.join(" ")).join("\n");
      expect(output).toContain("Registered events");
      expect(output).toContain("session_start");
      expect(output).toMatch(/Observed events \(\d+\).*session_start/);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("summarizes payloads with state extraction", () => {
    const { host, events } = createMockHost();
    registerStateCaptureReporter(host);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // Event with nested state
      events.get("model_select")!({ model: { name: "gpt-4" } }, { hasUI: false } as any);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("state=gpt-4"),
      );

      consoleSpy.mockClear();

      // Event with empty payload
      events.get("turn_start")!({}, { hasUI: false } as any);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("empty payload"),
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("sets UI status when context has UI", () => {
    const { host, events } = createMockHost();
    registerStateCaptureReporter(host);

    const setStatus = vi.fn();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      events.get("agent_start")!(
        { state: "running" },
        { hasUI: true, ui: { setStatus } } as any,
      );

      expect(setStatus).toHaveBeenCalledWith(
        "state-capture",
        expect.stringContaining("[state-capture] agent_start"),
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
