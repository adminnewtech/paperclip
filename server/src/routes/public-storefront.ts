import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { createStorefrontPublicService } from "../services/storefront-public-service.js";

// ---------------------------------------------------------------------------
// Lightweight in-memory rate limiter — 60 reqs/minute per IP+route group.
// This is intentionally simple and process-local; behind a load balancer this
// becomes a per-instance budget, which is acceptable for a coarse spam guard.
// ---------------------------------------------------------------------------

interface RateBucket {
  count: number;
  resetAt: number;
}

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 60;
const RATE_MAX_PER_WINDOW_WRITES = 12;

function makeRateLimiter(maxPerWindow: number): RequestHandler {
  const buckets = new Map<string, RateBucket>();
  return (req, res, next) => {
    const ip = (req.ip || req.socket.remoteAddress || "unknown").toString();
    const key = `${ip}:${req.baseUrl}:${req.path}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > maxPerWindow) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    next();
  };
}

// Best-effort eviction so the bucket map doesn't grow without bound.
const readLimiter = makeRateLimiter(RATE_MAX_PER_WINDOW);
const writeLimiter = makeRateLimiter(RATE_MAX_PER_WINDOW_WRITES);

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const checkDiscountSchema = z.object({
  code: z.string().trim().min(1).max(64),
  subtotalCents: z.number().int().nonnegative().max(1_000_000_000),
});

const placeOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.string().trim().email().max(200),
  customerPhone: z.string().trim().min(3).max(40),
  shippingAddress: z.object({
    line1: z.string().trim().max(200).optional(),
    line2: z.string().trim().max(200).optional(),
    block: z.string().trim().max(40).optional(),
    street: z.string().trim().max(60).optional(),
    avenue: z.string().trim().max(60).optional(),
    building: z.string().trim().max(60).optional(),
    floor: z.string().trim().max(20).optional(),
    apartment: z.string().trim().max(20).optional(),
    city: z.string().trim().max(60).optional(),
    area: z.string().trim().max(60).optional(),
    country: z.string().trim().length(2),
    postalCode: z.string().trim().max(20).optional(),
  }),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: z.number().int().positive().max(999),
      }),
    )
    .min(1)
    .max(50),
  discountCode: z.string().trim().max(64).nullable().optional(),
  paymentMethod: z.string().trim().min(1).max(40),
  notes: z.string().trim().max(2000).optional(),
  lang: z.enum(["ar", "en"]).optional(),
});

const customerLookupSchema = z
  .object({
    email: z.string().trim().email().max(200).optional(),
    phone: z.string().trim().min(3).max(40).optional(),
  })
  .refine((v) => Boolean(v.email || v.phone), {
    message: "email or phone required",
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send404(res: Response, msg = "Storefront not found"): void {
  res.status(404).json({ error: msg });
}

function getSlugParam(req: Request): string | null {
  const raw = req.params.slug;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  // Conservative slug validation — letters, numbers, hyphens, underscores
  if (!/^[a-z0-9_-]{1,80}$/.test(trimmed)) return null;
  return trimmed;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function publicStorefrontRoutes(db: Db): Router {
  const router = Router();
  const service = createStorefrontPublicService(db);

  router.use(readLimiter);

  // GET storefront info by slug
  router.get("/storefronts/:slug", async (req, res) => {
    const slug = getSlugParam(req);
    if (!slug) return send404(res);
    const result = await service.getStorefrontBySlug(slug);
    if (!result) return send404(res);
    res.json({ storefront: result.storefront });
  });

  // GET categories
  router.get("/storefronts/:slug/categories", async (req, res) => {
    const slug = getSlugParam(req);
    if (!slug) return send404(res);
    const categories = await service.listCategories(slug);
    if (!categories) return send404(res);
    res.json({ categories });
  });

  // GET products
  router.get("/storefronts/:slug/products", async (req, res) => {
    const slug = getSlugParam(req);
    if (!slug) return send404(res);
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const sort =
      req.query.sort === "price_asc" ||
      req.query.sort === "price_desc" ||
      req.query.sort === "name" ||
      req.query.sort === "newest"
        ? req.query.sort
        : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;

    const result = await service.listProducts({ slug, q, category, sort, limit, offset });
    if (!result) return send404(res);
    res.json({
      storefront: result.storefront,
      products: result.products,
      total: result.total,
    });
  });

  // GET single product
  router.get("/storefronts/:slug/products/:productSlug", async (req, res) => {
    const slug = getSlugParam(req);
    if (!slug) return send404(res);
    const productSlug = (req.params.productSlug ?? "").trim();
    if (productSlug.length === 0) return send404(res);
    const result = await service.getProduct(slug, productSlug);
    if (!result) return send404(res, "Product not found");
    res.json(result);
  });

  // POST check-discount
  router.post(
    "/storefronts/:slug/check-discount",
    writeLimiter,
    validate(checkDiscountSchema),
    async (req, res) => {
      const slug = getSlugParam(req);
      if (!slug) return send404(res);
      const body = req.body as z.infer<typeof checkDiscountSchema>;
      const discount = await service.checkDiscount({
        slug,
        code: body.code,
        subtotalCents: body.subtotalCents,
      });
      if (!discount) {
        res.status(404).json({ error: "Discount not found or expired" });
        return;
      }
      res.json({ discount });
    },
  );

  // POST place order
  router.post(
    "/storefronts/:slug/orders",
    writeLimiter,
    validate(placeOrderSchema),
    async (req, res) => {
      const slug = getSlugParam(req);
      if (!slug) return send404(res);
      const body = req.body as z.infer<typeof placeOrderSchema>;
      const result = await service.placeOrder(slug, body);
      if (!result) {
        res.status(400).json({ error: "Unable to place order" });
        return;
      }
      res.status(201).json(result);
    },
  );

  // GET order by id + token
  router.get("/storefronts/:slug/orders/:orderId", async (req, res) => {
    const slug = getSlugParam(req);
    if (!slug) return send404(res);
    const orderId = (req.params.orderId ?? "").trim();
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!orderId || !token) {
      res.status(400).json({ error: "token required" });
      return;
    }
    const order = await service.getOrder(slug, orderId, token);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json({ order });
  });

  // POST customer lookup
  router.post(
    "/storefronts/:slug/customer/lookup",
    writeLimiter,
    validate(customerLookupSchema),
    async (req, res) => {
      const slug = getSlugParam(req);
      if (!slug) return send404(res);
      const body = req.body as z.infer<typeof customerLookupSchema>;
      const result = await service.lookupCustomer(slug, body);
      if (!result) return send404(res);
      res.json(result);
    },
  );

  return router;
}
