const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createLicenseCode, validateLicenseCode, normalizeEmail } = require("./license-code.cjs");
const { createDeviceLicenseCode, validateDeviceLicenseCode, normalizeDeviceId } = require("./device-license.cjs");

const repositoryRoot = path.resolve(__dirname, "..", "..");
const dataDirectory = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), ".config"),
  "AtelierCosturaPro",
  "license-admin"
);
const privateKeyPath = path.join(dataDirectory, "signing-private.pem");
const publicKeyPath = path.join(dataDirectory, "signing-public.pem");
const historyPath = path.join(dataDirectory, "history.json");
const MAX_BODY_BYTES = 16 * 1024;

function json(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw Object.assign(new Error("Requisição muito grande."), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Corpo JSON inválido."), { status: 400 });
  }
}

function loadHistory() {
  if (!fs.existsSync(historyPath)) return [];
  const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
  if (!Array.isArray(history)) throw new Error("O histórico local não está no formato esperado.");
  return history;
}

function saveHistory(history) {
  fs.writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`, { mode: 0o600 });
}

function constantTimeEqual(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
}

function createPage(nonce) {
  const frontendPath = path.join(repositoryRoot, "gerador-licencas.html");
  return fs.readFileSync(frontendPath, "utf8").replaceAll("__CSP_NONCE__", nonce);
}

async function main() {
  if (!fs.existsSync(path.join(repositoryRoot, "gerador-licencas.html"))) {
    throw new Error("Frontend não encontrado na raiz do projeto: gerador-licencas.html");
  }
  if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) {
    throw new Error("Chaves não encontradas. Execute primeiro: npm run codes:setup");
  }
  const privateKey = fs.readFileSync(privateKeyPath, "utf8");
  const publicKey = fs.readFileSync(publicKeyPath, "utf8");
  const expectedPublicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64");
  const storedPublicKey = crypto.createPublicKey(publicKey).export({ type: "spki", format: "der" }).toString("base64");
  if (expectedPublicKey !== storedPublicKey) {
    throw new Error("As chaves pública e privada locais não correspondem. Restaure o par correto.");
  }
  const sourceKey = fs.readFileSync(path.join(repositoryRoot, "src", "license-public-key.js"), "utf8");
  if (!sourceKey.includes(`"${expectedPublicKey}"`)) {
    throw new Error("A chave do app não corresponde à chave privada local. Restaure o par de chaves correto.");
  }
  crypto.createPublicKey(publicKey);
  const history = loadHistory();
  const adminKey = crypto.randomBytes(32).toString("base64url");
  let activeSession = null;
  const server = http.createServer(async (request, response) => {
    const address = server.address();
    const expectedHost = `127.0.0.1:${address.port}`;
    if (request.headers.host !== expectedHost) {
      json(response, 403, { error: "Host não permitido." });
      return;
    }

    const nonce = crypto.randomBytes(18).toString("base64");
    response.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");

    const url = new URL(request.url, `http://${expectedHost}`);
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(createPage(nonce));
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/")) {
      if (request.headers.origin !== `http://${expectedHost}`) {
        json(response, 403, { error: "Origem não permitida." });
        return;
      }
      let body;
      try {
        body = await readJson(request);
      } catch (error) {
        json(response, error.status || 400, { error: error.message });
        return;
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        json(response, 400, { error: "Corpo JSON inválido." });
        return;
      }
      if (url.pathname === "/api/login") {
        if (constantTimeEqual(String(body.key || ""), adminKey)) {
          activeSession = crypto.randomBytes(32).toString("base64url");
          json(response, 200, { ok: true }, {
            "Set-Cookie": `license_admin=${activeSession}; HttpOnly; SameSite=Strict; Path=/`,
          });
        } else {
          json(response, 401, { error: "Chave incorreta. Use o link temporário exibido no terminal." });
        }
        return;
      }

      const cookie = request.headers.cookie || "";
      const suppliedSession = cookie.split(";").map(item => item.trim())
        .find(item => item.startsWith("license_admin="))?.slice("license_admin=".length) || "";
      if (!activeSession || !constantTimeEqual(suppliedSession, activeSession)) {
        json(response, 401, { error: "Sessão encerrada. Abra novamente o link do terminal." });
        return;
      }

      try {
        if (url.pathname === "/api/generate") {
          const customer = typeof body.customer === "string" ? body.customer.trim() : "";
          if (!customer || customer.length > 100) throw Object.assign(new Error("Informe o nome do cliente (até 100 caracteres)."), { status: 400 });
          const email = normalizeEmail(body.email);
          const deviceId = normalizeDeviceId(body.deviceId);
          const result = createDeviceLicenseCode({ plan: body.plan, deviceId });
          const entry = {
            id: crypto.randomUUID(),
            customer,
            email,
            deviceId,
            plan: result.plan,
            generatedAt: new Date().toLocaleString("pt-BR"),
            expiresAt: new Date(result.expiresAt).toLocaleDateString("pt-BR"),
            code: result.code,
          };
          const updatedHistory = [entry, ...history];
          saveHistory(updatedHistory);
          history.splice(0, history.length, ...updatedHistory);
          json(response, 201, { entry });
          return;
        }
        if (url.pathname === "/api/validate") {
          const verification = validateDeviceLicenseCode(body.code, { deviceId: body.deviceId })
            || validateLicenseCode(body.code, { publicKey, email: body.email });
          json(response, 200, verification
            ? { valid: true, plan: verification.plan, expiresAt: new Date(verification.expiresAt).toLocaleDateString("pt-BR") }
            : { valid: false });
          return;
        }
        if (url.pathname === "/api/delete") {
          if (typeof body.id !== "string") throw Object.assign(new Error("Código do histórico inválido."), { status: 400 });
          const index = history.findIndex(entry => entry.id === body.id);
          if (index !== -1) {
            const updatedHistory = history.filter(entry => entry.id !== body.id);
            saveHistory(updatedHistory);
            history.splice(0, history.length, ...updatedHistory);
          }
          json(response, 200, { ok: true });
          return;
        }
        if (url.pathname === "/api/logout") {
          activeSession = null;
          json(response, 200, { ok: true }, {
            "Set-Cookie": "license_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          });
          return;
        }
        json(response, 404, { error: "Rota não encontrada." });
      } catch (error) {
        const status = error.status || (error instanceof TypeError ? 400 : 500);
        json(response, status, { error: status === 500 ? "Falha ao processar a solicitação." : error.message });
        if (status === 500) console.error(error);
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/history") {
      if (request.headers.origin && request.headers.origin !== `http://${expectedHost}`) {
        json(response, 403, { error: "Origem não permitida." });
        return;
      }
      const cookie = request.headers.cookie || "";
      const suppliedSession = cookie.split(";").map(item => item.trim())
        .find(item => item.startsWith("license_admin="))?.slice("license_admin=".length) || "";
      if (!activeSession || !constantTimeEqual(suppliedSession, activeSession)) {
        json(response, 401, { error: "Sessão encerrada." });
      } else {
        json(response, 200, { history });
      }
      return;
    }

    json(response, 404, { error: "Rota não encontrada." });
  });

  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    const accessUrl = `http://127.0.0.1:${port}/#${adminKey}`;
    console.log("Gerador disponível somente neste computador.");
    console.log(`Link de acesso único:\n${accessUrl}`);
    console.log("Mantenha este terminal aberto enquanto usa o gerador. Pressione Ctrl+C para encerrar.");
    if (process.platform === "win32" && process.env.LICENSE_ADMIN_NO_BROWSER !== "1") {
      execFile("rundll32.exe", ["url.dll,FileProtocolHandler", accessUrl], error => {
        if (error) console.error(`Não foi possível abrir o navegador automaticamente. Copie o link acima: ${error.message}`);
      });
    }
  });
}

main().catch(error => {
  console.error(`Não foi possível iniciar o gerador: ${error.message}`);
  process.exitCode = 1;
});
