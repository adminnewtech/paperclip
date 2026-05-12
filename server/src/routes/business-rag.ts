import { Router, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess } from "./authz.js";
import {
  createRagService,
  type DocumentType,
  type DocumentSource,
} from "../services/rag/index.js";

// ---------------------------------------------------------------------------
// Constants & schemas
// ---------------------------------------------------------------------------

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

const documentTypeEnum = z.enum([
  "pdf",
  "txt",
  "md",
  "csv",
  "json",
  "html",
  "entity",
]);

const documentSourceEnum = z.enum(["upload", "auto_entity", "url", "manual"]);

const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(500),
  type: documentTypeEnum,
  // For binary types (pdf), content should be base64-encoded.
  content: z.string().min(1),
  contentEncoding: z.enum(["utf8", "base64"]).optional(),
  source: documentSourceEnum.optional(),
  url: z.string().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const listDocumentsQuerySchema = z.object({
  source: documentSourceEnum.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

const querySchema = z.object({
  queryText: z.string().trim().min(1).max(4000),
  topK: z.number().int().min(1).max(50).optional(),
  threshold: z.number().min(0).max(1).optional(),
});

// ---------------------------------------------------------------------------
// Type inference for type from extension
// ---------------------------------------------------------------------------

function inferTypeFromName(name: string): DocumentType | null {
  const ext = path.extname(name).toLowerCase().replace(/^\./, "");
  switch (ext) {
    case "pdf":
      return "pdf";
    case "txt":
    case "text":
      return "txt";
    case "md":
    case "markdown":
      return "md";
    case "csv":
      return "csv";
    case "json":
      return "json";
    case "html":
    case "htm":
      return "html";
    default:
      return null;
  }
}

interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function businessRagRoutes(db: Db) {
  const router = Router();
  const rag = createRagService(db);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  async function runSingleFileUpload(req: Request, res: Response): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // ------- Create document (text content) -------
  router.post(
    "/companies/:companyId/business/rag/documents",
    validate(createDocumentSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof createDocumentSchema>;

      const content: string | Buffer =
        body.contentEncoding === "base64"
          ? Buffer.from(body.content, "base64")
          : body.content;

      const doc = await rag.ingestDocument(companyId, {
        title: body.title,
        type: body.type,
        content,
        source: body.source ?? "manual",
        url: body.url,
        metadata: body.metadata,
      });

      res.status(201).json(doc);
    },
  );

  // ------- Upload document (multipart) -------
  router.post(
    "/companies/:companyId/business/rag/documents/upload",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      try {
        await runSingleFileUpload(req, res);
      } catch (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            res
              .status(422)
              .json({ error: `File exceeds ${MAX_UPLOAD_BYTES} bytes` });
            return;
          }
          res.status(400).json({ error: err.message });
          return;
        }
        throw err;
      }

      const file = (req as Request & { file?: MulterFile }).file;
      if (!file) {
        res.status(400).json({ error: "Missing file field 'file'" });
        return;
      }
      const inferred = inferTypeFromName(file.originalname);
      if (!inferred) {
        res.status(422).json({
          error: `Cannot infer document type from filename '${file.originalname}'`,
        });
        return;
      }

      const title =
        (typeof req.body?.title === "string" && req.body.title.trim().length > 0
          ? req.body.title.trim()
          : file.originalname) ?? file.originalname;

      const content: string | Buffer =
        inferred === "pdf" ? file.buffer : file.buffer.toString("utf-8");

      const doc = await rag.ingestDocument(companyId, {
        title,
        type: inferred,
        content,
        source: "upload",
        metadata: {
          originalFilename: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
        },
      });

      res.status(201).json(doc);
    },
  );

  // ------- List documents -------
  router.get(
    "/companies/:companyId/business/rag/documents",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const parsed = listDocumentsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      const result = await rag.listDocuments(companyId, parsed.data);
      // Note: list endpoint does NOT include any document content — only
      // metadata + counters. Content is only available via the chunk-query
      // endpoint.
      res.json(result);
    },
  );

  // ------- Get document -------
  router.get(
    "/companies/:companyId/business/rag/documents/:documentId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      assertCompanyAccess(req, companyId);
      const doc = await rag.getDocument(companyId, documentId);
      if (!doc) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      res.json(doc);
    },
  );

  // ------- Delete document -------
  router.delete(
    "/companies/:companyId/business/rag/documents/:documentId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      assertCompanyAccess(req, companyId);
      await rag.deleteDocument(companyId, documentId);
      res.status(204).end();
    },
  );

  // ------- Reindex document -------
  router.post(
    "/companies/:companyId/business/rag/documents/:documentId/reindex",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const documentId = req.params.documentId as string;
      assertCompanyAccess(req, companyId);
      try {
        const doc = await rag.reindexDocument(companyId, documentId);
        res.json(doc);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
      }
    },
  );

  // ------- Query -------
  router.post(
    "/companies/:companyId/business/rag/query",
    validate(querySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof querySchema>;
      const results = await rag.query(companyId, body.queryText, {
        topK: body.topK ?? 5,
        threshold: body.threshold ?? 0,
      });
      res.json({ results });
    },
  );

  // ------- Auto-index business entities -------
  router.post(
    "/companies/:companyId/business/rag/auto-index",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const result = await rag.autoIndexBusinessEntities(companyId);
      res.json(result);
    },
  );

  // ------- Stats -------
  router.get(
    "/companies/:companyId/business/rag/stats",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const stats = await rag.getStats(companyId);
      res.json(stats);
    },
  );

  return router;
}
