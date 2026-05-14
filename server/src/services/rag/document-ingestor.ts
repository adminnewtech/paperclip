import type { DocumentType } from "./index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentChunkInput {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ParsedDocument {
  text: string;
  metadata: Record<string, unknown>;
}

export interface ChunkOptions {
  maxTokens?: number;
  overlap?: number;
}

export interface DocumentIngestor {
  parse(
    type: DocumentType,
    content: string | Buffer,
  ): Promise<ParsedDocument>;
  chunk(text: string, opts?: ChunkOptions): DocumentChunkInput[];
  estimateTokens(text: string): number;
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------
//
// Rough heuristic — 4 chars/token for Latin scripts, ~3 chars/token for Arabic
// and other dense scripts. This avoids loading tokenizer libraries at runtime.

function isMostlyArabic(text: string): boolean {
  let arabic = 0;
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 32) total++;
    if (code >= 0x0600 && code <= 0x06ff) arabic++;
  }
  return total > 0 && arabic / total > 0.3;
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  const ratio = isMostlyArabic(text) ? 3 : 4;
  return Math.max(1, Math.ceil(text.length / ratio));
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

async function tryParsePdf(
  buffer: Buffer,
): Promise<ParsedDocument> {
  const dynImport = Function("p", "return import(p)") as (
    p: string,
  ) => Promise<unknown>;
  const mod = (await dynImport("pdf-parse").catch(() => null)) as
    | { default?: (b: Buffer) => Promise<{ text: string; numpages?: number }> }
    | null;
  if (mod && typeof mod.default === "function") {
    const out = await mod.default(buffer);
    return {
      text: out.text ?? "",
      metadata: { numPages: out.numpages ?? null },
    };
  }
  throw new Error(
    "PDF parsing requires the 'pdf-parse' package. Install with: npm i pdf-parse",
  );
}

function parseCsv(text: string): ParsedDocument {
  // Simple CSV parser — handles quoted fields with embedded commas. For complex
  // CSVs (multi-line quoted fields), prefer a library. Good enough for ingestion.
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { text: "", metadata: {} };

  function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuote = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === ",") {
          out.push(cur);
          cur = "";
        } else if (ch === '"') {
          inQuote = true;
        } else {
          cur += ch;
        }
      }
    }
    out.push(cur);
    return out;
  }

  const header = splitCsvLine(lines[0]!);
  const formatted: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = splitCsvLine(lines[i]!);
    const parts: string[] = [];
    for (let j = 0; j < header.length; j++) {
      const col = header[j] ?? `col${j}`;
      const val = row[j] ?? "";
      if (val.length > 0) parts.push(`${col}=${val}`);
    }
    formatted.push(`Row ${i}: ${parts.join(", ")}`);
  }
  return {
    text: formatted.join("\n"),
    metadata: { rowCount: lines.length - 1, columns: header },
  };
}

function parseJson(text: string): ParsedDocument {
  try {
    const parsed = JSON.parse(text);
    return {
      text: JSON.stringify(parsed, null, 2),
      metadata: { isJson: true },
    };
  } catch {
    return { text, metadata: { isJson: false, parseFailed: true } };
  }
}

function parseHtml(text: string): ParsedDocument {
  // Strip script/style blocks, then tags. Decode common entities.
  const stripped = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return { text: stripped, metadata: {} };
}

function bufferToString(content: string | Buffer): string {
  if (typeof content === "string") return content;
  return content.toString("utf-8");
}

async function parse(
  type: DocumentType,
  content: string | Buffer,
): Promise<ParsedDocument> {
  switch (type) {
    case "pdf": {
      const buf = typeof content === "string" ? Buffer.from(content) : content;
      return tryParsePdf(buf);
    }
    case "txt":
    case "md":
    case "entity":
      return { text: bufferToString(content).trim(), metadata: {} };
    case "csv":
      return parseCsv(bufferToString(content));
    case "json":
      return parseJson(bufferToString(content));
    case "html":
      return parseHtml(bufferToString(content));
    default: {
      const t: never = type;
      throw new Error(`Unsupported document type: ${String(t)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

function chunk(
  text: string,
  opts?: ChunkOptions,
): DocumentChunkInput[] {
  const maxTokens = opts?.maxTokens ?? 512;
  const overlap = opts?.overlap ?? 50;
  const maxChars = maxTokens * 4; // conservative
  const overlapChars = overlap * 4;

  if (!text || text.trim().length === 0) return [];

  // Split on paragraph boundaries first.
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: DocumentChunkInput[] = [];
  let buf = "";

  function pushBuf() {
    const trimmed = buf.trim();
    if (trimmed.length > 0) {
      chunks.push({ content: trimmed });
    }
    buf = "";
  }

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      // Long paragraph — slice on sentence-ish boundaries.
      pushBuf();
      const sentences = para.split(/(?<=[.!?])\s+/);
      let local = "";
      for (const s of sentences) {
        if ((local + " " + s).length > maxChars) {
          if (local.trim().length > 0) {
            chunks.push({ content: local.trim() });
          }
          // Overlap: keep tail
          const tail = local.length > overlapChars ? local.slice(-overlapChars) : "";
          local = (tail + " " + s).trim();
          if (local.length > maxChars) {
            // Forcibly break very long sentence.
            for (let i = 0; i < local.length; i += maxChars) {
              chunks.push({ content: local.slice(i, i + maxChars).trim() });
            }
            local = "";
          }
        } else {
          local = local ? local + " " + s : s;
        }
      }
      if (local.trim().length > 0) {
        buf = local;
      }
      continue;
    }

    if ((buf + "\n\n" + para).length > maxChars) {
      pushBuf();
      // Overlap: keep tail of last chunk
      const last = chunks[chunks.length - 1]?.content ?? "";
      const tail = last.length > overlapChars ? last.slice(-overlapChars) : "";
      buf = tail.length > 0 ? tail + "\n\n" + para : para;
    } else {
      buf = buf ? buf + "\n\n" + para : para;
    }
  }
  pushBuf();

  return chunks;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDocumentIngestor(): DocumentIngestor {
  return {
    parse,
    chunk,
    estimateTokens,
  };
}
