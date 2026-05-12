import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import {
  createStorefrontBuilderService,
  type StorefrontPlan,
} from "../services/storefront-builder-service.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const builderInputSchema = z.object({
  description: z.string().trim().min(3).max(4000),
  industry: z.string().trim().max(120).optional(),
  targetCountry: z.string().trim().length(2).optional(),
  budget: z.enum(["lean", "standard", "premium"]).optional(),
  lang: z.enum(["ar", "en"]).optional(),
});

const planSchema: z.ZodType<StorefrontPlan> = z.object({
  storefront: z.object({
    name: z.string().min(1),
    nameAr: z.string(),
    tagline: z.string(),
    taglineAr: z.string(),
    description: z.string(),
    descriptionAr: z.string(),
    suggestedDomain: z.string(),
    brandColors: z.object({
      primary: z.string(),
      secondary: z.string(),
      accent: z.string(),
    }),
    theme: z.enum(["minimal", "classic", "modern", "luxury", "bold"]),
    currency: z.enum(["KWD", "SAR", "AED", "QAR", "BHD", "OMR"]),
    countryCode: z.string(),
    aboutContent: z.string(),
    aboutContentAr: z.string(),
  }),
  products: z
    .array(
      z.object({
        name: z.string(),
        nameAr: z.string(),
        description: z.string(),
        descriptionAr: z.string(),
        sku: z.string(),
        priceCents: z.number().int().nonnegative(),
        costCents: z.number().int().nonnegative(),
        category: z.string(),
        tags: z.array(z.string()),
        initialStock: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(50),
  categories: z
    .array(
      z.object({
        name: z.string(),
        nameAr: z.string(),
        slug: z.string(),
      }),
    )
    .min(1)
    .max(20),
  discounts: z
    .array(
      z.object({
        code: z.string(),
        type: z.enum(["percentage", "fixed"]),
        value: z.number(),
        description: z.string(),
        descriptionAr: z.string(),
        usageLimit: z.number().int().optional(),
        expiresInDays: z.number().int().optional(),
      }),
    )
    .max(20),
  campaigns: z
    .array(
      z.object({
        name: z.string(),
        nameAr: z.string(),
        channel: z.enum(["email", "sms", "social", "ads"]),
        description: z.string(),
        budgetCents: z.number().int().nonnegative(),
      }),
    )
    .max(20),
  shippingZones: z
    .array(
      z.object({
        name: z.string(),
        countries: z.array(z.string()),
        flatRateCents: z.number().int().nonnegative(),
        freeShippingMinCents: z.number().int().nonnegative().optional(),
      }),
    )
    .max(20),
  paymentMethods: z.array(z.string()).max(20),
  mock: z.boolean().optional(),
  industry: z.string().optional(),
});

const applySchema = z.object({
  plan: planSchema,
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function storefrontBuilderRoutes(db: Db) {
  const router = Router();
  const service = createStorefrontBuilderService(db);

  // 1. Generate plan only (no DB writes)
  router.post(
    "/companies/:companyId/business/storefront-builder/generate",
    validate(builderInputSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const input = req.body as z.infer<typeof builderInputSchema>;
      const plan = await service.generatePlan(input);
      res.json({ plan });
    },
  );

  // 2. Apply existing plan to DB
  router.post(
    "/companies/:companyId/business/storefront-builder/apply",
    validate(applySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const { plan } = req.body as z.infer<typeof applySchema>;
      const result = await service.applyPlan(
        companyId,
        plan,
        actor.actorId ?? null,
      );
      res.status(201).json({ result });
    },
  );

  // 3. Generate + apply in one step
  router.post(
    "/companies/:companyId/business/storefront-builder/generate-and-apply",
    validate(builderInputSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const input = req.body as z.infer<typeof builderInputSchema>;
      const { plan, result } = await service.generateAndApply(
        companyId,
        input,
        actor.actorId ?? null,
      );
      res.status(201).json({ plan, result });
    },
  );

  return router;
}
