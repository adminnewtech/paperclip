/**
 * Learning engine — derives biases and accuracy metrics from recorded agent
 * actions, and exposes pure-ish helpers that the memory service / routes
 * can reuse.
 *
 * The actual heavy aggregation lives in `./index.ts`. This module wraps it
 * with a slimmer interface that maps cleanly onto consumer call sites (e.g.,
 * the `business-agents-service` that wants to know "should I run this
 * capability?").
 */

import type {
  AgentMemoryBias,
  AgentMemoryService,
  AgentSkillStats,
} from "./index.js";

export interface LearningEngine {
  computeBiases(
    companyId: string,
    agentSlug: string,
    capability?: string,
  ): Promise<AgentMemoryBias[]>;
  computeAccuracy(
    companyId: string,
    agentSlug: string,
    capability: string,
    lookbackDays?: number,
  ): Promise<number>;
  computeTrend(
    history: Array<{ date: string; accuracy: number }>,
  ): "rising" | "stable" | "falling";
  shouldSuppress(
    companyId: string,
    agentSlug: string,
    capability: string,
  ): Promise<{ suppress: boolean; reason?: string; strength?: number }>;
  shouldBoost(
    companyId: string,
    agentSlug: string,
    capability: string,
  ): Promise<{ boost: boolean; reason?: string; strength?: number }>;
}

export function createLearningEngine(memory: AgentMemoryService): LearningEngine {
  async function computeBiases(
    companyId: string,
    agentSlug: string,
    capability?: string,
  ): Promise<AgentMemoryBias[]> {
    const all = await memory.getBiases(companyId, agentSlug);
    if (!capability) return all;
    return all.filter((b) => b.capability === capability);
  }

  async function computeAccuracy(
    companyId: string,
    agentSlug: string,
    capability: string,
    lookbackDays?: number,
  ): Promise<number> {
    const stats: AgentSkillStats[] = await memory.getSkillStats(companyId, agentSlug, {
      lookbackDays,
    });
    const match = stats.find((s) => s.capability === capability);
    return match ? match.accuracy : 0.5;
  }

  function computeTrend(
    history: Array<{ date: string; accuracy: number }>,
  ): "rising" | "stable" | "falling" {
    if (history.length < 4) return "stable";
    const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
    const half = Math.floor(sorted.length / 2);
    const earlier = sorted.slice(0, half);
    const later = sorted.slice(half);
    const avg = (xs: Array<{ accuracy: number }>) =>
      xs.length === 0 ? 0.5 : xs.reduce((s, x) => s + x.accuracy, 0) / xs.length;
    const delta = avg(later) - avg(earlier);
    if (delta > 0.05) return "rising";
    if (delta < -0.05) return "falling";
    return "stable";
  }

  async function shouldSuppress(
    companyId: string,
    agentSlug: string,
    capability: string,
  ): Promise<{ suppress: boolean; reason?: string; strength?: number }> {
    const biases = await computeBiases(companyId, agentSlug, capability);
    const b = biases.find((x) => x.rule === "suppress");
    if (b) return { suppress: true, reason: b.reason, strength: b.strength };
    return { suppress: false };
  }

  async function shouldBoost(
    companyId: string,
    agentSlug: string,
    capability: string,
  ): Promise<{ boost: boolean; reason?: string; strength?: number }> {
    const biases = await computeBiases(companyId, agentSlug, capability);
    const b = biases.find((x) => x.rule === "boost");
    if (b) return { boost: true, reason: b.reason, strength: b.strength };
    return { boost: false };
  }

  return {
    computeBiases,
    computeAccuracy,
    computeTrend,
    shouldSuppress,
    shouldBoost,
  };
}
