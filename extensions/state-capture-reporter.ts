const EVENT_NAMES = [
  "resources_discover",
  "session_directory",
  "session_start",
  "session_before_switch",
  "session_switch",
  "session_before_fork",
  "session_fork",
  "session_before_compact",
  "session_compact",
  "session_shutdown",
  "session_before_tree",
  "session_tree",
  "context",
  "before_provider_request",
  "before_agent_start",
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "model_select",
  "tool_call",
  "tool_result",
  "user_bash",
  "input",
] as const;

type EventName = (typeof EVENT_NAMES)[number];
type UnknownPayload = Record<string, unknown>;

function asRecord(value: unknown): UnknownPayload | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as UnknownPayload;
}

function pickString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }

  const record = asRecord(value);
  if (!record) return undefined;

  for (const key of ["name", "stateName", "label", "id", "path", "reason", "type"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length) {
      return candidate.trim();
    }
  }

  return undefined;
}

function getCapturedStateName(payload: UnknownPayload | undefined): string | undefined {
  if (!payload) return undefined;

  for (const key of [
    "state",
    "snapshot",
    "result",
    "context",
    "metadata",
    "details",
    "preparation",
    "message",
    "model",
    "previousModel",
  ]) {
    const found = pickString(payload[key]);
    if (found) return found;
  }

  for (const key of [
    "state",
    "stateName",
    "state_name",
    "name",
    "label",
    "id",
    "path",
    "reason",
  ]) {
    const found = pickString(payload[key]);
    if (found) return found;
  }

  return undefined;
}

function summarizePayload(payload: UnknownPayload | undefined): string {
  if (!payload) return "no payload";

  const state = getCapturedStateName(payload);
  if (state) return `state=${state}`;

  const keys = Object.keys(payload);
  if (!keys.length) return "empty payload";
  return `keys=${keys.slice(0, 8).join(", ")}`;
}

function logEvent(eventName: string, payload: UnknownPayload | undefined, ctx: any) {
  const message = `[state-capture] ${eventName} | ${summarizePayload(payload)}`;
  console.log(message);
  if (ctx?.ui?.setStatus) ctx.ui.setStatus("state-capture", message);
}

function safeRegister(
  pi: any,
  eventName: EventName,
  onSeen: (eventName: EventName) => void,
) {
  pi.on(eventName, (event: unknown, ctx: unknown) => {
    onSeen(eventName);
    logEvent(eventName, asRecord(event), ctx);

    // Return values only matter for a subset of events.
    // `tool_call` -> { block?: boolean, reason?: string } blocks the tool when block=true.
    // `tool_result` -> { content?, details?, isError? } rewrites the delivered tool result.
    // `context` -> { messages? } replaces the messages sent to the model.
    // `before_provider_request` -> any non-undefined return replaces the provider payload.
    // `before_agent_start` -> { message?, systemPrompt? } injects a message and/or rewrites the system prompt.
    // `input` -> { action: "continue" | "transform" | "handled", ... } transforms or short-circuits input.
    // `resources_discover` -> { skillPaths?, promptPaths?, themePaths? } contributes extra resources.
    // `session_directory` -> { sessionDir? } overrides the session storage directory.
    // `session_before_switch` -> { cancel?: boolean } cancels session switch.
    // `session_before_fork` -> { cancel?: boolean, skipConversationRestore?: boolean } alters forking.
    // `session_before_compact` -> { cancel?: boolean, compaction?: CompactionResult } alters compaction.
    // `session_before_tree` -> { cancel?: boolean, summary?, customInstructions?, replaceInstructions?, label? } alters tree navigation.
    return undefined;
  });
}

export default function registerStateCaptureReporter(pi: any) {
  const registered = new Set<string>();
  const seen = new Set<string>();

  for (const eventName of EVENT_NAMES) {
    safeRegister(pi, eventName, (name) => seen.add(name));
    registered.add(eventName);
  }

  pi.registerCommand?.("captured_states", {
    description: "List supported events and the ones that were already observed",
    handler: async (_args: string, ctx: any) => {
      const message =
        `Registered events (${registered.size}): ${Array.from(registered).join(", ")}\n` +
        `Observed events (${seen.size}): ${Array.from(seen).join(", ") || "none"}`;

      if (ctx?.ui?.notify) ctx.ui.notify("Captured event report written to the console", "info");
      console.log(message);
    },
  });
}
