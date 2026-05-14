/**
 * Workspace Core — Slack-like collaborative workspace foundation.
 *
 * This file exposes a single {@link WorkspaceService} aggregate that wires
 * together channels, messages, members, read-state, and the real-time
 * stream. Future surfaces (P11-B AI members, P11-C smart cards, P11-D UI,
 * P11-E Hermes bridge) all consume the public methods on this aggregate.
 */

import type { Db } from "@paperclipai/db";
import type { BusinessStreamService } from "../business-stream-service.js";
import {
  createChannelsService,
  type ChannelsService,
} from "./channels-service.js";
import {
  createMembersService,
  type MembersService,
} from "./members-service.js";
import {
  createMessagesService,
  type MessagesService,
} from "./messages-service.js";
import {
  createReadStateService,
  type ReadStateService,
} from "./read-state-service.js";
import {
  createWorkspaceStreamService,
  type WorkspaceStreamService,
} from "./workspace-stream.js";
import { seedDefaultChannels, type SeedDefaultsResult } from "./default-channels.js";

export interface WorkspaceService {
  channels: ChannelsService;
  messages: MessagesService;
  members: MembersService;
  readState: ReadStateService;
  stream: WorkspaceStreamService;
  /** Seed the eight default channels + register AI agents for the company. */
  seedDefaults(
    companyId: string,
    creatorUserId?: string,
  ): Promise<SeedDefaultsResult>;
}

export function createWorkspaceService(
  db: Db,
  opts?: { businessStreamService?: BusinessStreamService },
): WorkspaceService {
  // The business stream service is optional for now — future cross-module
  // bridging (entity → workspace event) will reach for it via this handle.
  void opts;

  const stream = createWorkspaceStreamService();
  const channels = createChannelsService(db, stream);
  const members = createMembersService(db, stream);
  const messages = createMessagesService(db, stream, channels, members);
  const readState = createReadStateService(db, channels);

  return {
    channels,
    messages,
    members,
    readState,
    stream,
    async seedDefaults(companyId, creatorUserId) {
      return seedDefaultChannels(channels, members, companyId, creatorUserId);
    },
  };
}

export type {
  ChannelsService,
  MembersService,
  MessagesService,
  ReadStateService,
  WorkspaceStreamService,
};

export { seedDefaultChannels };
