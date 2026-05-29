/**
 * Risk-tiered policy gate for agent business actions.
 *
 * Per the Business OS governance rule: money, deletion, customer-messaging,
 * and legal actions ALWAYS require human approval regardless of an agent's
 * autonomy level. The decision is driven by RISK TIER, not autonomy.
 *
 * This mirrors the `bos_agent_policy` table (action_key → rule). The plugin
 * enforces the gate at tool-call time; the host `approvals` system holds the
 * human-in-the-loop record.
 */

export type ActionKey = "money" | "delete" | "customer_message" | "legal" | "data";
export type PolicyRule = "allow" | "approve" | "deny";
export type RiskTier = "low" | "medium" | "high" | "critical";

export interface PolicyConfig {
  /** Master switch — gate finance/sales writes. */
  requireApprovalForFinance?: boolean;
  /** Approve money writes at or above this amount (minor units). 0 = always approve. */
  moneyApprovalThresholdMinor?: number;
  /** Require approval for any delete action. */
  requireApprovalForDeletes?: boolean;
}

export interface ProposedAction {
  /** Business module the action targets (finance, sales, crm, inventory, ...). */
  moduleKey: string;
  /** The operation being attempted. */
  operation: "create" | "update" | "delete";
  /** Monetary amount in minor units, if any. */
  amountMinor?: number | null;
}

export interface PolicyDecision {
  rule: PolicyRule;
  actionKey: ActionKey;
  tier: RiskTier;
  reason: string;
}

const MONEY_MODULES = new Set(["finance", "sales"]);

/** Map a proposed action to its governance action_key. */
export function actionKeyOf(action: ProposedAction): ActionKey {
  if (action.operation === "delete") return "delete";
  if (MONEY_MODULES.has(action.moduleKey)) return "money";
  return "data";
}

/** Classify the risk tier of a proposed action. */
export function riskOf(action: ProposedAction): RiskTier {
  if (action.operation === "delete") return "high";
  if (MONEY_MODULES.has(action.moduleKey)) {
    const amount = action.amountMinor ?? 0;
    if (amount >= 100_000) return "critical"; // >= 100 major units (e.g. 100 KWD)
    if (amount > 0) return "high";
    return "medium";
  }
  return "low";
}

/**
 * Evaluate the policy gate for a proposed action.
 * Returns the rule the host should enforce (allow | approve | deny).
 */
export function evaluatePolicy(
  action: ProposedAction,
  config: PolicyConfig,
): PolicyDecision {
  const actionKey = actionKeyOf(action);
  const tier = riskOf(action);

  if (actionKey === "delete") {
    const rule: PolicyRule = config.requireApprovalForDeletes === false ? "allow" : "approve";
    return { rule, actionKey, tier, reason: "Deletion is a high-risk action." };
  }

  if (actionKey === "money") {
    if (config.requireApprovalForFinance === false) {
      return { rule: "allow", actionKey, tier, reason: "Finance approval disabled by config." };
    }
    const threshold = config.moneyApprovalThresholdMinor ?? 0;
    const amount = action.amountMinor ?? 0;
    if (amount >= threshold) {
      return {
        rule: "approve",
        actionKey,
        tier,
        reason: `Money write (${amount} minor units) at/above approval threshold (${threshold}).`,
      };
    }
    return { rule: "allow", actionKey, tier, reason: "Money write below approval threshold." };
  }

  // data / low-risk → allowed
  return { rule: "allow", actionKey, tier, reason: "Low-risk data action." };
}
