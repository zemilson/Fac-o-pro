const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { LICENSE_DEVICE_KEY } = require("../../src/license-device-key.json");
const {
  createDeviceLicenseCode,
  validateDeviceLicenseCode,
} = require("./device-license.cjs");

const now = Date.UTC(2026, 0, 1, 12);
const deviceId = "a1b2c3d4-e5f6-47a8-9b01-23456789abcd";

test("creates a 4x6 numeric serial bound to one device", () => {
  const issued = createDeviceLicenseCode({ plan: "MENSAL", deviceId, now });
  assert.match(issued.code, /^\d{6}(?:-\d{6}){3}$/);
  assert.equal(validateDeviceLicenseCode(issued.code, { deviceId, now }).plan, "MENSAL");
  assert.equal(validateDeviceLicenseCode(issued.code, {
    deviceId: "11111111-2222-4333-8444-555555555555",
    now,
  }), null);
});

test("supports annual codes and rejects tampering or expiration", () => {
  const issued = createDeviceLicenseCode({ plan: "ANUAL", deviceId, now });
  assert.equal(validateDeviceLicenseCode(issued.code, { deviceId, now }).expiresAt, issued.expiresAt);
  const tampered = `${issued.code.slice(0, -1)}${issued.code.endsWith("0") ? "1" : "0"}`;
  assert.equal(validateDeviceLicenseCode(tampered, { deviceId, now }), null);
  assert.equal(validateDeviceLicenseCode(issued.code, { deviceId, now: issued.expiresAt }), null);
});

test("rejects malformed device identifiers and serials", () => {
  assert.throws(() => createDeviceLicenseCode({ plan: "MENSAL", deviceId: "bad", now }), /Código do aparelho inválido/);
  assert.equal(validateDeviceLicenseCode("123456-abc", { deviceId, now }), null);
});

test("generates a serial that the app can verify with Web Crypto", async () => {
  const issued = createDeviceLicenseCode({ plan: "ANUAL", deviceId, now });
  const digits = issued.code.replace(/-/g, "");
  const planCode = digits[0];
  const expirationDay = Number(digits.slice(1, 6));
  const key = await crypto.webcrypto.subtle.importKey(
    "raw",
    Buffer.from(LICENSE_DEVICE_KEY, "hex"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.webcrypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`ATELIER-DEVICE-V1|${deviceId}|${planCode}|${expirationDay}`)
  ));
  const mac = (BigInt(`0x${Buffer.from(signature.slice(0, 8)).toString("hex")}`) % 10n ** 18n)
    .toString()
    .padStart(18, "0");
  assert.equal(digits.slice(6), mac);
});
