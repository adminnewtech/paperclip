/**
 * ZATCA Phase 2 cryptographic signing primitives.
 *
 * ZATCA Phase 2 (Integration) requires each invoice XML to be signed using
 * ECDSA over the NIST P-256 curve (secp256r1 / prime256v1) with SHA-256, and
 * the resulting signature + signed properties + certificate to be embedded
 * into the XML as an XAdES `<ds:Signature>` block. The signed XML is then
 * submitted to the ZATCA Fatoora API for clearance (standard invoices) or
 * reporting (simplified invoices).
 *
 * This module is intentionally dependency-free: it uses only Node's built-in
 * `crypto` module so the rest of the codebase doesn't need to grow new
 * production dependencies for what is, ultimately, a regulatory feature.
 *
 * Environment variables consumed by callers (documented here for visibility):
 *   ZATCA_CERTIFICATE   PEM-encoded production certificate (CSID/PCSID).
 *   ZATCA_PRIVATE_KEY   PEM-encoded ECDSA private key, secp256r1.
 *   ZATCA_API_URL       Base URL of the ZATCA API (sandbox or production).
 *
 * SECURITY: Private keys are read from env vars and used only for signing
 * inside this process. They MUST NEVER be returned through any API response
 * or written to logs.
 */

import { createHash, createSign, randomBytes } from "node:crypto";

export interface SignatureMaterial {
  /** Base64-encoded ECDSA signature. */
  signature: string;
  /** Base64-encoded SHA-256 digest of the canonicalized XML payload. */
  digest: string;
  /** Hex-encoded SHA-256 of the digest (used for `hash` field). */
  hash: string;
  /** ISO timestamp at which signing happened. */
  signedAt: string;
}

/**
 * Compute the SHA-256 digest of the XML payload as both base64 and hex.
 * Returns the same digest in both encodings — the hex form is what ZATCA
 * exposes as the "invoice hash" used for chaining.
 */
export function sha256Digest(payload: string): { base64: string; hex: string } {
  const h = createHash("sha256").update(payload, "utf8").digest();
  return {
    base64: h.toString("base64"),
    hex: h.toString("hex"),
  };
}

/**
 * Sign the canonicalized XML payload with the provided PEM-encoded ECDSA
 * private key. Returns an object with the base64 signature and metadata.
 *
 * Throws if the key is malformed or not an EC key.
 */
export function signXmlPayload(
  payload: string,
  privateKeyPem: string,
): SignatureMaterial {
  const signer = createSign("SHA256");
  signer.update(payload, "utf8");
  signer.end();
  const signatureBuf = signer.sign(privateKeyPem);
  const digest = sha256Digest(payload);
  return {
    signature: signatureBuf.toString("base64"),
    digest: digest.base64,
    hash: digest.hex,
    signedAt: new Date().toISOString(),
  };
}

/**
 * Deterministic mock signature used when ZATCA credentials are not
 * configured. We derive the values from the SHA-256 of the payload so a
 * given input always produces the same output — this makes UI/integration
 * testing reproducible.
 *
 * Marked clearly with `mock: true` upstream so callers cannot confuse a
 * mock signature for a real one.
 */
export function mockSignXmlPayload(payload: string): SignatureMaterial {
  const digest = sha256Digest(payload);
  // Pad the digest to a 64-byte buffer (matches ECDSA-P256 signature length)
  // by repeating the hash. Purely cosmetic — never accepted by ZATCA.
  const mockSig = Buffer.concat([
    Buffer.from(digest.hex, "hex"),
    Buffer.from(digest.hex, "hex"),
  ]).slice(0, 64);
  return {
    signature: mockSig.toString("base64"),
    digest: digest.base64,
    hash: digest.hex,
    signedAt: new Date().toISOString(),
  };
}

/**
 * Generate a UUID v4. ZATCA requires a UUID per invoice.
 * Uses Node's `randomBytes` so we don't depend on `crypto.randomUUID`
 * being available in every runtime.
 */
export function generateInvoiceUuid(): string {
  const bytes = randomBytes(16);
  // Set version and variant bits per RFC 4122 section 4.4.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Validate that a string looks like a PEM-encoded private key. Cheap
 * heuristic — we don't fully parse it (Node will fail loudly on use).
 */
export function looksLikePemPrivateKey(value: string | undefined): boolean {
  if (!value) return false;
  return (
    value.includes("-----BEGIN") &&
    value.includes("PRIVATE KEY-----") &&
    value.includes("-----END")
  );
}

/**
 * Validate that a string looks like a PEM-encoded certificate.
 */
export function looksLikePemCertificate(value: string | undefined): boolean {
  if (!value) return false;
  return (
    value.includes("-----BEGIN CERTIFICATE-----") &&
    value.includes("-----END CERTIFICATE-----")
  );
}
