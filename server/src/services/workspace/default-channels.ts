/**
 * Seed eight default channels every company gets, plus register the five
 * core AI agents as workspace members and auto-join them to relevant
 * channels.
 *
 * Idempotent: re-running this function never produces duplicates.
 */

import {
  BUSINESS_AGENTS,
  type WorkspaceChannel,
  type ChannelKind,
} from "@paperclipai/shared";
import type { ChannelsService } from "./channels-service.js";
import type { MembersService } from "./members-service.js";

interface SeedChannel {
  slug: string;
  name: string;
  nameAr: string;
  description?: string;
  kind: ChannelKind;
  defaultMembers: boolean;
  /** Optional system status (e.g. `read_only`) — stored in description. */
  readOnly?: boolean;
}

const DEFAULT_CHANNELS: SeedChannel[] = [
  {
    slug: "general",
    name: "General",
    nameAr: "العام",
    description: "Company-wide chat — say hello here.",
    kind: "public",
    defaultMembers: true,
  },
  {
    slug: "announcements",
    name: "Announcements",
    nameAr: "الإعلانات",
    description: "Read-only feed for leadership announcements.",
    kind: "public",
    defaultMembers: true,
    readOnly: true,
  },
  {
    slug: "sales",
    name: "Sales",
    nameAr: "المبيعات",
    description: "Pipeline, deals, and revenue.",
    kind: "public",
    defaultMembers: true,
  },
  {
    slug: "finance",
    name: "Finance",
    nameAr: "المالية",
    description: "Accounting, expenses, VAT, and reporting.",
    kind: "public",
    defaultMembers: true,
  },
  {
    slug: "support",
    name: "Support",
    nameAr: "الدعم",
    description: "Customer support tickets and escalations.",
    kind: "public",
    defaultMembers: true,
  },
  {
    slug: "operations",
    name: "Operations",
    nameAr: "العمليات",
    description: "Inventory, fulfilment, logistics.",
    kind: "public",
    defaultMembers: true,
  },
  {
    slug: "ai-team",
    name: "AI Team",
    nameAr: "فريق الذكاء",
    description: "Coordination channel for the AI workforce.",
    kind: "public",
    defaultMembers: true,
  },
  {
    slug: "leadership",
    name: "Leadership",
    nameAr: "القيادة",
    description: "Private channel for company admins.",
    kind: "private",
    defaultMembers: false,
  },
];

/** Map each agent slug to its primary domain channel(s). */
const AGENT_CHANNEL_ASSIGNMENTS: Record<string, string[]> = {
  // Sara
  accountant: ["general", "ai-team", "finance"],
  // Khaled
  sales: ["general", "ai-team", "sales"],
  // Layla
  customer_service: ["general", "ai-team", "support"],
  // Omar
  inventory: ["general", "ai-team", "operations"],
  // Mariam
  marketing: ["general", "ai-team", "sales"],
};

export interface SeedDefaultsResult {
  channels: WorkspaceChannel[];
  /** Newly created (existing channels skipped). */
  createdSlugs: string[];
}

export async function seedDefaultChannels(
  channels: ChannelsService,
  members: MembersService,
  companyId: string,
  creatorUserId?: string,
): Promise<SeedDefaultsResult> {
  const result: WorkspaceChannel[] = [];
  const createdSlugs: string[] = [];

  // 1. Channels
  for (const seed of DEFAULT_CHANNELS) {
    const existing = await channels.getBySlug(companyId, seed.slug);
    if (existing) {
      result.push(existing);
      continue;
    }
    const description = seed.readOnly
      ? `${seed.description ?? ""} (read-only)`.trim()
      : seed.description;
    const created = await channels.create(companyId, {
      slug: seed.slug,
      name: seed.name,
      nameAr: seed.nameAr,
      description,
      kind: seed.kind,
      defaultMembers: seed.defaultMembers,
      createdBy: creatorUserId,
      memberIds:
        seed.kind === "private" && creatorUserId ? [creatorUserId] : [],
    });
    result.push(created);
    createdSlugs.push(seed.slug);
  }

  // 2. AI agents as workspace members
  for (const agent of BUSINESS_AGENTS) {
    await members.registerAgent(companyId, agent.slug, {
      displayName: agent.personaName,
      displayNameAr: agent.personaNameAr,
      avatar: agent.emoji,
      title: agent.title,
      titleAr: agent.titleAr,
    });
  }

  // 3. Auto-join each agent to its assigned channels.
  for (const agent of BUSINESS_AGENTS) {
    const memberId = `agent:${agent.slug}`;
    const slugs =
      AGENT_CHANNEL_ASSIGNMENTS[agent.slug] ?? ["general", "ai-team"];
    for (const slug of slugs) {
      const channel = await channels.getBySlug(companyId, slug);
      if (!channel) continue;
      await channels.addMember(companyId, channel.id, memberId);
    }
  }

  return { channels: result, createdSlugs };
}
