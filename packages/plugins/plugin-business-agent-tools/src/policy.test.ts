import { describe, it, expect } from "vitest";
import { evaluatePolicy, actionKeyOf, riskOf, type PolicyConfig } from "./policy.js";

const DEFAULT: PolicyConfig = {
  requireApprovalForFinance: true,
  moneyApprovalThresholdMinor: 0,
  requireApprovalForDeletes: true,
};

describe("policy gate", () => {
  it("classifies money writes (finance/sales) as 'money'", () => {
    expect(actionKeyOf({ moduleKey: "finance", operation: "create" })).toBe("money");
    expect(actionKeyOf({ moduleKey: "sales", operation: "update" })).toBe("money");
  });

  it("classifies deletes as 'delete'", () => {
    expect(actionKeyOf({ moduleKey: "crm", operation: "delete" })).toBe("delete");
  });

  it("classifies non-money writes as 'data'", () => {
    expect(actionKeyOf({ moduleKey: "crm", operation: "create" })).toBe("data");
  });

  it("requires approval for any finance write by default (threshold 0)", () => {
    const d = evaluatePolicy({ moduleKey: "finance", operation: "create", amountMinor: 1000 }, DEFAULT);
    expect(d.rule).toBe("approve");
    expect(d.actionKey).toBe("money");
  });

  it("requires approval for deletes by default", () => {
    const d = evaluatePolicy({ moduleKey: "crm", operation: "delete" }, DEFAULT);
    expect(d.rule).toBe("approve");
    expect(d.tier).toBe("high");
  });

  it("allows low-risk data writes without approval", () => {
    const d = evaluatePolicy({ moduleKey: "crm", operation: "create" }, DEFAULT);
    expect(d.rule).toBe("allow");
    expect(d.tier).toBe("low");
  });

  it("flags large money writes as critical", () => {
    expect(riskOf({ moduleKey: "sales", operation: "create", amountMinor: 200_000 })).toBe("critical");
  });

  it("respects disabled finance approval", () => {
    const d = evaluatePolicy(
      { moduleKey: "finance", operation: "create", amountMinor: 5000 },
      { ...DEFAULT, requireApprovalForFinance: false },
    );
    expect(d.rule).toBe("allow");
  });

  it("allows deletes when delete-approval disabled", () => {
    const d = evaluatePolicy(
      { moduleKey: "crm", operation: "delete" },
      { ...DEFAULT, requireApprovalForDeletes: false },
    );
    expect(d.rule).toBe("allow");
  });
});
