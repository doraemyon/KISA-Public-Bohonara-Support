const ISSUER = "https://token.actions.githubusercontent.com";
const KEY_URL = ISSUER + "/.well-known/jwks";
const WORKFLOW_PATH = "/.github/workflows/publish-notices.yml@refs/heads/main";

type SigningKey = JsonWebKey & { kid?: string; alg?: string };
let cachedKeys: SigningKey[] = [];
let expiresAt = 0;

function decodeSegment(segment: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    atob(segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=")),
    (value) => value.charCodeAt(0),
  );
}

async function signingKey(kid: string): Promise<SigningKey | undefined> {
  if (Date.now() >= expiresAt) {
    const response = await fetch(KEY_URL, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("GitHub key service HTTP " + response.status);
    const jwks = await response.json<{ keys: SigningKey[] }>();
    cachedKeys = jwks.keys;
    expiresAt = Date.now() + 60_000;
  }
  return cachedKeys.find((key) => key.kid === kid && key.kty === "RSA" && key.alg === "RS256");
}

export async function isNoticePublisher(
  request: Request,
  repository: string,
  audience: string,
): Promise<boolean> {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 12000) return false;
  const token = authorization.slice(7);
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return false;
  try {
    const [header, payload, signature] = parts;
    const decoder = new TextDecoder();
    const { alg, kid } = JSON.parse(decoder.decode(decodeSegment(header)));
    if (alg !== "RS256" || typeof kid !== "string") return false;
    const claims = JSON.parse(decoder.decode(decodeSegment(payload)));
    const now = Math.floor(Date.now() / 1000);
    if (
      claims.iss !== ISSUER || claims.aud !== audience ||
      claims.repository !== repository || claims.ref !== "refs/heads/main" ||
      claims.workflow_ref !== repository + WORKFLOW_PATH ||
      !["schedule", "workflow_dispatch", "push"].includes(claims.event_name) ||
      !Number.isSafeInteger(claims.exp) || claims.exp <= now ||
      !Number.isSafeInteger(claims.nbf) || claims.nbf > now + 15
    ) return false;
    const jwk = await signingKey(kid);
    if (!jwk) {
      console.warn("Notice publication: no matching GitHub signing key.");
      return false;
    }
    const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
    const key = await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      algorithm.name,
      key,
      decodeSegment(signature),
      new TextEncoder().encode(header + "." + payload),
    );
    if (!valid) console.warn("Notice publication: GitHub signature did not verify.");
    return valid;
  } catch (error) {
    console.warn("Notice publication: GitHub verification error", error instanceof Error ? error.name + ": " + error.message : "unknown");
    return false;
  }
}
