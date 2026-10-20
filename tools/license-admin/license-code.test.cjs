const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createLicenseCode, validateLicenseCode } = require("./license-code.cjs");

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const now = Date.UTC(2026, 0, 1);

test("issues a valid monthly code bound to a normalized customer email", () => {
  const issued = createLicenseCode({ plan: "MENSAL", email: "Buyer@Example.com", privateKey, now });
  const verified = validateLicenseCode(issued.code, { publicKey, email: " buyer@example.com ", now });
  assert.equal(verified.plan, "MENSAL");
  assert.equal(verified.expiresAt, now + 30 * 24 * 60 * 60 * 1000);
});

test("rejects a code changed after signing", () => {
  const issued = createLicenseCode({ plan: "ANUAL", email: "buyer@example.com", privateKey, now });
  const tampered = issued.code.replace("ANUAL", "MENSAL");
  assert.equal(validateLicenseCode(tampered, { publicKey, email: "buyer@example.com", now }), null);
});

test("rejects codes for another email and expired codes", () => {
  const issued = createLicenseCode({ plan: "MENSAL", email: "buyer@example.com", privateKey, now });
  assert.equal(validateLicenseCode(issued.code, { publicKey, email: "other@example.com", now }), null);
  assert.equal(validateLicenseCode(issued.code, { publicKey, email: "buyer@example.com", now: issued.expiresAt }), null);
});

test("produces signatures verifiable with the browser Web Crypto API", async () => {
  const issued = createLicenseCode({ plan: "ANUAL", email: "buyer@example.com", privateKey, now });
  const [, plan, payloadSegment, signatureSegment] = issued.code.split(".");
  const publicKeyDer = crypto.createPublicKey(publicKey).export({ type: "spki", format: "der" });
  const browserKey = await crypto.webcrypto.subtle.importKey(
    "spki",
    publicKeyDer,
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signatureValid = await crypto.webcrypto.subtle.verify(
    { name: "RSA-PSS", saltLength: 32 },
    browserKey,
    Buffer.from(signatureSegment, "base64url"),
    Buffer.from(`COSTURA-${plan}-${payloadSegment}`, "utf8")
  );
  assert.equal(signatureValid, true);
});
