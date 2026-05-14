import { Router, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { businessAttachments, businessEntities } from "@paperclipai/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

const MAX_BUSINESS_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB

const ALLOWED_MIME_PATTERNS: readonly string[] = [
  "application/pdf",
  "image/*",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  // MS Office (legacy + OOXML)
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // OpenDocument
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
];

function isAllowedMime(mime: string): boolean {
  const ct = (mime || "").toLowerCase();
  if (!ct) return false;
  return ALLOWED_MIME_PATTERNS.some((pattern) => {
    if (pattern === ct) return true;
    if (pattern.endsWith("/*")) return ct.startsWith(pattern.slice(0, -1));
    return false;
  });
}

const STORAGE_DIR =
  process.env.PAPERCLIP_BUSINESS_ATTACHMENTS_DIR ??
  (fs.existsSync("/data")
    ? "/data/business-attachments"
    : path.resolve(process.cwd(), "data/business-attachments"));

function attachmentStorageRoot(): string {
  return STORAGE_DIR;
}

function sanitizeFilename(name: string): string {
  // Strip directory traversal and control characters; keep basename only.
  const base = path.basename(name || "").replace(/[\x00-\x1f]/g, "");
  // Replace path separators that may still slip through on Windows-style names.
  const cleaned = base.replace(/[\\/]/g, "_").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 255) : "file";
}

interface MulterFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export function businessAttachmentsRoutes(db: Db) {
  const router = Router();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BUSINESS_ATTACHMENT_BYTES, files: 1 },
  });

  async function runSingleFileUpload(req: Request, res: Response) {
    await new Promise<void>((resolve, reject) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // ---------- Upload ----------
  router.post(
    "/companies/:companyId/business/entities/:entityId/attachments",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const entityId = req.params.entityId as string;
      assertCompanyAccess(req, companyId);

      // Ensure entity exists and belongs to this company.
      const [entity] = await db
        .select({ id: businessEntities.id })
        .from(businessEntities)
        .where(
          and(
            eq(businessEntities.id, entityId),
            eq(businessEntities.companyId, companyId),
          ),
        )
        .limit(1);
      if (!entity) {
        res.status(404).json({ error: "Entity not found" });
        return;
      }

      try {
        await runSingleFileUpload(req, res);
      } catch (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            res.status(422).json({
              error: `File exceeds ${MAX_BUSINESS_ATTACHMENT_BYTES} bytes`,
            });
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

      const mime = (file.mimetype || "").toLowerCase();
      if (!isAllowedMime(mime)) {
        res.status(422).json({ error: `Unsupported file type: ${mime || "unknown"}` });
        return;
      }
      if (file.size <= 0) {
        res.status(422).json({ error: "File is empty" });
        return;
      }

      const filename = sanitizeFilename(file.originalname);
      const objectName = `${randomUUID()}-${filename}`;
      const dir = path.join(attachmentStorageRoot(), companyId, entityId);
      const storagePath = path.join(dir, objectName);

      await mkdir(dir, { recursive: true });
      await writeFile(storagePath, file.buffer);

      const actor = getActorInfo(req);
      const uploadedByUserId =
        actor.actorType === "user" ? actor.actorId : null;

      const [row] = await db
        .insert(businessAttachments)
        .values({
          companyId,
          entityId,
          filename,
          mimeType: mime,
          sizeBytes: file.size,
          storagePath,
          uploadedByUserId,
        })
        .returning();

      res.status(201).json(row);
    },
  );

  // ---------- List ----------
  router.get(
    "/companies/:companyId/business/entities/:entityId/attachments",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const entityId = req.params.entityId as string;
      assertCompanyAccess(req, companyId);

      const rows = await db
        .select()
        .from(businessAttachments)
        .where(
          and(
            eq(businessAttachments.companyId, companyId),
            eq(businessAttachments.entityId, entityId),
          ),
        )
        .orderBy(desc(businessAttachments.createdAt));
      res.json({ attachments: rows });
    },
  );

  // ---------- Download ----------
  router.get(
    "/companies/:companyId/business/attachments/:attachmentId/download",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const attachmentId = req.params.attachmentId as string;
      assertCompanyAccess(req, companyId);

      const [row] = await db
        .select()
        .from(businessAttachments)
        .where(
          and(
            eq(businessAttachments.id, attachmentId),
            eq(businessAttachments.companyId, companyId),
          ),
        )
        .limit(1);
      if (!row) {
        res.status(404).json({ error: "Attachment not found" });
        return;
      }

      if (!fs.existsSync(row.storagePath)) {
        res.status(410).json({ error: "Attachment file is missing on disk" });
        return;
      }

      res.setHeader("Content-Type", row.mimeType);
      res.setHeader("Content-Length", String(row.sizeBytes));
      // Quote-escape the filename for Content-Disposition.
      const safeName = row.filename.replace(/"/g, "");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeName}"`,
      );

      const stream = fs.createReadStream(row.storagePath);
      stream.on("error", () => {
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to read attachment" });
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    },
  );

  // ---------- Delete ----------
  router.delete(
    "/companies/:companyId/business/attachments/:attachmentId",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const attachmentId = req.params.attachmentId as string;
      assertCompanyAccess(req, companyId);

      const [row] = await db
        .select()
        .from(businessAttachments)
        .where(
          and(
            eq(businessAttachments.id, attachmentId),
            eq(businessAttachments.companyId, companyId),
          ),
        )
        .limit(1);
      if (!row) {
        res.status(404).json({ error: "Attachment not found" });
        return;
      }

      await db
        .delete(businessAttachments)
        .where(eq(businessAttachments.id, attachmentId));

      try {
        await unlink(row.storagePath);
      } catch {
        // The file may have already been removed; the DB row is gone either
        // way so we treat this as success.
      }

      res.status(204).end();
    },
  );

  return router;
}
