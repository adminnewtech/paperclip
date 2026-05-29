import { describe, it, expect } from "vitest";
import manifest from "./manifest.js";
import { PLUGIN_ID, TOOL_NAMES } from "./constants.js";

describe("business-agent-tools manifest", () => {
  it("has correct plugin ID", () => {
    expect(manifest.id).toBe(PLUGIN_ID);
  });

  it("declares all 5 tools", () => {
    const names = manifest.tools?.map((t) => t.name) ?? [];
    expect(names).toContain(TOOL_NAMES.businessQuery);
    expect(names).toContain(TOOL_NAMES.businessGet);
    expect(names).toContain(TOOL_NAMES.businessCreate);
    expect(names).toContain(TOOL_NAMES.businessUpdate);
    expect(names).toContain(TOOL_NAMES.businessSummary);
    expect(names.length).toBe(5);
  });

  it("requires agent.tools.register capability", () => {
    expect(manifest.capabilities).toContain("agent.tools.register");
  });

  it("requires http.outbound capability", () => {
    expect(manifest.capabilities).toContain("http.outbound");
  });

  it("businessQuery requires moduleKey and entityType", () => {
    const tool = manifest.tools?.find((t) => t.name === TOOL_NAMES.businessQuery);
    expect(tool?.parametersSchema?.required).toContain("moduleKey");
    expect(tool?.parametersSchema?.required).toContain("entityType");
  });
});
