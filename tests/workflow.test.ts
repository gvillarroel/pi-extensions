import { describe, expect, it } from "vitest";

import { executeWorkflow } from "../src/shared/workflow.js";

describe("executeWorkflow", () => {
  it("fails when a required field gate is missing", async () => {
    const result = await executeWorkflow(
      {
        id: "needs-item",
        label: "Needs Item",
        gates: [{ requiredContextFields: ["item.id"] }],
        steps: [{ id: "step-1", type: "note", message: "hello" }],
      },
      {},
    );

    expect(result.status).toBe("failed");
    expect(result.errorSummary).toContain("Missing required context field");
  });

  it("runs note, script, and parallel steps", async () => {
    const result = await executeWorkflow(
      {
        id: "full-workflow",
        label: "Full Workflow",
        steps: [
          { id: "note-1", type: "note", message: "Review {{item.id}}" },
          { id: "script-1", type: "script", run: "echo ready" },
          {
            id: "parallel-1",
            type: "parallel",
            steps: [
              { id: "child-a", type: "note", message: "child a" },
              { id: "child-b", type: "script", run: "echo child-b" },
            ],
          },
        ],
      },
      { item: { id: "123" } },
    );

    expect(result.status).toBe("passed");
    expect(result.stepResults).toHaveLength(3);
    expect(result.artifacts.some((artifact) => artifact.content.includes("Review 123"))).toBe(true);
  });
});
