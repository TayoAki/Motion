import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function appURL() {
  const url = new URL(
    process.env.APP_URL || `http://localhost:${process.env.PORT || 4310}`,
  );
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new HttpError(
      503,
      "APP_URL must use HTTPS, or localhost for development.",
    );
  return url.origin;
}
export function encryptionReady() {
  return /^[0-9a-f]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY || "");
}
export function seal(value) {
  if (!encryptionReady())
    throw new HttpError(
      503,
      "Configure TOKEN_ENCRYPTION_KEY before connecting a channel.",
    );
  const iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, "hex"),
      iv,
    );
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
export function unseal(value) {
  const data = Buffer.from(value, "base64");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, "hex"),
    data.subarray(0, 12),
  );
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([
    cipher.update(data.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
// Provider replacement is deliberately restricted to isolated tests and loopback.
// Production always uses the documented, fixed provider origins.
export async function providerFetch(url, options = {}) {
  let target = new URL(url);
  if (
    process.env.NODE_ENV === "test" &&
    process.env.MOTION_TEST_PROVIDER_ORIGIN
  ) {
    const mock = new URL(process.env.MOTION_TEST_PROVIDER_ORIGIN);
    if (
      mock.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(mock.hostname)
    )
      throw new Error("The test provider must run on loopback.");
    target = new URL(
      `/${target.hostname}${target.pathname}${target.search}`,
      mock,
    );
  }
  return fetch(target, {
    ...options,
    redirect: "manual",
    signal: options.signal || AbortSignal.timeout(60000),
  });
}
export async function providerJSON(url, options, name) {
  let response;
  try {
    response = await providerFetch(url, options);
  } catch {
    throw new HttpError(502, `${name} could not be reached. Please retry.`);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new HttpError(
      502,
      `${name} rejected the request. Check its configuration or reconnect your account.`,
    );
  return result;
}
export function cleanEmail(value) {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new HttpError(400, "Enter a valid email address.");
  return email;
}
