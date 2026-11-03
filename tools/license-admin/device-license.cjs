const crypto = require("node:crypto");
const { LICENSE_DEVICE_KEY } = require("../../src/license-device-key.json");

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAN_DAYS = Object.freeze({ MENSAL: 30, ANUAL: 365 });
const PLAN_CODES = Object.freeze({ MENSAL: "1", ANUAL: "2" });
const CODE_DIGITS = 24;
const MAC_DIGITS = 18;
const MAC_MODULUS = 10n ** BigInt(MAC_DIGITS);

function normalizeDeviceId(deviceId) {
  if (typeof deviceId !== "string") throw new TypeError("Informe o código do aparelho.");
  const normalized = deviceId.trim().toLowerCase();
  if (!/^[a-f0-9-]{16,64}$/.test(normalized)) {
    throw new TypeError("Código do aparelho inválido.");
  }
  return normalized;
}

function getMac(deviceId, planCode, expirationDay) {
  const message = `ATELIER-DEVICE-V1|${normalizeDeviceId(deviceId)}|${planCode}|${expirationDay}`;
  const digest = crypto.createHmac("sha256", Buffer.from(LICENSE_DEVICE_KEY, "hex"))
    .update(message, "utf8")
    .digest();
  return (BigInt(`0x${digest.subarray(0, 8).toString("hex")}`) % MAC_MODULUS)
    .toString()
    .padStart(MAC_DIGITS, "0");
}

function formatCode(digits) {
  return digits.match(/.{6}/g).join("-");
}

function createDeviceLicenseCode({ plan, deviceId, now = Date.now() }) {
  const normalizedPlan = typeof plan === "string" ? plan.toUpperCase() : "";
  const durationDays = PLAN_DAYS[normalizedPlan];
  if (!durationDays) throw new TypeError("Plano de licença inválido.");
  if (!Number.isSafeInteger(now)) throw new TypeError("Data de emissão inválida.");
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  const expirationDay = Math.ceil((now + durationDays * DAY_MS) / DAY_MS) - 1;
  if (expirationDay > 99999) throw new RangeError("A data de vencimento não pode ser codificada.");

  const planCode = PLAN_CODES[normalizedPlan];
  const payload = `${planCode}${String(expirationDay).padStart(5, "0")}`;
  const digits = `${payload}${getMac(normalizedDeviceId, planCode, expirationDay)}`;
  const expiresAt = (expirationDay + 1) * DAY_MS;
  return { code: formatCode(digits), plan: normalizedPlan, expiresAt };
}

function validateDeviceLicenseCode(code, { deviceId, now = Date.now() }) {
  if (typeof code !== "string" || !Number.isSafeInteger(now)) return null;
  const digits = code.replace(/[\s-]/g, "");
  if (!new RegExp(`^\\d{${CODE_DIGITS}}$`).test(digits)) return null;

  const planCode = digits[0];
  const plan = Object.keys(PLAN_CODES).find(candidate => PLAN_CODES[candidate] === planCode);
  const expirationDay = Number(digits.slice(1, 6));
  if (!plan || expirationDay < Math.floor(now / DAY_MS)) return null;

  let normalizedDeviceId;
  try {
    normalizedDeviceId = normalizeDeviceId(deviceId);
  } catch {
    return null;
  }

  const expectedMac = getMac(normalizedDeviceId, planCode, expirationDay);
  const actualMac = digits.slice(6);
  const signatureValid = crypto.timingSafeEqual(Buffer.from(actualMac), Buffer.from(expectedMac));
  if (!signatureValid) return null;
  return { plan, issuedAt: null, expiresAt: (expirationDay + 1) * DAY_MS };
}

module.exports = {
  createDeviceLicenseCode,
  validateDeviceLicenseCode,
  normalizeDeviceId,
  PLAN_DAYS,
};
