const crypto = require("node:crypto");

const DAY_MS = 24 * 60 * 60 * 1000;
const PLANS = Object.freeze({
  MENSAL: 30 * DAY_MS,
  ANUAL: 365 * DAY_MS,
});

function normalizeEmail(email) {
  if (typeof email !== "string") throw new TypeError("Informe o e-mail do cliente.");
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new TypeError("Informe um e-mail válido para vincular a licença.");
  }
  return normalized;
}

function emailDigest(email) {
  return crypto.createHash("sha256").update(normalizeEmail(email), "utf8").digest("base64url");
}

function createLicenseCode({ plan, email, privateKey, now = Date.now() }) {
  const duration = PLANS[plan];
  if (!duration) throw new TypeError("Plano de licença inválido.");
  if (!Number.isSafeInteger(now)) throw new TypeError("Data de emissão inválida.");

  const payload = {
    v: 2,
    plan,
    emailHash: emailDigest(email),
    issuedAt: now,
    expiresAt: now + duration,
    nonce: crypto.randomUUID(),
  };
  const payloadSegment = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signedContent = `COSTURA-${plan}-${payloadSegment}`;
  const signature = crypto.sign("sha256", Buffer.from(signedContent, "utf8"), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  }).toString("base64url");

  return {
    code: `COSTURA.${plan}.${payloadSegment}.${signature}`,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  };
}

function validateLicenseCode(code, { publicKey, email, now = Date.now() }) {
  if (typeof code !== "string" || !Number.isSafeInteger(now)) return null;
  const parts = code.trim().split(".");
  if (parts.length !== 4 || parts[0].toUpperCase() !== "COSTURA" || !PLANS[parts[1].toUpperCase()]) return null;
  const plan = parts[1].toUpperCase();
  const payloadSegment = parts[2];
  const signatureSegment = parts[3];
  if (!/^[A-Z0-9_-]+$/i.test(payloadSegment) || !/^[A-Z0-9_-]+$/i.test(signatureSegment)) return null;

  let payload;
  let signature;
  try {
    payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
    signature = Buffer.from(signatureSegment, "base64url");
  } catch {
    return null;
  }

  if (
    payload?.v !== 2 ||
    payload.plan !== plan ||
    !Number.isSafeInteger(payload.issuedAt) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    payload.expiresAt !== payload.issuedAt + PLANS[plan] ||
    payload.issuedAt > now + 5 * 60 * 1000 ||
    payload.expiresAt <= now ||
    typeof payload.emailHash !== "string" ||
    typeof payload.nonce !== "string"
  ) return null;

  let normalizedEmail;
  try {
    normalizedEmail = normalizeEmail(email);
  } catch {
    return null;
  }
  const expectedSignatureContent = `COSTURA-${plan}-${payloadSegment}`;
  const signatureValid = crypto.verify("sha256", Buffer.from(expectedSignatureContent, "utf8"), {
    key: publicKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  }, signature);

  if (!signatureValid || payload.emailHash !== emailDigest(normalizedEmail)) return null;
  return { plan, issuedAt: payload.issuedAt, expiresAt: payload.expiresAt };
}

module.exports = { createLicenseCode, validateLicenseCode, normalizeEmail, PLANS };
