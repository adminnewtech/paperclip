// ---------------------------------------------------------------------------
// Embeddings service
// ---------------------------------------------------------------------------
//
// Selects a provider at construction time in the following order:
//   1. OpenAI  (OPENAI_API_KEY)        — text-embedding-3-small (1536 dim)
//   2. Voyage  (VOYAGE_API_KEY)        — voyage-2
//   3. Mock                            — deterministic hash-based (768 dim)
//
// The mock implementation is intentional and required: it lets the entire RAG
// pipeline work end-to-end in dev/CI without any network or API keys, while
// still returning a stable similarity signal.

export type EmbeddingsProvider = "openai" | "voyage" | "mock";

export interface EmbeddingsService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  cosineSimilarity(a: number[], b: number[]): number;
  dimension(): number;
  provider(): EmbeddingsProvider;
  isConfigured(): boolean;
}

const OPENAI_DIM = 1536;
const VOYAGE_DIM = 1024;
const MOCK_DIM = 768;

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const mag = Math.sqrt(na) * Math.sqrt(nb);
  if (mag === 0) return 0;
  return dot / mag;
}

// ---------------------------------------------------------------------------
// Mock provider — deterministic, no network
// ---------------------------------------------------------------------------

function mockEmbedding(text: string, dim = MOCK_DIM): number[] {
  const v = new Array<number>(dim).fill(0);
  // First pass: weighted bag-of-chars with positional spread.
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const h1 = (code * 31 + i) % dim;
    const h2 = (code * 17 + i * 7) % dim;
    v[h1] = (v[h1] ?? 0) + 1;
    v[h2] = (v[h2] ?? 0) + 0.5;
  }
  // Second pass: n-gram-ish signal (pairs of consecutive chars).
  for (let i = 0; i < text.length - 1; i++) {
    const a = text.charCodeAt(i);
    const b = text.charCodeAt(i + 1);
    const h = (a * 257 + b) % dim;
    v[h] = (v[h] ?? 0) + 0.25;
  }
  // L2-normalize.
  let mag = 0;
  for (let i = 0; i < dim; i++) mag += (v[i] ?? 0) * (v[i] ?? 0);
  mag = Math.sqrt(mag) || 1;
  for (let i = 0; i < dim; i++) v[i] = (v[i] ?? 0) / mag;
  return v;
}

function createMockProvider(): EmbeddingsService {
  return {
    async embed(text: string) {
      return mockEmbedding(text);
    },
    async embedBatch(texts: string[]) {
      return texts.map((t) => mockEmbedding(t));
    },
    cosineSimilarity,
    dimension: () => MOCK_DIM,
    provider: () => "mock",
    isConfigured: () => true,
  };
}

// ---------------------------------------------------------------------------
// OpenAI provider
// ---------------------------------------------------------------------------

interface OpenAIEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
  error?: { message?: string };
}

function createOpenAIProvider(apiKey: string): EmbeddingsService {
  const model = "text-embedding-3-small";
  async function callApi(inputs: string[]): Promise<number[][]> {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: inputs }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as OpenAIEmbeddingResponse | null;
      throw new Error(
        `OpenAI embeddings failed: ${body?.error?.message ?? res.statusText}`,
      );
    }
    const body = (await res.json()) as OpenAIEmbeddingResponse;
    const data = body.data ?? [];
    return data.map((d) => d.embedding ?? []);
  }
  return {
    async embed(text: string) {
      const [vec] = await callApi([text]);
      return vec ?? [];
    },
    async embedBatch(texts: string[]) {
      if (texts.length === 0) return [];
      // OpenAI accepts arrays; batch in chunks of 100 to be safe.
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 100) {
        const slice = texts.slice(i, i + 100);
        const vecs = await callApi(slice);
        out.push(...vecs);
      }
      return out;
    },
    cosineSimilarity,
    dimension: () => OPENAI_DIM,
    provider: () => "openai",
    isConfigured: () => true,
  };
}

// ---------------------------------------------------------------------------
// Voyage provider
// ---------------------------------------------------------------------------

interface VoyageEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
  detail?: string;
}

function createVoyageProvider(apiKey: string): EmbeddingsService {
  const model = "voyage-2";
  async function callApi(inputs: string[]): Promise<number[][]> {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: inputs }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as VoyageEmbeddingResponse | null;
      throw new Error(
        `Voyage embeddings failed: ${body?.detail ?? res.statusText}`,
      );
    }
    const body = (await res.json()) as VoyageEmbeddingResponse;
    const data = body.data ?? [];
    return data.map((d) => d.embedding ?? []);
  }
  return {
    async embed(text: string) {
      const [vec] = await callApi([text]);
      return vec ?? [];
    },
    async embedBatch(texts: string[]) {
      if (texts.length === 0) return [];
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 64) {
        const slice = texts.slice(i, i + 64);
        const vecs = await callApi(slice);
        out.push(...vecs);
      }
      return out;
    },
    cosineSimilarity,
    dimension: () => VOYAGE_DIM,
    provider: () => "voyage",
    isConfigured: () => true,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEmbeddingsService(): EmbeddingsService {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) return createOpenAIProvider(openaiKey);
  const voyageKey = process.env.VOYAGE_API_KEY?.trim();
  if (voyageKey) return createVoyageProvider(voyageKey);
  return createMockProvider();
}
