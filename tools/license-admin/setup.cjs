const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..", "..");
const sourcePublicKey = path.join(repositoryRoot, "src", "license-public-key.js");
const dataDirectory = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), ".config"),
  "AtelierCosturaPro",
  "license-admin"
);
const privateKeyPath = path.join(dataDirectory, "signing-private.pem");
const publicKeyPath = path.join(dataDirectory, "signing-public.pem");

function writeNewFile(filePath, contents, mode) {
  try {
    fs.writeFileSync(filePath, contents, { flag: "wx", mode });
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
  return true;
}

function main() {
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const hasPrivateKey = fs.existsSync(privateKeyPath);
  const hasPublicKey = fs.existsSync(publicKeyPath);
  if (hasPrivateKey !== hasPublicKey) {
    throw new Error(
      "A chave local está incompleta. Restaure o par de chaves de um backup; não gere outra chave sem atualizar o app."
    );
  }
  if (!hasPrivateKey && fs.existsSync(sourcePublicKey)) {
    throw new Error(
      "A chave pública do app já existe, mas a chave privada local está ausente. Restaure a chave privada de um backup; não gere outra chave."
    );
  }

  if (!hasPrivateKey) {
    const pair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    writeNewFile(privateKeyPath, pair.privateKey, 0o600);
    try {
      writeNewFile(publicKeyPath, pair.publicKey, 0o644);
    } catch (error) {
      fs.rmSync(privateKeyPath, { force: true });
      throw error;
    }
  }

  const privateKey = fs.readFileSync(privateKeyPath, "utf8");
  const publicKey = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  const savedPublicKey = fs.readFileSync(publicKeyPath, "utf8");
  if (crypto.createPublicKey(savedPublicKey).export({ type: "spki", format: "der" }).compare(
    crypto.createPublicKey(publicKey).export({ type: "spki", format: "der" })
  ) !== 0) {
    throw new Error("As chaves pública e privada locais não correspondem. Restaure-as de um backup.");
  }

  const publicKeyBase64 = crypto.createPublicKey(publicKey)
    .export({ type: "spki", format: "der" })
    .toString("base64");
  const expectedModule = `export const LICENSE_PUBLIC_KEY = "${publicKeyBase64}";\n`;
  if (fs.existsSync(sourcePublicKey)) {
    if (fs.readFileSync(sourcePublicKey, "utf8") !== expectedModule) {
      throw new Error(
        "A chave pública do app difere da chave privada local. Não sobrescrevi nenhuma chave; restaure o par correto antes de gerar licenças."
      );
    }
  } else {
    fs.writeFileSync(sourcePublicKey, expectedModule, { flag: "wx" });
  }

  console.log(`Chaves prontas. A chave privada está fora do repositório:\n${privateKeyPath}`);
  console.log("Faça backup seguro da chave privada e mantenha-a em sigilo.");
}

try {
  main();
} catch (error) {
  console.error(`Não foi possível configurar o gerador: ${error.message}`);
  process.exitCode = 1;
}
