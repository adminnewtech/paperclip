/**
 * Tests for the storefront-builder service (mock/fallback path).
 *
 * The service is meant to call out to an LLM to produce a storefront plan,
 * but when no `ANTHROPIC_API_KEY` is configured it falls back to a set of
 * deterministic industry templates. Those templates are what's tested here.
 *
 * We pass a stub `db` because `generatePlan` does NOT touch the database;
 * persistence (`applyPlan`) is a separate method covered by route-level
 * integration tests.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import { createStorefrontBuilderService } from "../storefront-builder-service.js";

const fakeDb = {} as unknown as Db;

describe("storefront-builder-service: generatePlan (mock fallback)", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns a complete plan structure for a generic description", async () => {
    const svc = createStorefrontBuilderService(fakeDb);
    const plan = await svc.generatePlan({
      description: "A small online shop",
    });
    expect(plan.mock).toBe(true);
    expect(plan.storefront.name.length).toBeGreaterThan(0);
    expect(plan.storefront.nameAr.length).toBeGreaterThan(0);
    expect(plan.storefront.currency).toBe("KWD");
    expect(plan.storefront.countryCode).toBe("KW");
    expect(plan.products.length).toBeGreaterThanOrEqual(8);
    expect(plan.categories.length).toBeGreaterThan(0);
    expect(plan.shippingZones.length).toBeGreaterThan(0);
    expect(plan.paymentMethods.length).toBeGreaterThan(0);
  });

  it("detects perfume industry from Arabic 'عود' keyword", async () => {
    const svc = createStorefrontBuilderService(fakeDb);
    const plan = await svc.generatePlan({
      description: "متجر عود وعطور فاخرة",
    });
    expect(plan.industry).toBe("perfume");
  });

  it("detects perfume from English 'oud' keyword", async () => {
    const svc = createStorefrontBuilderService(fakeDb);
    const plan = await svc.generatePlan({ description: "luxury oud shop" });
    expect(plan.industry).toBe("perfume");
  });

  it("detects clothing industry", async () => {
    const svc = createStorefrontBuilderService(fakeDb);
    const plan = await svc.generatePlan({
      description: "fashion abaya store",
    });
    expect(plan.industry).toBe("clothing");
  });

  it("falls back to default industry for unrecognised description", async () => {
    const svc = createStorefrontBuilderService(fakeDb);
    const plan = await svc.generatePlan({
      description: "we sell widgets and stuff",
    });
    expect(plan.industry).toBe("default");
  });

  it("uses the target country to choose currency", async () => {
    const svc = createStorefrontBuilderService(fakeDb);
    const planSa = await svc.generatePlan({
      description: "perfume shop",
      targetCountry: "SA",
    });
    expect(planSa.storefront.countryCode).toBe("SA");
    expect(planSa.storefront.currency).toBe("SAR");
  });

  it("defaults to Kuwait when target country is invalid", async () => {
    const svc = createStorefrontBuilderService(fakeDb);
    const plan = await svc.generatePlan({
      description: "shop",
      targetCountry: "ZZ",
    });
    expect(plan.storefront.countryCode).toBe("KW");
  });

  it("scales prices for 'lean' budget tier", async () => {
    const svc = createStorefrontBuilderService(fakeDb);
    const planStd = await svc.generatePlan({ description: "perfume" });
    const planLean = await svc.generatePlan({
      description: "perfume",
      budget: "lean",
    });
    const stdPrice = planStd.products[0]!.priceCents;
    const leanPrice = planLean.products[0]!.priceCents;
    expect(leanPrice).toBeLessThan(stdPrice);
  });

  it("scales prices for 'premium' budget tier", async () => {
    const svc = createStorefrontBuilderService(fakeDb);
    const planStd = await svc.generatePlan({ description: "perfume" });
    const planPremium = await svc.generatePlan({
      description: "perfume",
      budget: "premium",
    });
    expect(planPremium.products[0]!.priceCents).toBeGreaterThan(
      planStd.products[0]!.priceCents,
    );
  });

  it("every product has a valid uppercase-alphanumeric SKU", async () => {
    const svc = createStorefrontBuilderService(fakeDb);
    const plan = await svc.generatePlan({ description: "perfume" });
    for (const p of plan.products) {
      expect(p.sku).toMatch(/^[A-Z0-9-]+$/);
    }
  });

  it("KWD prices fit in fils precision (integer cents)", async () => {
    const svc = createStorefrontBuilderService(fakeDb);
    const plan = await svc.generatePlan({ description: "perfume" });
    for (const p of plan.products) {
      expect(Number.isInteger(p.priceCents)).toBe(true);
      expect(p.priceCents).toBeGreaterThan(0);
    }
  });

  it("ships locally + regionally with two zones for KW", async () => {
    const svc = createStorefrontBuilderService(fakeDb);
    const plan = await svc.generatePlan({ description: "perfume" });
    expect(plan.shippingZones).toHaveLength(2);
    expect(plan.shippingZones[0]!.countries).toContain("KW");
  });

  it("supports all 6 templated industries", async () => {
    const svc = createStorefrontBuilderService(fakeDb);
    const inputs: { description: string; expected: string }[] = [
      { description: "oud shop", expected: "perfume" },
      { description: "fashion store", expected: "clothing" },
      { description: "phone tech store", expected: "electronics" },
      { description: "restaurant", expected: "restaurant" },
      { description: "beauty spa", expected: "beauty" },
      { description: "jewelry gold", expected: "jewelry" },
    ];
    for (const i of inputs) {
      const plan = await svc.generatePlan({ description: i.description });
      expect(plan.industry).toBe(i.expected);
    }
  });
});
