/**
 * Skill evaluator — per-agent / per-skill performance metrics for dashboards
 * and leaderboards. Thin convenience wrapper over the memory service.
 */

import type { AgentMemoryService, AgentSkillStats } from "./index.js";

export interface SkillEvaluator {
  evaluateAgent(
    companyId: string,
    agentSlug: string,
    opts?: { lookbackDays?: number },
  ): Promise<{
    overallAccuracy: number;
    bySkill: AgentSkillStats[];
  }>;
  rankAgentsByAccuracy(
    companyId: string,
  ): Promise<Array<{ agentSlug: string; accuracy: number; actionCount: number }>>;
  accuracyTimeSeries(
    companyId: string,
    agentSlug: string,
    days: number,
  ): Promise<Array<{ date: string; accuracy: number; actionCount: number }>>;
  compareMonthOverMonth(
    companyId: string,
    agentSlug: string,
  ): Promise<{
    currentMonth: { month: string; accuracy: number; actionCount: number } | null;
    previousMonth: { month: string; accuracy: number; actionCount: number } | null;
    delta: number;
  }>;
}

export function createSkillEvaluator(memory: AgentMemoryService): SkillEvaluator {
  async function evaluateAgent(
    companyId: string,
    agentSlug: string,
    opts: { lookbackDays?: number } = {},
  ) {
    const stats = await memory.getAgentStats(companyId, agentSlug, opts);
    return {
      overallAccuracy: stats.overallAccuracy,
      bySkill: stats.bySkill,
    };
  }

  async function compareMonthOverMonth(companyId: string, agentSlug: string) {
    const stats = await memory.getAgentStats(companyId, agentSlug);
    const m = stats.monthlyAccuracy;
    const currentMonth = m.length > 0 ? m[m.length - 1]! : null;
    const previousMonth = m.length > 1 ? m[m.length - 2]! : null;
    const delta =
      currentMonth && previousMonth
        ? currentMonth.accuracy - previousMonth.accuracy
        : 0;
    return { currentMonth, previousMonth, delta };
  }

  return {
    evaluateAgent,
    rankAgentsByAccuracy: (companyId: string) => memory.rankAgentsByAccuracy(companyId),
    accuracyTimeSeries: (companyId: string, agentSlug: string, days: number) =>
      memory.accuracyTimeSeries(companyId, agentSlug, days),
    compareMonthOverMonth,
  };
}
