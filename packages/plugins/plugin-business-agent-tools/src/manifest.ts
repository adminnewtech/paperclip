import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { PLUGIN_ID, PLUGIN_VERSION, TOOL_NAMES } from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Business Agent Tools",
  description:
    "Gives AI agents read/write access to Business Management modules (CRM, Sales, Inventory, Finance). Approval gates protect financial writes.",
  author: "NewTech Kuwait",
  categories: ["automation", "connector"],
  capabilities: [
    "http.outbound",
    "agent.tools.register",
    "events.subscribe",
    "issues.create",
    "issues.read",
    "agents.read",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    properties: {
      serverUrl: {
        type: "string",
        title: "Server URL",
        default: "http://localhost:3200",
        description: "Base URL of the Paperclip server hosting the Business API.",
      },
      requireApprovalForFinance: {
        type: "boolean",
        title: "Require Approval for Finance Writes",
        default: true,
        description: "When enabled, write operations against finance and sales modules create an approval issue instead of executing immediately.",
      },
    },
  },
  tools: [
    {
      name: TOOL_NAMES.businessQuery,
      displayName: "Business Query",
      description:
        "List entities from a Business Management module. Returns a filtered list of records (contacts, deals, invoices, inventory items, etc.).",
      parametersSchema: {
        type: "object",
        properties: {
          moduleKey: {
            type: "string",
            enum: [
              "crm",
              "sales",
              "inventory",
              "finance",
              "purchasing",
              "hr",
              "projects",
              "support",
            ],
            description: "The Business Management module to query.",
          },
          entityType: {
            type: "string",
            description: "The entity type within the module (e.g. 'contact', 'deal', 'invoice', 'product').",
          },
          status: {
            type: "string",
            description: "Optional filter by status (e.g. 'active', 'pending', 'closed').",
          },
          search: {
            type: "string",
            description: "Optional search/filter term applied against the entity name or code.",
          },
          limit: {
            type: "number",
            description: "Maximum number of records to return. Defaults to 50, max 200.",
          },
        },
        required: ["moduleKey", "entityType"],
      },
    },
    {
      name: TOOL_NAMES.businessGet,
      displayName: "Business Get",
      description:
        "Retrieve a single entity from a Business Management module by ID or code.",
      parametersSchema: {
        type: "object",
        properties: {
          moduleKey: {
            type: "string",
            enum: [
              "crm",
              "sales",
              "inventory",
              "finance",
              "purchasing",
              "hr",
              "projects",
              "support",
            ],
            description: "The Business Management module.",
          },
          entityType: {
            type: "string",
            description: "The entity type within the module.",
          },
          id: {
            type: "string",
            description: "Entity UUID. Provide either id or code.",
          },
          code: {
            type: "string",
            description: "Entity short code (e.g. 'INV-0042'). Provide either id or code.",
          },
        },
        required: ["moduleKey", "entityType"],
      },
    },
    {
      name: TOOL_NAMES.businessCreate,
      displayName: "Business Create",
      description:
        "Create a new entity in a Business Management module. Finance and sales writes may require approval when the plugin is configured with requireApprovalForFinance=true.",
      parametersSchema: {
        type: "object",
        properties: {
          moduleKey: {
            type: "string",
            enum: [
              "crm",
              "sales",
              "inventory",
              "finance",
              "purchasing",
              "hr",
              "projects",
              "support",
            ],
            description: "The Business Management module.",
          },
          entityType: {
            type: "string",
            description: "The entity type to create.",
          },
          name: {
            type: "string",
            description: "Human-readable name for the entity.",
          },
          status: {
            type: "string",
            description: "Initial status of the entity.",
          },
          amountCents: {
            type: "number",
            description: "Monetary amount in cents (for financial entities like invoices or orders).",
          },
          currency: {
            type: "string",
            description: "ISO 4217 currency code (e.g. 'USD', 'KWD').",
          },
          data: {
            type: "object",
            description: "Additional arbitrary structured data for the entity.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Optional list of tags to attach to the entity.",
          },
        },
        required: ["moduleKey", "entityType", "name"],
      },
    },
    {
      name: TOOL_NAMES.businessUpdate,
      displayName: "Business Update",
      description:
        "Update an existing entity in a Business Management module. Finance and sales writes may require approval when requireApprovalForFinance=true.",
      parametersSchema: {
        type: "object",
        properties: {
          moduleKey: {
            type: "string",
            enum: [
              "crm",
              "sales",
              "inventory",
              "finance",
              "purchasing",
              "hr",
              "projects",
              "support",
            ],
            description: "The Business Management module.",
          },
          entityType: {
            type: "string",
            description: "The entity type to update.",
          },
          id: {
            type: "string",
            description: "UUID of the entity to update.",
          },
          name: {
            type: "string",
            description: "New name for the entity.",
          },
          status: {
            type: "string",
            description: "New status for the entity.",
          },
          amountCents: {
            type: "number",
            description: "New monetary amount in cents.",
          },
          currency: {
            type: "string",
            description: "New ISO 4217 currency code.",
          },
          data: {
            type: "object",
            description: "Partial data patch to merge into the entity's data field.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Replacement tag list.",
          },
        },
        required: ["moduleKey", "entityType", "id"],
      },
    },
    {
      name: TOOL_NAMES.businessSummary,
      displayName: "Business Summary",
      description:
        "Return aggregate entity counts per Business Management module for the current company. Useful for understanding the state of the business at a glance.",
      parametersSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
};

export default manifest;
