import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ToolCallPanel from "../components/ToolCallPanel.vue";
import ReasoningPanel from "../components/ReasoningPanel.vue";
import type { ToolStepDto } from "@ganglion/xacpx-relay-protocol";

const steps: ToolStepDto[] = [
  { toolCallId: "t1", toolName: "Bash", kind: "execute", status: "success", title: "npm test", durationMs: 400, detail: { type: "command", command: "npm test", output: "passed" } },
  { toolCallId: "t2", toolName: "Read", kind: "read", status: "running", title: "a.ts" },
];

describe("ToolCallPanel", () => {
  it("shows a count and one row per step", () => {
    const w = mount(ToolCallPanel, { props: { steps } });
    expect(w.find('[data-test="tool-count"]').text()).toContain("2");
    expect(w.findAll('[data-test="tool-row"]').length).toBe(2);
  });

  it("expands a row to show its detail on click", async () => {
    const w = mount(ToolCallPanel, { props: { steps } });
    expect(w.find('[data-test="cmd-output"]').exists()).toBe(false);
    await w.findAll('[data-test="tool-row"]')[0].trigger("click");
    expect(w.find('[data-test="cmd-output"]').text()).toContain("passed");
  });

  it("marks a running step distinctly from a successful one", () => {
    const w = mount(ToolCallPanel, { props: { steps } });
    const rows = w.findAll('[data-test="tool-row"]');
    expect(rows[0].text()).toContain("✅");
    expect(rows[1].text()).toContain("⏳");
  });
});

describe("ReasoningPanel", () => {
  it("renders reasoning text inside a collapsible", () => {
    const w = mount(ReasoningPanel, { props: { reasoning: "step by step" } });
    expect(w.text()).toContain("Reasoning");
    expect(w.find('[data-test="reasoning-body"]').text()).toContain("step by step");
  });
});
