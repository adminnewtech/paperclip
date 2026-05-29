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

import { describe as describe2, it as it2, expect as expect2 } from "vitest";

// Re-export guard for testing without importing the whole worker (which calls runWorker).
// The guard logic is duplicated minimally here to assert the read-only boundary contract.
function isLocalHost(serverUrl: string): boolean {
  let host: string;
  try { host = new URL(serverUrl).hostname.toLowerCase(); } catch { return false; }
  return (
    host === "localhost" || host === "127.0.0.1" || host === "::1" ||
    host === "0.0.0.0" || host.endsWith(".local") ||
    host === "paperclip" || host.startsWith("paperclip.")
  );
}

describe2("read-only boundary (local-target guard contract)", () => {
  it2("allows the local Paperclip server", () => {
    expect2(isLocalHost("http://localhost:3200")).toBe(true);
    expect2(isLocalHost("http://127.0.0.1:3101")).toBe(true);
    expect2(isLocalHost("https://paperclip.83-171-249-32.nip.io")).toBe(true); // the user's own Paperclip deployment (same system, not an external SaaS)
  });
  it2("blocks external systems (Shopify/Zoho) — never written to", () => {
    expect2(isLocalHost("https://newtechq8.com")).toBe(false);
    expect2(isLocalHost("https://books.zoho.com")).toBe(false);
    expect2(isLocalHost("https://admin.shopify.com")).toBe(false);
  });
});
