import { useState, useEffect, useRef, useCallback } from "react";
import { registerPlugin } from "@capacitor/core";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { LICENSE_PUBLIC_KEY } from "./license-public-key.js";

const ContactPicker = registerPlugin("ContactPicker", {
  web: {
    async pickContact() {
      const contacts = navigator.contacts;
      if (!contacts?.select) {
        throw new Error("A seleção de contatos está disponível no aplicativo Android instalado.");
      }
      const [contact] = await contacts.select(["name", "tel"], { multiple: false });
      return {
        cancelled: !contact,
        name: contact?.name?.[0] || "",
        phone: contact?.tel?.[0] || "",
      };
    },
  },
});


// ─── Licenciamento ───────────────────────────────────────────────────────────
const TRIAL_DIAS    = 15;
const STORAGE_AUTH    = "oficina_auth";
const STORAGE_USERS   = "oficina_users";
const STORAGE_LICENSE = "oficina_license";

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

let licensePublicKeyPromise;
async function validarLicenca(codigo, email) {
  const partes = codigo.trim().split(".");
  if (partes.length !== 4 || partes[0].toUpperCase() !== "COSTURA" || !["MENSAL", "ANUAL"].includes(partes[1].toUpperCase())) return null;
  const plano = partes[1].toUpperCase();
  const payloadSegment = partes[2];
  const signatureSegment = partes[3];
  if (!/^[A-Z0-9_-]+$/i.test(payloadSegment) || !/^[A-Z0-9_-]+$/i.test(signatureSegment)) return null;

  let payload;
  let signatureBytes;
  try {
    const bytes = base64UrlToBytes(payloadSegment);
    payload = JSON.parse(new TextDecoder().decode(bytes));
    signatureBytes = base64UrlToBytes(signatureSegment);
  } catch {
    return null;
  }
  if (
    payload?.v !== 2 ||
    payload.plan !== plano ||
    !Number.isSafeInteger(payload.issuedAt) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    typeof payload.emailHash !== "string" ||
    typeof payload.nonce !== "string"
  ) return null;

  if (!globalThis.crypto?.subtle) {
    throw new Error("Este dispositivo não oferece suporte à verificação segura de licenças.");
  }
  licensePublicKeyPromise ??= crypto.subtle.importKey(
    "spki",
    base64UrlToBytes(LICENSE_PUBLIC_KEY.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")),
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signatureValid = await crypto.subtle.verify(
    { name: "RSA-PSS", saltLength: 32 },
    await licensePublicKeyPromise,
    signatureBytes,
    new TextEncoder().encode(`COSTURA-${plano}-${payloadSegment}`)
  );
  if (!signatureValid || payload.expiresAt <= Date.now() || payload.issuedAt > Date.now() + 300000) return null;

  const normalizedEmail = email.trim().toLowerCase();
  const emailHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedEmail));
  const emailHash = btoa(String.fromCharCode(...new Uint8Array(emailHashBytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (emailHash !== payload.emailHash) return null;
  return { plano, expiresAt: payload.expiresAt };
}

// Mantém as licenças existentes em dias corridos; novas anuais valem 365 dias.
function calcVencimento(ativadoEm, tipo = "mensal") {
  const d = new Date(ativadoEm);
  d.setDate(d.getDate() + (tipo === "anual" ? 365 : 30));
  return d;
}

function loadAuth()    { try { return JSON.parse(localStorage.getItem(STORAGE_AUTH))    || null; } catch { return null; } }
function loadUsers()   { try { return JSON.parse(localStorage.getItem(STORAGE_USERS))   || [];   } catch { return []; }   }
function loadLicense() { try { return JSON.parse(localStorage.getItem(STORAGE_LICENSE)) || null; } catch { return null; } }
function saveAuth(s)   { localStorage.setItem(STORAGE_AUTH,    JSON.stringify(s)); }
function saveUsers(u)  { localStorage.setItem(STORAGE_USERS,   JSON.stringify(u)); }
function saveLicense(l){ localStorage.setItem(STORAGE_LICENSE, JSON.stringify(l)); }
function clearAuth()   { localStorage.removeItem(STORAGE_AUTH); }

// Retorna: { tipo: "trial"|"vitalicio"|"mensal"|"expirado", diasRestantes, vencimento }
function verificarLicenca() {
  const lic = loadLicense();

  // Vitalício — nunca expira
  if (lic?.tipo === "vitalicio") return { tipo: "vitalicio", diasRestantes: null };

  // Mensal — verifica vencimento
  if (["mensal", "anual"].includes(lic?.tipo)) {
    const venc = lic.expiraEm ? new Date(lic.expiraEm) : calcVencimento(lic.ativadoEm, lic.tipo);
    const hoje = new Date();
    const diff = Math.floor((venc - hoje) / (1000*60*60*24));
    if (!Number.isNaN(venc.getTime()) && diff > 0) return { tipo: lic.tipo, diasRestantes: diff, vencimento: venc.toLocaleDateString("pt-BR") };
    return { tipo: "expirado", diasRestantes: 0, motivo: `${lic.tipo}_vencida` };
  }

  // Trial
  const users = loadUsers();
  if (!users.length) return { tipo: "novo" };
  const inicio = new Date(users[0].criadoEm);
  const diff   = Math.floor((new Date() - inicio) / (1000*60*60*24));
  const restantes = TRIAL_DIAS - diff;
  if (restantes > 0) return { tipo: "trial", diasRestantes: restantes };
  return { tipo: "expirado", diasRestantes: 0, motivo: "trial_vencido" };
}

// ─── Dados iniciais ───────────────────────────────────────────────────────────
const GRADES = ["PP", "P", "M", "G", "GG", "XGG", "EXTRA", "36", "38", "40", "42", "44", "46", "48", "50", "52", "54", "56"];

const initialState = {
  empresa: {
    nome: "", cnpj: "", ie: "", telefone: "", email: "", site: "",
    endereco: "", cidade: "", estado: "", cep: "", responsavel: "",
    municipio_codigo: "", aliquota_iss: "3.00",
  },
  costureiras: [],
  pontos: [],
  despesas: [],
  gastosPessoais: [],
  pecas: [
    { id: 1, nome: "Camiseta Básica", valor: 12.5 },
    { id: 2, nome: "Calça Jeans", valor: 28.0 },
    { id: 3, nome: "Vestido Curto", valor: 22.0 },
    { id: 4, nome: "Blusa Social", valor: 18.0 },
  ],
  processos: [
    { id: 1, nome: "Costura Overlock", percentual: 15 },
    { id: 2, nome: "Costura Reta", percentual: 10 },
    { id: 3, nome: "Bordado", percentual: 25 },
    { id: 4, nome: "Estamparia", percentual: 20 },
    { id: 5, nome: "Acabamento", percentual: 8 },
  ],
  ordens: [],
  financeiro: [],
};

// ─── Utilitários ──────────────────────────────────────────────────────────────
const fmt = (v) => `R$ ${parseFloat(v || 0).toFixed(2).replace(".", ",")}`;
const fmtDate = (d) => new Date(d).toLocaleDateString("pt-BR");
const genId = () => Date.now() + Math.random();
const today = () => new Date().toISOString().split("T")[0];

const isOrdemPaga = (o) => Boolean(o?.pago);
const isOrdemAReceber = (o) => {
  if (!o || o.status === "Cancelada") return false;
  if (o.status === "Entregue") return false;
  return ["Aberta", "Em Produção", "Finalizada"].includes(o.status);
};
const isOrdemEmEntrada = (o) => Boolean(o?.pago) && o?.status === "Entregue";

// ─── PDF Generator ────────────────────────────────────────────────────────────
const PDF_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #1C1C2E; background: #fff; padding: 0; }
  .page { padding: 40px 48px; max-width: 900px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; padding-bottom: 24px; border-bottom: 2px solid #F0F1F4; }
  .logo-block .logo { font-size: 22px; font-weight: 900; color: #1C1C2E; letter-spacing: -0.5px; }
  .logo-block .logo .dot { color: #6C63FF; }
  .logo-block .tagline { font-size: 10px; color: #C06E7A; letter-spacing: 2px; margin-top: 3px; text-transform: uppercase; }
  .logo-block .emp-info { font-size: 11px; color: #6B7280; margin-top: 10px; line-height: 1.7; }
  .doc-info { text-align: right; }
  .doc-info .doc-title { font-size: 18px; font-weight: 800; color: #C06E7A; margin-bottom: 6px; }
  .doc-info .doc-meta { font-size: 11px; color: #8892A4; line-height: 1.7; }
  .section-title { font-size: 13px; font-weight: 700; color: #C06E7A; text-transform: uppercase; letter-spacing: 0.5px; margin: 28px 0 14px; display: flex; align-items: center; gap: 8px; }
  .section-title::after { content: ""; flex: 1; height: 1px; background: #F0F1F4; }
  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; background: #F8F9FB; border-radius: 14px; padding: 20px 24px; margin-bottom: 24px; border: 1px solid #EAECF0; }
  .field label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #8892A4; font-weight: 600; display: block; margin-bottom: 5px; }
  .field value { font-size: 14px; font-weight: 700; color: #1C1C2E; display: block; }
  table { width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 14px; overflow: hidden; border: 1px solid #EAECF0; margin-bottom: 24px; }
  thead tr th { background: #3D2424; color: #FAF0EE; padding: 12px 16px; font-size: 11px; font-weight: 600; text-align: left; letter-spacing: 0.5px; text-transform: uppercase; }
  thead tr th:first-child { border-radius: 0; }
  tbody tr td { padding: 11px 16px; font-size: 12px; color: #374151; border-bottom: 1px solid #F0F1F4; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:nth-child(even) td { background: #F8F9FB; }
  .total-box { background: linear-gradient(135deg, #C06E7A, #A85260); color: #fff; border-radius: 14px; padding: 18px 24px; display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
  .total-box .total-label { font-size: 12px; font-weight: 600; opacity: 0.85; text-transform: uppercase; letter-spacing: 0.5px; }
  .total-box .total-value { font-size: 22px; font-weight: 900; }
  .badge { display: inline-block; padding: 3px 12px; border-radius: 20px; font-size: 10px; font-weight: 700; background: #F0EFFE; color: #6C63FF; }
  .sign-row { display: flex; gap: 60px; margin-top: 60px; }
  .sign-line { flex: 1; text-align: center; border-top: 1.5px solid #DDE1E9; padding-top: 10px; font-size: 11px; color: #8892A4; }
  .footer { margin-top: 48px; border-top: 1px solid #F0F1F4; padding-top: 16px; font-size: 10px; color: #9CA3AF; text-align: center; display: flex; justify-content: space-between; }
  .nfs-iss { background: #F8F9FB; border: 1px solid #EAECF0; border-radius: 14px; padding: 18px 24px; display: grid; grid-template-columns: repeat(4,1fr); gap: 16px; margin-top: 24px; }
  .nfs-iss .field label { font-size: 10px; color: #8892A4; margin-bottom: 4px; display: block; font-weight: 600; text-transform: uppercase; }
  .nfs-iss .field value { font-size: 15px; font-weight: 800; color: #1C1C2E; display: block; }
  @media print { body { padding: 0; } .page { padding: 24px 32px; } }
`;

function buildPDFHtml(conteudo, titulo) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${titulo}</title><style>${PDF_STYLES}</style></head><body><div class="page">${conteudo}<div class="footer"><span>Atelier Costura Pro · zemcost.com.br</span><span>Emitido em ${new Date().toLocaleString("pt-BR")}</span></div></div></body></html>`;
}

function gerarPDF(conteudo, titulo) {
  return buildPDFHtml(conteudo, titulo); // retorna HTML string direto
}

function sanitizeFileName(text) {
  return String(text || "documento")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function abrirDocumentoParaImprimir(htmlContent, titulo) {
  const htmlComPrint = htmlContent.replace(
    "</body>",
    "<scr" + "ipt>window.onload=function(){setTimeout(function(){window.print();},600);}<\/scr" + "ipt></body>"
  );
  const blob = new Blob([htmlComPrint], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  if (!win) alert("Permita popups para este site nas configurações do navegador.");
}

// PDFViewer — abre janela de impressão real do sistema (salvar como PDF / WhatsApp)
function PDFViewer({ htmlContent, titulo, onClose }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const gerarPreview = async () => {
      const container = document.createElement("div");
      container.style.position = "fixed";
      container.style.left = "-9999px";
      container.style.top = "0";
      container.style.width = "900px";
      container.style.background = "#ffffff";
      container.style.padding = "0";
      container.style.zIndex = "-1";

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, "text/html");
      const styles = Array.from(doc.head.querySelectorAll("style"))
        .map((node) => node.textContent)
        .join("\n");
      const bodyHtml = doc.body?.innerHTML || "";
      container.innerHTML = `<style>${styles}</style>${bodyHtml}`;
      document.body.appendChild(container);

      setIsGeneratingPdf(true);

      try {
        const canvas = await html2canvas(container, {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
          windowWidth: container.scrollWidth,
          windowHeight: container.scrollHeight,
        });

        const imgData = canvas.toDataURL("image/png");
        const pdf = new jsPDF("p", "mm", "a4");
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight() - 16;
        const imgWidth = pageWidth - 16;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        let heightLeft = imgHeight;
        let position = 8;
        let pageNumber = 0;

        pdf.addImage(imgData, "PNG", 8, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;

        while (heightLeft > 0) {
          pageNumber += 1;
          pdf.addPage();
          position = 8 - pageHeight * pageNumber;
          pdf.addImage(imgData, "PNG", 8, position, imgWidth, imgHeight);
          heightLeft -= pageHeight;
        }

        const pdfBlob = pdf.output("blob");
        const pdfUrl = URL.createObjectURL(pdfBlob);

        if (isMounted) {
          setPreviewUrl((currentUrl) => {
            if (currentUrl) URL.revokeObjectURL(currentUrl);
            return pdfUrl;
          });
        }
      } catch (error) {
        console.error("Erro ao gerar PDF:", error);
        if (isMounted) {
          alert("Não foi possível gerar o PDF no momento. Tente novamente.");
        }
      } finally {
        if (isMounted) {
          container.remove();
          setIsGeneratingPdf(false);
        }
      }
    };

    gerarPreview();

    return () => {
      isMounted = false;
    };
  }, [htmlContent, titulo]);

  const abrirEImprimir = () => {
    abrirDocumentoParaImprimir(htmlContent, titulo);
    onClose?.();
  };

  const salvarArquivo = async () => {
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = "900px";
    container.style.background = "#ffffff";
    container.style.padding = "0";
    container.style.zIndex = "-1";

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");
    const styles = Array.from(doc.head.querySelectorAll("style"))
      .map((node) => node.textContent)
      .join("\n");
    const bodyHtml = doc.body?.innerHTML || "";
    container.innerHTML = `<style>${styles}</style>${bodyHtml}`;
    document.body.appendChild(container);

    setIsGeneratingPdf(true);

    try {
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        windowWidth: container.scrollWidth,
        windowHeight: container.scrollHeight,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight() - 16;
      const imgWidth = pageWidth - 16;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 8;
      let pageNumber = 0;

      pdf.addImage(imgData, "PNG", 8, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        pageNumber += 1;
        pdf.addPage();
        position = 8 - pageHeight * pageNumber;
        pdf.addImage(imgData, "PNG", 8, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const pdfBlob = pdf.output("blob");
      const pdfUrl = URL.createObjectURL(pdfBlob);
      setPreviewUrl((currentUrl) => {
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        return pdfUrl;
      });

      pdf.save(`${sanitizeFileName(titulo)}.pdf`);
    } catch (error) {
      console.error("Erro ao gerar PDF:", error);
      alert("Não foi possível gerar o PDF no momento. Tente novamente.");
    } finally {
      container.remove();
      setIsGeneratingPdf(false);
    }
  };

  const compartilharWhatsApp = async () => {
    try {
      const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
      const file = new File([blob], `${sanitizeFileName(titulo)}.html`, { type: "text/html;charset=utf-8" });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: titulo,
          text: `Documento preparado para impressão e salvamento: ${titulo}`,
          files: [file],
        });
        return;
      }
    } catch (error) {
      console.warn("Falha ao compartilhar via Web Share API:", error);
    }

    const mensagem = encodeURIComponent(`Documento preparado para imprimir e salvar: ${titulo}`);
    window.open(`https://wa.me/?text=${mensagem}`, "_blank", "noopener,noreferrer");
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(10,8,30,0.92)", backdropFilter:"blur(16px)", zIndex:2000, display:"flex", flexDirection:"column" }}>
      <div style={{ background:"rgba(20,18,40,0.98)", borderBottom:"1px solid rgba(255,255,255,0.08)", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0, gap:10, flexWrap:"wrap" }}>
        <span style={{ fontSize:14, fontWeight:700, color:"#FFF", flex:1 }}>⎙ {titulo}</span>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <button onClick={abrirEImprimir}
            style={{ background:"linear-gradient(135deg,#C06E7A,#E8A0AA)", border:"none", borderRadius:10, padding:"11px 20px", color:"#FFF", fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"inherit", boxShadow:"0 4px 18px #6C63FF44" }}>
            Imprimir agora
          </button>
          <button onClick={salvarArquivo}
            style={{ background:"rgba(0,200,150,0.15)", border:"1.5px solid rgba(0,200,150,0.35)", borderRadius:10, padding:"11px 16px", color:"#BDF2E1", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
            Salvar PDF
          </button>
          <button onClick={compartilharWhatsApp}
            style={{ background:"rgba(37,211,102,0.16)", border:"1.5px solid rgba(37,211,102,0.35)", borderRadius:10, padding:"11px 16px", color:"#D9FCE8", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
            WhatsApp
          </button>
          <button onClick={onClose}
            style={{ background:"rgba(255,107,107,0.12)", border:"1.5px solid rgba(255,107,107,0.3)", borderRadius:10, padding:"11px 16px", color:"#FF6B6B", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
            ✕ Fechar
          </button>
        </div>
      </div>

      <div style={{ flex:1, background:"#F0F1F4", padding:24, overflow:"auto" }}>
        <div style={{ maxWidth:900, width:"100%", minHeight:560, margin:"0 auto", background:"rgba(255,255,255,0.92)", borderRadius:16, boxShadow:"0 10px 36px rgba(0,0,0,0.18)", overflow:"hidden", display:"flex", flexDirection:"column" }}>
          {previewUrl ? (
            <>
              <div style={{ padding:"12px 16px", borderBottom:"1px solid #E2E5EC", display:"flex", justifyContent:"space-between", alignItems:"center", background:"#FFF" }}>
                <span style={{ fontSize:14, fontWeight:700, color:"#1C1C2E" }}>Pré-visualização do PDF</span>
                <span style={{ fontSize:12, color:"#6B7280" }}>{isGeneratingPdf ? "Gerando..." : "Visualização interna"}</span>
              </div>
              <iframe
                src={previewUrl}
                title={titulo}
                style={{ flex:1, width:"100%", border:"none", background:"#FFF" }}
              />
            </>
          ) : (
            <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", textAlign:"center", padding:28 }}>
              <div>
                <div style={{ fontSize:24, fontWeight:800, color:"#1C1C2E", marginBottom:8 }}>Preparando impressão</div>
                <div style={{ fontSize:13, color:"#6B7280", lineHeight:1.6 }}>Clique em “Salvar PDF” para gerar e visualizar o documento aqui.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Componentes UI ───────────────────────────────────────────────────────────
const Input = ({ label, ...p }) => (
  <div style={{ marginBottom: 16 }}>
    {label && <label style={{ display:"block", fontSize:11, letterSpacing:0.3, textTransform:"uppercase", color:"#C06E7A", marginBottom:6, fontWeight:700 }}>{label}</label>}
    <input {...p} style={{ width:"100%", background:"#FFF", border:"1.5px solid #E2E5EC", borderRadius:10, padding:"11px 14px", color:"#1C1C2E", fontSize:14, outline:"none", fontFamily:"inherit", boxSizing:"border-box", ...p.style }}
      onFocus={e=>{ e.target.style.borderColor="#C06E7A"; e.target.style.boxShadow="0 0 0 3px #6C63FF14"; }}
      onBlur={e=>{ e.target.style.borderColor="#E2E5EC"; e.target.style.boxShadow="none"; }} />
  </div>
);

const Select = ({ label, options, ...p }) => (
  <div style={{ marginBottom: 16 }}>
    {label && <label style={{ display:"block", fontSize:11, letterSpacing:0.5, textTransform:"uppercase", color:"rgba(238,196,200,0.8)", marginBottom:6, fontWeight:600 }}>{label}</label>}
    <select {...p} style={{ width:"100%", background:"rgba(255,255,255,0.08)", border:"1.5px solid rgba(255,255,255,0.12)", borderRadius:10, padding:"11px 14px", color:"#FFF", fontSize:14, outline:"none", fontFamily:"inherit", cursor:"pointer", boxSizing:"border-box", ...p.style }}>
      {options.map((o) => <option key={o.value} value={o.value} style={{ background:"#2D2B55", color:"#FFF" }}>{o.label}</option>)}
    </select>
  </div>
);

const Btn = ({ children, variant = "primary", ...p }) => {
  const styles = {
    primary: { background:"linear-gradient(135deg,#3b82f6,#2563eb)", color:"#FFF", fontWeight:700, boxShadow:"0 8px 24px rgba(59,130,246,0.28)", border:"1px solid rgba(96,165,250,0.35)" },
    secondary: { background:"rgba(148,163,184,0.12)", color:"#E2E8F0", border:"1px solid rgba(148,163,184,0.22)", fontWeight:600 },
    danger: { background:"rgba(239,68,68,0.12)", color:"#FCA5A5", border:"1px solid rgba(239,68,68,0.3)", fontWeight:600 },
    ghost: { background:"rgba(15,23,42,0.35)", color:"#CBD5E1", border:"1px solid rgba(148,163,184,0.22)", fontWeight:500 },
  };
  return (
    <button {...p} style={{ padding:"10px 20px", borderRadius:10, cursor:"pointer", fontSize:13, fontWeight:600, transition:"all 0.18s", fontFamily:"inherit", ...styles[variant], ...p.style }}>
      {children}
    </button>
  );
};

const Card = ({ children, style }) => (
  <div style={{ background:"rgba(15,23,42,0.7)", backdropFilter:"blur(16px)", border:"1px solid rgba(148,163,184,0.16)", borderRadius:18, padding:22, boxShadow:"0 10px 30px rgba(15,23,42,0.18)", ...style }}>{children}</div>
);

const Badge = ({ children, color = "#C06E7A" }) => (
  <span style={{ background:color+"22", color, padding:"4px 12px", borderRadius:20, fontSize:11, fontWeight:700, display:"inline-flex", alignItems:"center", gap:4, border:`1px solid ${color}33` }}>{children}</span>
);

const Modal = ({ title, onClose, children }) => (
  <div style={{ position:"fixed", inset:0, background:"rgba(2,6,23,0.72)", backdropFilter:"blur(16px)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
    <div style={{ background:"linear-gradient(145deg,#111827,#1f2937)", border:"1px solid rgba(148,163,184,0.18)", borderRadius:22, width:"100%", maxWidth:640, maxHeight:"90vh", overflow:"auto", boxShadow:"0 24px 60px rgba(2,6,23,0.5)" }}>
      <div style={{ padding:"22px 28px", borderBottom:"1px solid rgba(148,163,184,0.12)", display:"flex", justifyContent:"space-between", alignItems:"center", position:"sticky", top:0, background:"linear-gradient(145deg,#111827,#1f2937)", zIndex:1 }}>
        <span style={{ fontWeight:800, fontSize:17, color:"#F8FAFC" }}>{title}</span>
        <button onClick={onClose} style={{ background:"rgba(148,163,184,0.12)", border:"none", borderRadius:8, width:34, height:34, cursor:"pointer", fontSize:15, color:"rgba(226,232,240,0.76)", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
      </div>
      <div style={{ padding:28 }}>{children}</div>
    </div>
  </div>
);

// ─── Auth Gate ──────────────────────────────────────────────────────────────
export default function AuthGate() {
  const [session, setSession]       = useState(() => loadAuth());
  const [licenca, setLicenca]       = useState(() => verificarLicenca());
  const [splash, setSplash]         = useState(true);
  const [splashOut, setSplashOut]   = useState(false);

  useEffect(() => {
    // Splash dura 2.2s depois faz fade-out
    const t1 = setTimeout(() => setSplashOut(true), 2200);
    const t2 = setTimeout(() => setSplash(false), 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const login = (s) => { saveAuth(s); setSession(s); setLicenca(verificarLicenca()); };
  const logout = () => { clearAuth(); setSession(null); };
  const ativarLicenca = (tipo, expiraEm, codigo) => {
    const lic = { tipo, ativadoEm: new Date().toISOString(), expiraEm: new Date(expiraEm).toISOString(), codigo };
    saveLicense(lic);
    setLicenca(verificarLicenca());
  };

  const renovarLicenca = () => {
    // Remove licença mensal vencida e volta para tela de ativação
    saveLicense(null);
    localStorage.removeItem(STORAGE_LICENSE);
    setLicenca(verificarLicenca());
  };

  if (splash) return <SplashScreen fadeOut={splashOut} />;
  if (!session) return <LoginScreen onLogin={login} licenca={licenca} />;
  if (licenca.tipo === "expirado") return <TelaExpirado onAtivar={ativarLicenca} onLogout={logout} motivo={licenca.motivo} email={session.email} />;
  return <OficinaApp session={session} onLogout={logout} licenca={licenca} onAtivar={ativarLicenca} />;
}

// ─── Splash Screen ────────────────────────────────────────────────────────────
function SplashScreen({ fadeOut }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let v = 0;
    const iv = setInterval(() => {
      v += Math.random() * 18 + 4;
      if (v >= 100) { v = 100; clearInterval(iv); }
      setProgress(v);
    }, 120);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{
      position:"fixed", inset:0,
      background:"linear-gradient(160deg,#2b2d30 0%,#3a3d40 55%,#222529 100%)",
      display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
      opacity: fadeOut ? 0 : 1,
      transition: "opacity 0.6s ease",
      zIndex: 9999,
      overflow: "hidden",
      paddingBottom:40,
    }}>
      {/* Mantem a arte inteira visivel sem ocupar a tela toda */}
      <img src="/splash.png" alt="Atelier Costura Pro"
        style={{
          width:"min(72vw, 360px)", height:"min(62vh, 548px)",
          objectFit:"contain", flexShrink:1, zIndex:1,
        }}
      />
      {/* Barra de progresso sobreposta no fundo */}
      <div style={{ width:"min(280px,70vw)", zIndex:2 }}>
        <div style={{ fontSize:12, color:"#93c5fd", textAlign:"center", marginBottom:10, fontFamily:"Georgia, serif", letterSpacing:1 }}>
          Carregando...
        </div>
        <div style={{ height:6, background:"rgba(148,163,184,0.18)", borderRadius:10, overflow:"hidden" }}>
          <div style={{
            height:"100%", background:"linear-gradient(90deg,#60a5fa,#2563eb)",
            borderRadius:10, width:`${progress}%`,
            transition:"width 0.15s ease",
          }} />
        </div>
        <div style={{ textAlign:"center", marginTop:16, fontSize:18, color:"#93c5fd" }}>✦</div>
      </div>
    </div>
  );
}

// ─── App Principal ────────────────────────────────────────────────────────────
function OficinaApp({ session, onLogout, licenca, onAtivar }) {
  const filtrarMes = (o) => {
    const d = new Date(o.dataCriacao);
    const agora = new Date();
    return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
  };
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    document.body.style.fontFamily = "'Inter', 'Segoe UI', system-ui, sans-serif";
  }, []);
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState(() => {
    try { return JSON.parse(localStorage.getItem("oficina_data")) || initialState; } catch { return initialState; }
  });
  const [modal, setModal] = useState(null);

  useEffect(() => {
    localStorage.setItem("oficina_data", JSON.stringify(data));
  }, [data]);

  const save = (key, list) => setData((d) => ({ ...d, [key]: list }));

  const tabs = [
    { id: "ordens",       icon: "◎", label: "Ordens de Serviço" },
    { id: "producao",     icon: "◷", label: "Produção" },
    { id: "ponto",        icon: "⏱", label: "Ponto" },
    { id: "pecas",        icon: "◇", label: "Peças" },
    { id: "processos",    icon: "◈", label: "Processos" },
    { id: "financeiro",   icon: "◉", label: "Ateliê" },
    { id: "finpessoal",   icon: "◇", label: "Pessoal" },
    { id: "relatorios",   icon: "◰", label: "Relatórios" },
    { id: "config",       icon: "⚙", label: "Empresa" },
  ];

  // Estatísticas
  const totalOS = data.ordens.length;
  const abertas = data.ordens.filter((o) => o.status === "Aberta").length;
  const entregues = data.ordens.filter((o) => o.status === "Entregue").length;
  const totalFaturado = data.ordens.reduce((s, o) => s + (o.valorTotal || 0), 0);
  const totalPecas = data.ordens.reduce((s, o) => s + (o.itens?.reduce((a, i) => a + i.qtdTotal, 0) || 0), 0);

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(180deg,#0f172a 0%,#111827 38%,#1f2937 100%)", color:"#E2E8F0", fontFamily:"'Inter','Segoe UI',system-ui,sans-serif", display:"flex", flexDirection:"column" }}>

      {/* Header topo — logo + usuário */}
      <div style={{ background:"rgba(15,23,42,0.82)", backdropFilter:"blur(20px)", borderBottom:"1px solid rgba(148,163,184,0.12)", padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between", height:60, flexShrink:0, position:"sticky", top:0, zIndex:100 }}>
        <button onClick={() => setTab("dashboard")} style={{ background:"transparent", border:"none", cursor:"pointer", display:"flex", alignItems:"center", gap:10 }}>
        <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,#60a5fa,#2563eb)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, color:"#FFF", fontWeight:900 }}>A</div>
          <div style={{ textAlign:"left" }}>
          <div style={{ fontSize:14, fontWeight:800, color:"#F8FAFC", letterSpacing:-0.3 }}>Atelier Costura Pro</div>
          <div style={{ fontSize:9, color:"rgba(148,163,184,0.8)", letterSpacing:2 }}>ZEMCOST.COM.BR</div>
          </div>
        </button>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {licenca?.tipo === "trial" && (
            <div style={{ background:"#FF8C4222", border:"1px solid #FF8C4255", borderRadius:8, padding:"4px 10px" }}>
              <div style={{ fontSize:10, color:"#FF8C42", fontWeight:800 }}>⏳ Trial · {licenca.diasRestantes}d</div>
            </div>
          )}
          {licenca?.tipo === "mensal" && (
            <div style={{ background:"#4F8EF722", border:"1px solid #4F8EF755", borderRadius:8, padding:"4px 10px" }}>
              <div style={{ fontSize:10, color:"#4F8EF7", fontWeight:800 }}>Mensal · {licenca.diasRestantes}d</div>
            </div>
          )}
          {licenca?.tipo === "anual" && (
            <div style={{ background:"#00C89622", border:"1px solid #00C89655", borderRadius:8, padding:"4px 10px" }}>
              <div style={{ fontSize:10, color:"#00C896", fontWeight:800 }}>Anual · {licenca.diasRestantes}d</div>
            </div>
          )}
          {licenca?.tipo === "vitalicio" && (
            <div style={{ background:"#00C89622", border:"1px solid #00C89655", borderRadius:8, padding:"4px 10px" }}>
              <div style={{ fontSize:10, color:"#00C896", fontWeight:800 }}>✦ Vitalício</div>
            </div>
          )}
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:12, color:"#FFF", fontWeight:700 }}>{session.nome}</div>
            <div style={{ fontSize:9, color:"rgba(255,255,255,0.35)" }}>{new Date().toLocaleDateString("pt-BR",{day:"2-digit",month:"short"})}</div>
          </div>
          <button onClick={onLogout} style={{ background:"rgba(148,163,184,0.08)", border:"1px solid rgba(148,163,184,0.18)", borderRadius:8, padding:"6px 12px", color:"rgba(226,232,240,0.82)", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
            ⏻ Sair
          </button>
        </div>
      </div>

      {/* Conteúdo */}
      <div style={{ flex:1, padding:"24px 20px", overflowY:"auto", maxWidth:1100, margin:"0 auto", width:"100%" }}>
        {tab === "dashboard" && <Dashboard stats={{ totalOS, abertas, entregues, totalFaturado, totalPecas }} ordens={data.ordens} setTab={setTab} />}
        {tab === "ordens" && <Ordens data={data} save={save} goBack={() => setTab("dashboard")} />}
        {tab === "producao" && <Producao ordens={data.ordens} saveOrdens={(l) => save("ordens", l)} goBack={() => setTab("dashboard")} />}
        {tab === "ponto" && <Ponto costureiras={data.costureiras||[]} pontos={data.pontos||[]} saveCostureiras={(l)=>save("costureiras",l)} savePontos={(l)=>save("pontos",l)} goBack={() => setTab("dashboard")} />}
        {tab === "pecas" && <Pecas pecas={data.pecas} save={(l) => save("pecas", l)} goBack={() => setTab("dashboard")} />}
        {tab === "processos" && <Processos processos={data.processos} pecas={data.pecas} save={(l) => save("processos", l)} goBack={() => setTab("dashboard")} />}
        {tab === "financeiro" && <Financeiro ordens={data.ordens} despesas={data.despesas||[]} saveDespesas={(l)=>save("despesas",l)} saveOrdens={(l)=>save("ordens",l)} goBack={() => setTab("dashboard")} />}
        {tab === "finpessoal" && <FinanceiroPessoal lucroAtelier={data.ordens.filter(o=>o.status==="Entregue"&&filtrarMes(o)).reduce((s,o)=>s+(o.valorTotal||0),0)} gastos={data.gastosPessoais||[]} saveGastos={(l)=>save("gastosPessoais",l)} goBack={() => setTab("dashboard")} />}
        {tab === "relatorios" && <Relatorios data={data} empresa={data.empresa || {}} goBack={() => setTab("dashboard")} />}
        {tab === "config" && <Configuracoes empresa={data.empresa || {}} save={(e) => setData(d => ({ ...d, empresa: e }))} goBack={() => setTab("dashboard")} />}
      </div>

    </div>
  );
}


// ─── Botão Voltar ─────────────────────────────────────────────────────────────
function BtnVoltar({ onClick }) {
  return (
    <button onClick={onClick}
      style={{ display:"flex", alignItems:"center", gap:6, background:"transparent", border:"1px solid #2a2a3e", borderRadius:8, padding:"7px 14px", color:"#9CA3AF", fontSize:12, cursor:"pointer", fontFamily:"Georgia, serif", marginBottom:20, transition:"all 0.15s" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor="#C06E7A"; e.currentTarget.style.color="#C06E7A"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor="#DDE1E9"; e.currentTarget.style.color="#9CA3AF"; }}>
      ← Início
    </button>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ stats, ordens, setTab }) {
  const recentes = [...ordens].sort((a, b) => b.id - a.id).slice(0, 5);
  const statusColor = { Aberta: "#4F8EF7", "Em Produção": "#C06E7A", Finalizada: "#00C896", Entregue: "#9CA3AF", Cancelada: "#FF6B6B" };

  const menus = [
    { id: "ordens",     icon: "◎", label: "Ordens de Serviço", desc: "Cadastrar e gerenciar OS",     color: "#4F8EF7" },
    { id: "producao",   icon: "◷", label: "Produção",          desc: "Acompanhar e alterar status",  color: "#FF8C42" },
    { id: "pecas",      icon: "◇", label: "Tipos de Peças",    desc: "Cadastro de peças e valores",  color: "#EEC4C8" },
    { id: "processos",  icon: "◈", label: "Processos",         desc: "Tipos e percentuais",          color: "#C06E7A" },
    { id: "financeiro", icon: "◉", label: "Financeiro Ateliê",  desc: "Entradas, saídas e DRE",      color: "#00C896" },
    { id: "finpessoal", icon: "◇", label: "Financeiro Pessoal", desc: "Salário, gastos e parcelas",   color: "#FF8C42" },
    { id: "relatorios", icon: "◰", label: "Relatórios",         desc: "PDFs e notas fiscais",         color: "#f08080" },
    { id: "ponto",      icon: "⏱", label: "Ponto",              desc: "Registro de jornada",          color: "#4F8EF7" },
    { id: "config",     icon: "⚙", label: "Empresa",            desc: "Dados e configurações",        color: "#9CA3AF" },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, color: "#FFF", letterSpacing: -1 }}>Dashboard</h1>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Visão geral da sua oficina</p>
      </div>

      {/* Botões de navegação */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 14, marginBottom: 28 }}>
        {menus.map((m) => (
          <button key={m.id} onClick={() => setTab(m.id)}
            style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(192,110,122,0.2)", borderRadius: 18, padding: "22px 18px", cursor: "pointer", textAlign: "left", transition: "all 0.18s", display: "flex", flexDirection: "column", gap: 14, backdropFilter: "blur(10px)", fontFamily: "inherit" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(192,110,122,0.18)"; e.currentTarget.style.borderColor = "rgba(192,110,122,0.5)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.borderColor = "rgba(192,110,122,0.2)"; e.currentTarget.style.transform = "translateY(0)"; }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: m.color + "28", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: m.color }}>{m.icon}</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, color: "#FFF", marginBottom: 5, lineHeight: 1.2 }}>{m.label}</div>
              <div style={{ fontSize: 13, color: "rgba(238,196,200,0.6)", lineHeight: 1.4 }}>{m.desc}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Cards de estatísticas */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 16, marginBottom: 28 }}>
        {[
          { label: "Total de OS",  value: stats.totalOS,    sub: "ordens cadastradas", color: "#EEC4C8", icon: "◎" },
          { label: "Em Aberto",    value: stats.abertas,    sub: "aguardando",         color: "#FF8C42", icon: "◷" },
          { label: "Entregues",    value: stats.entregues,  sub: "concluídas",         color: "#00C896", icon: "✓" },
          { label: "Peças",        value: stats.totalPecas, sub: "produzidas",         color: "#4F8EF7", icon: "◇" },
          { label: "Faturamento",  value: `R$ ${stats.totalFaturado.toFixed(2).replace(".",",")}`, sub: "receita total", color: "#F7C948", icon: "◉" },
        ].map((s) => (
          <div key={s.label} style={{ background:"rgba(255,255,255,0.06)", backdropFilter:"blur(10px)", borderRadius:18, padding:"20px 22px", border:`1px solid rgba(255,255,255,0.1)` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ fontSize:10, fontWeight:700, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:1 }}>{s.label}</div>
              <div style={{ width:34, height:34, borderRadius:10, background:s.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, color:s.color }}>{s.icon}</div>
            </div>
            <div style={{ fontSize:s.label==="Faturamento"?18:30, fontWeight:900, color:"#FFF", lineHeight:1 }}>{s.value}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:6 }}>{s.sub}</div>
          </div>
        ))}
      </div>
      <Card>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#C06E7A", letterSpacing: 1, marginBottom: 16, textTransform: "uppercase" }}>Últimas Ordens</h3>
        {recentes.length === 0 ? (
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Nenhuma ordem cadastrada ainda.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["Nº OS", "Cliente", "Data", "Peças", "Valor", "Status"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, letterSpacing: 1, color: "#8892A4", textTransform: "uppercase", borderBottom: "1px solid #1e2030" }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {recentes.map((o) => (
                <tr key={o.id}>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#C06E7A", fontWeight: 700 }}>#{String(o.numero).padStart(4, "0")}</td>
                  <td style={{ padding: "10px 12px", fontSize: 13 }}>{o.cliente}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#6B7280" }}>{fmtDate(o.dataCriacao)}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#9CA3AF" }}>{o.itens?.reduce((a, i) => a + i.qtdTotal, 0) || 0}</td>
                  <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 700, color: "#00C896" }}>{fmt(o.valorTotal)}</td>
                  <td style={{ padding: "10px 12px" }}><Badge color={statusColor[o.status]}>{o.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ─── Ordens de Serviço ────────────────────────────────────────────────────────
function Ordens({ data, save, goBack }) {
  const [modal, setModal] = useState(null);
  const [filtro, setFiltro] = useState("");
  const [pdfView, setPdfView] = useState(null);
  const [excluirId, setExcluirId] = useState(null);
  const statusColor = { Aberta: "#4F8EF7", "Em Produção": "#C06E7A", Finalizada: "#00C896", Entregue: "#9CA3AF", Cancelada: "#FF6B6B" };

  const ordens = data.ordens.filter((o) =>
    o.cliente?.toLowerCase().includes(filtro.toLowerCase()) ||
    String(o.numero).includes(filtro)
  );

  const nextNumero = Math.max(0, ...data.ordens.map((o) => o.numero || 0)) + 1;

  const salvarOrdem = (ordem) => {
    const lista = ordem.id
      ? data.ordens.map((o) => o.id === ordem.id ? ordem : o)
      : [...data.ordens, { ...ordem, id: genId(), numero: nextNumero }];
    save("ordens", lista);
    setModal(null);
  };

  const excluir = (id) => setExcluirId(id);
  const confirmarExcluirOS = () => {
    save("ordens", data.ordens.filter((o) => o.id !== excluirId));
    setExcluirId(null);
  };

  const imprimirOS = (o) => {
    const emp = data.empresa || {};
    const gradesUsadas = GRADES.filter(g => o.itens?.some(i => (i.grade?.[g] || 0) > 0));
    const html = `
      <div class="header">
        <div class="logo-block">
          <div class="logo"><span class="dot">●</span> ${emp.nome || "Atelier Costura Pro"}</div>
          <div class="tagline">Costura Pro</div>
          <div class="emp-info">${emp.cnpj ? "CNPJ: " + emp.cnpj + "<br>" : ""}${emp.endereco ? emp.endereco + ", " + (emp.cidade||"") + " - " + (emp.estado||"") : ""}</div>
        </div>
        <div class="doc-info">
          <div class="doc-title">Ordem de Serviço</div>
          <div class="doc-meta"><strong>Nº ${String(o.numero).padStart(4,"0")}</strong><br>Emissão: ${fmtDate(o.dataCriacao)}<br>Entrega: ${o.dataEntrega ? fmtDate(o.dataEntrega) : "—"}<br>Previsão de pagamento: ${o.dataPagamentoPrevista ? fmtDate(o.dataPagamentoPrevista) : "—"}<br><span class="badge">${o.status}</span></div>
        </div>
      </div>
      <div class="section-title">Dados do Cliente</div>
      <div class="fields">
        <div class="field"><label>Cliente</label><value>${o.cliente}</value></div>
        <div class="field"><label>Telefone</label><value>${o.telefone || "—"}</value></div>
        <div class="field"><label>CNPJ / CPF</label><value>${o.documento || "—"}</value></div>
        ${o.email ? `<div class="field"><label>E-mail</label><value>${o.email}</value></div>` : ""}
      </div>
      <div class="section-title">Itens da Ordem</div>
      <table>
        <thead><tr><th>Peça</th>${gradesUsadas.map(g => `<th style="text-align:center">${g}</th>`).join("")}<th style="text-align:center">Total</th><th style="text-align:right">Valor</th></tr></thead>
        <tbody>
          ${(o.itens||[]).map(item => `
            <tr>
              <td><strong>${item.nomePeca}</strong></td>
              ${gradesUsadas.map(g => `<td style="text-align:center">${item.grade?.[g]||0}</td>`).join("")}
              <td style="text-align:center;font-weight:700;color:#6C63FF">${item.qtdTotal}</td>
              <td style="text-align:right;font-weight:700">${fmt(item.valorItem)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div class="total-box"><span class="total-label">Total Geral</span><span class="total-value">${fmt(o.valorTotal)}</span></div>
      ${o.observacoes ? `<div style="margin-top:20px;padding:16px 20px;background:#F8F9FB;border-radius:12px;font-size:12px;color:#6B7280;border:1px solid #EAECF0"><strong style="color:#1C1C2E">Observações:</strong> ${o.observacoes}</div>` : ""}
      <div class="sign-row">
        <div class="sign-line">Assinatura do Cliente</div>
        <div class="sign-line">Responsável pelo Serviço</div>
      </div>`;
    setPdfView({ htmlContent: gerarPDF(html, `OS ${String(o.numero).padStart(4, "0")}`), titulo: `OS ${String(o.numero).padStart(4, "0")}` });
  };

  const imprimirNF = (o) => {
    const emp = data.empresa || {};
    const html = `
      <div class="header">
        <div><div class="logo">✦ <span>Atelier</span> COSTURA PRO</div><div style="font-size:10px;color:#999;margin-top:2px">CNPJ: 00.000.000/0001-00 · Reg. Municipal: 000000</div></div>
        <div class="info-empresa"><strong style="font-size:16px">NOTA FISCAL DE SERVIÇOS</strong><br>Nº ${String(o.numero).padStart(6, "0")}<br>Data: ${fmtDate(o.dataCriacao)}</div>
      </div>
      <h2>Tomador de Serviços</h2>
      <div class="fields">
        <div class="field"><label>Nome / Razão Social</label><value>${o.cliente}</value></div>
        <div class="field"><label>CPF / CNPJ</label><value>${o.documento || "Não informado"}</value></div>
        <div class="field"><label>Telefone</label><value>${o.telefone || "—"}</value></div>
      </div>
      <h2>Discriminação dos Serviços</h2>
      <table>
        <thead><tr><th>Descrição</th><th>Qtd</th><th>Vlr. Unit.</th><th>Total</th></tr></thead>
        <tbody>
          ${(o.itens || []).map(item => `
            <tr><td>${item.nomePeca}</td><td style="text-align:center">${item.qtdTotal}</td><td style="text-align:right">${fmt(item.valorUnitario)}</td><td style="text-align:right;font-weight:700">${fmt(item.valorItem)}</td></tr>
          `).join("")}
          ${(o.processosSelecionados || []).map(p => `
            <tr><td>Processo: ${p.nome}</td><td style="text-align:center">—</td><td style="text-align:right">—</td><td style="text-align:right">${fmt(p.valorTotal)}</td></tr>
          `).join("")}
        </tbody>
      </table>
      <div class="total-box"><span class="total-label">Total</span><span class="total-value">VALOR TOTAL DOS SERVIÇOS: ${fmt(o.valorTotal)}</span></div>
      <div class="field-row" style="margin-top:24px">
        <div class="field"><label>Base de Cálculo ISS</label><value>${fmt(o.valorTotal)}</value></div>
        <div class="field"><label>Alíquota ISS</label><value>${parseFloat(emp.aliquota_iss || 3).toFixed(2).replace(".",",")}%</value></div>
        <div class="field"><label>Valor ISS</label><value>${fmt(o.valorTotal * 0.03)}</value></div>
      </div>
      <div style="margin-top:20px;padding:14px;background:#f9f7f3;border-radius:6px;font-size:11px;color:#777;text-align:center">
        Este documento é gerado como comprovante de serviços prestados. Para nota fiscal eletrônica oficial, emita via sistema da Prefeitura.
      </div>`;
    setPdfView({ htmlContent: gerarPDF(html, `NFS-e ${String(o.numero).padStart(6, "0")}`), titulo: `NFS-e ${String(o.numero).padStart(6, "0")}` });
  };

  return (
    <div>
      <BtnVoltar onClick={goBack} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: -0.5, color:"#FFF" }}>Ordens de Serviço</h1>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>{data.ordens.length} ordens cadastradas</p>
        </div>
        <Btn onClick={() => setModal({ tipo: "nova" })}>+ Nova OS</Btn>
      </div>
      <div style={{ marginBottom: 16 }}>
        <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar por cliente ou número..."
          style={{ background: "#F4F5F7", border: "1px solid #2a2a3e", borderRadius: 8, padding: "10px 14px", color: "#1C1C2E", fontSize: 13, outline: "none", width: "100%", maxWidth: 380 }} />
      </div>
      {/* Cards de ordens — layout mobile-friendly com todos botões visíveis */}
      {ordens.length === 0 && (
        <Card style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 32, color: "#DDE1E9", marginBottom: 12 }}>◎</div>
          <div style={{ color: "#8892A4", fontSize: 14 }}>Nenhuma ordem encontrada.</div>
        </Card>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {ordens.map((o) => (
          <Card key={o.id} style={{ padding: 0, overflow: "hidden" }}>
            {/* Linha principal */}
            <div style={{ display: "grid", gridTemplateColumns: "80px 1fr auto", alignItems: "center", padding: "14px 18px", gap: 16 }}>
              {/* Número */}
              <div>
                <div style={{ color: "#C06E7A", fontWeight: 900, fontSize: 16, fontFamily: "monospace" }}>
                  #{String(o.numero).padStart(4, "0")}
                </div>
                <div style={{ fontSize: 10, color: "#8892A4", marginTop: 2 }}>{fmtDate(o.dataCriacao)}</div>
              </div>
              {/* Dados */}
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#1C1C2E", marginBottom: 4 }}>{o.cliente}</div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <Badge color={statusColor[o.status] || "#9CA3AF"}>{o.status}</Badge>
                  <span style={{ fontSize: 11, color: "#8892A4" }}>
                    {o.itens?.reduce((a, i) => a + i.qtdTotal, 0) || 0} peças
                  </span>
                  {o.dataEntrega && (
                    <span style={{ fontSize: 11, color: "#8892A4" }}>Entrega: {fmtDate(o.dataEntrega)}</span>
                  )}
                  {o.dataPagamentoPrevista && (
                    <span style={{ fontSize: 11, color: "#8892A4" }}>Pagamento previsto: {fmtDate(o.dataPagamentoPrevista)}</span>
                  )}
                </div>
              </div>
              {/* Valor */}
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 900, fontSize: 18, color: "#00C896" }}>{fmt(o.valorTotal)}</div>
              </div>
            </div>
            {/* Barra de ações — sempre visível */}
            <div style={{ borderTop: "1px solid #1e2030", padding: "10px 18px", background: "#F4F5F780", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => setModal({ tipo: "editar", os: o })}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", background: "#EEF0F5", border: "1px solid #c8a96e44", borderRadius: 7, color: "#C06E7A", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Georgia, serif" }}>
                ✎ Editar OS
              </button>
              <button onClick={() => imprimirOS(o)}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", background: "#EEF0F5", border: "1px solid #4a9eff33", borderRadius: 7, color: "#4F8EF7", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "Georgia, serif" }}>
                ⎙ Imprimir OS
              </button>
              <button onClick={() => imprimirNF(o)}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", background: "#EEF0F5", border: "1px solid #7ecb8f33", borderRadius: 7, color: "#00C896", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "Georgia, serif" }}>
                ◉ Nota Fiscal
              </button>
              <button onClick={() => excluir(o.id)}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", background: "#FFF0F0", border: "1px solid #e05c5c33", borderRadius: 7, color: "#FF6B6B", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "Georgia, serif", marginLeft: "auto" }}>
                ✕ Excluir
              </button>
            </div>
          </Card>
        ))}
      </div>

      {excluirId && (
        <div style={{ position:"fixed", inset:0, background:"#000b", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:"#FFFFFF", border:"1px solid #2a2a3e", borderRadius:14, padding:32, maxWidth:360, width:"100%", textAlign:"center" }}>
            <div style={{ fontSize:36, color:"#FF6B6B", marginBottom:16 }}>✕</div>
            <div style={{ fontWeight:800, fontSize:16, color:"#1C1C2E", marginBottom:8 }}>Excluir esta OS?</div>
            <div style={{ fontSize:13, color:"#9CA3AF", marginBottom:24 }}>Esta ação não pode ser desfeita.</div>
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <button onClick={() => setExcluirId(null)}
                style={{ padding:"9px 24px", background:"#EEF0F5", border:"1px solid #2a2a3e", borderRadius:8, color:"#9CA3AF", fontSize:13, cursor:"pointer", fontFamily:"Georgia, serif" }}>
                Cancelar
              </button>
              <button onClick={confirmarExcluirOS}
                style={{ padding:"9px 24px", background:"#FFF0F0", border:"1px solid #e05c5c55", borderRadius:8, color:"#FF6B6B", fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Georgia, serif" }}>
                Excluir OS
              </button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <ModalOS
          os={modal.os || null}
          pecas={data.pecas}
          processos={data.processos}
          onSave={salvarOrdem}
          onClose={() => setModal(null)}
        />
      )}
      {pdfView && <PDFViewer htmlContent={pdfView.htmlContent} titulo={pdfView.titulo} onClose={() => setPdfView(null)} />}
    </div>
  );
}

// ─── Modal de Ordem de Serviço ────────────────────────────────────────────────
function ModalOS({ os, pecas, processos, onSave, onClose }) {
  const [erroContato, setErroContato] = useState("");
  const [form, setForm] = useState(() => {
    if (!os) return { cliente: "", telefone: "", documento: "", email: "",
      dataCriacao: today(), dataEntrega: "", observacoes: "",
      status: "Aberta", itens: [], processosSelecionados: [] };
    return { ...os, dataPagamentoPrevista: os.dataPagamentoPrevista || "", itens: (os.itens || []).map(i => ({ ...i, itemId: i.itemId || genId() })) };
  });

  const [novoPecaId, setNovoPecaId] = useState(String(pecas[0]?.id || ""));
  const [novoGrade, setNovoGrade] = useState({});
  const [editandoItemId, setEditandoItemId] = useState(null); // itemId em edição inline
  const [procSel, setProcSel] = useState(() => {
    if (!os?.processosSelecionados?.length) return new Set();
    return new Set(os.processosSelecionados.map(p => String(p.id)));
  });

  // Processos disponíveis para a peça atual
  const pecaAtual = pecas.find(p => String(p.id) === novoPecaId);
  const processosDisponiveis = processos.filter(p => String(p.pecaId) === novoPecaId);

  const toggleProc = (id) => {
    const sid = String(id);
    setProcSel(prev => {
      const next = new Set(prev);
      next.has(sid) ? next.delete(sid) : next.add(sid);
      return next;
    });
  };

  const calcValorItem = (item) => {
    const peca = pecas.find(p => String(p.id) === String(item.pecaId));
    if (!peca) return { ...item, qtdTotal: 0, valorItem: 0 };
    const qtdTotal = Object.values(item.grade || {}).reduce((s, v) => s + (parseInt(v) || 0), 0);
    // Processos vinculados a essa peça que estão selecionados
    const procsItem = processos.filter(p => String(p.pecaId) === String(peca.id) && procSel.has(String(p.id)));
    const addProc = procsItem.reduce((s, p) => s + (parseFloat(p.percentual) || 0), 0);
    return { ...item, qtdTotal, valorItem: (peca.valor + addProc) * qtdTotal, nomePeca: peca.nome, valorUnitario: peca.valor };
  };

  const adicionarItem = () => {
    if (!pecaAtual) return;
    const qtd = Object.values(novoGrade).reduce((s, v) => s + (parseInt(v) || 0), 0);
    if (qtd === 0) return alert("Informe pelo menos uma quantidade na grade.");
    const item = calcValorItem({ pecaId: novoPecaId, grade: { ...novoGrade }, itemId: genId() });
    setForm(f => ({ ...f, itens: [...(f.itens || []), item] }));
    setNovoGrade({});
  };

  const removerItem = (itemId) => setForm(f => ({ ...f, itens: f.itens.filter(i => i.itemId !== itemId) }));

  const calcTotal = () => {
    const itens = (form.itens || []).map(calcValorItem);
    const valorTotal = itens.reduce((s, i) => s + i.valorItem, 0);
    const processosSelecionados = processos
      .filter(p => procSel.has(String(p.id)))
      .map(p => ({ ...p, id: p.id }));
    return { itens, valorTotal, processosSelecionados };
  };

  const salvar = () => {
    if (!form.cliente.trim()) return alert("Informe o nome do cliente.");
    if (!(form.itens || []).length) return alert("Adicione pelo menos um item.");
    const calc = calcTotal();
    onSave({ ...form, ...calc });
  };

  const importarContato = async () => {
    setErroContato("");
    try {
      const contact = await ContactPicker.pickContact();
      if (contact.cancelled) return;
      setForm(current => ({
        ...current,
        cliente: contact.name || current.cliente,
        telefone: contact.phone || current.telefone,
      }));
    } catch (error) {
      if (error?.name === "AbortError") return;
      setErroContato(error?.message || "Não foi possível abrir os contatos do aparelho.");
    }
  };

  const addProcsPreview = processosDisponiveis
    .filter(p => procSel.has(String(p.id)))
    .reduce((s, p) => s + (parseFloat(p.percentual) || 0), 0);
  const valorUnitPreview = (pecaAtual?.valor || 0) + addProcsPreview;
  const qtdPreview = Object.values(novoGrade).reduce((s, v) => s + (parseInt(v) || 0), 0);

  return (
    <Modal title={os ? `✎ Editar OS #${String(os.numero).padStart(4,"0")}` : "Nova Ordem de Serviço"} onClose={onClose}>
      {/* Dados do cliente */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <div>
          <Input label="Cliente *" value={form.cliente} onChange={e => setForm(f => ({ ...f, cliente: e.target.value }))} />
          <button type="button" onClick={importarContato}
            style={{ marginTop: 6, padding: "7px 10px", background: "#F4F5F7", border: "1px solid #C06E7A55", borderRadius: 7, color: "#C06E7A", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            ☎ Importar dos contatos
          </button>
          {erroContato && <div role="status" style={{ marginTop: 6, color: "#D14343", fontSize: 11 }}>{erroContato}</div>}
        </div>
        <Input label="Telefone" value={form.telefone} onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))} />
        <Input label="CNPJ / CPF" value={form.documento} onChange={e => setForm(f => ({ ...f, documento: e.target.value }))} />
        <Input label="E-mail" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        <Input label="Data de Criação" type="date" value={form.dataCriacao} onChange={e => setForm(f => ({ ...f, dataCriacao: e.target.value }))} />
        <Input label="Previsão de Entrega" type="date" value={form.dataEntrega} onChange={e => setForm(f => ({ ...f, dataEntrega: e.target.value }))} />
        <Input label="Previsão de Pagamento" type="date" value={form.dataPagamentoPrevista} onChange={e => setForm(f => ({ ...f, dataPagamentoPrevista: e.target.value }))} />
      </div>
      <Select label="Status" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
        options={["Aberta","Em Produção","Finalizada","Entregue","Cancelada"].map(s => ({ value: s, label: s }))} />

      {/* Bloco de adição de item */}
      <div style={{ background: "#0a0a0a", borderRadius: 10, padding: 16, marginBottom: 16, border: "1px solid #1e2030" }}>
        <label style={{ display: "block", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#C06E7A", marginBottom: 12, fontWeight: 700 }}>
          ◇ Adicionar Item
        </label>

        {/* Seleção de peça */}
        <Select label="Tipo de Peça" value={novoPecaId}
          onChange={e => { setNovoPecaId(e.target.value); setNovoGrade({}); }}
          options={pecas.map(p => ({ value: String(p.id), label: `${p.nome} · ${fmt(p.valor)}` }))} />

        {/* Grade de tamanhos */}
        <label style={{ display: "block", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#f5eaea", marginBottom: 8, fontWeight: 700 }}>
          Grade de Tamanhos
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(66px,1fr))", gap: 7, marginBottom: 12 }}>
          {GRADES.map(g => (
            <div key={g} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#8892A4", marginBottom: 3, fontWeight: 700 }}>{g}</div>
              <input type="number" min="0" value={novoGrade[g] || ""}
                onChange={e => setNovoGrade(n => ({ ...n, [g]: parseInt(e.target.value) || 0 }))}
                style={{ width: "100%", background: "#f7f4f4", border: `1px solid ${novoGrade[g] > 0 ? "#C06E7A66" : "#DDE1E9"}`, borderRadius: 6, padding: "6px 4px", color: "#1C1C2E", fontSize: 13, textAlign: "center", outline: "none" }} />
            </div>
          ))}
        </div>

        {/* Preview do total */}
        {qtdPreview > 0 && pecaAtual && (
          <div style={{ display: "flex", gap: 20, background: "#FFFFFF", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12 }}>
            <div><span style={{ color: "#8892A4" }}>Qtd: </span><strong style={{ color: "#FFF" }}>{qtdPreview} pcs</strong></div>
            <div><span style={{ color: "#8892A4" }}>Vlr/pc: </span><strong style={{ color: "#C06E7A" }}>{fmt(valorUnitPreview)}</strong></div>
            <div><span style={{ color: "#8892A4" }}>Subtotal: </span><strong style={{ color: "#00C896" }}>{fmt(valorUnitPreview * qtdPreview)}</strong></div>
          </div>
        )}

        <Btn onClick={adicionarItem} style={{ width: "100%" }}>+ Adicionar Item à Ordem</Btn>
      </div>

      {/* Itens já adicionados */}
      {(form.itens || []).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#C06E7A", marginBottom: 8, fontWeight: 700 }}>
            Itens da Ordem ({form.itens.length})
          </label>
          {form.itens.map(item => {
            const ic = calcValorItem(item);
            const editando = editandoItemId === item.itemId;
            return (
              <div key={item.itemId} style={{ background: "#F4F5F7", borderRadius: 8, marginBottom: 8, border: `1px solid ${editando ? "#C06E7A66" : "#EAECF0"}` }}>
                {/* Cabeçalho do item */}
                <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{ic.nomePeca}</div>
                    <div style={{ fontSize: 11, color: "#8892A4", marginTop: 2 }}>
                      {GRADES.filter(g => (item.grade?.[g] || 0) > 0).map(g => `${g}:${item.grade[g]}`).join(" · ")} — {ic.qtdTotal} pcs
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 800, color: "#00C896", fontSize: 14 }}>{fmt(ic.valorItem)}</span>
                    <Btn variant="ghost" style={{ padding: "3px 8px", fontSize: 11 }}
                      onClick={() => setEditandoItemId(editando ? null : item.itemId)}>
                      {editando ? "✓ Ok" : "✎"}
                    </Btn>
                    <Btn variant="danger" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => removerItem(item.itemId)}>✕</Btn>
                  </div>
                </div>
                {/* Grade editável inline */}
                {editando && (
                  <div style={{ padding: "0 14px 14px", borderTop: "1px solid #1e2030" }}>
                    <div style={{ fontSize: 10, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 1, margin: "10px 0 8px", fontWeight: 700 }}>Editar grade</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(62px,1fr))", gap: 6 }}>
                      {GRADES.map(g => (
                        <div key={g} style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 10, color: "#8892A4", marginBottom: 3, fontWeight: 700 }}>{g}</div>
                          <input type="number" min="0"
                            value={item.grade?.[g] || ""}
                            onChange={e => {
                              const val = parseInt(e.target.value) || 0;
                              setForm(f => ({ ...f, itens: f.itens.map(i =>
                                i.itemId === item.itemId
                                  ? { ...i, grade: { ...i.grade, [g]: val } }
                                  : i
                              )}));
                            }}
                            style={{ width: "100%", background: "#FFFFFF", border: `1px solid ${(item.grade?.[g] || 0) > 0 ? "#C06E7A66" : "#DDE1E9"}`, borderRadius: 6, padding: "5px 3px", color: "#1C1C2E", fontSize: 13, textAlign: "center", outline: "none" }} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ textAlign: "right", fontWeight: 800, fontSize: 16, color: "#C06E7A", padding: "8px 0" }}>
            Total: {fmt(calcTotal().valorTotal)}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "block", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#C06E7A", marginBottom: 5, fontWeight: 700 }}>Observações</label>
        <textarea value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))}
          rows={3} style={{ width: "100%", background: "#F4F5F7", border: "1px solid #2a2a3e", borderRadius: 6, padding: "9px 12px", color: "#1C1C2E", fontSize: 13, outline: "none", resize: "vertical" }} />
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn onClick={salvar}>{os ? "Salvar Edição" : "Salvar Ordem"}</Btn>
      </div>
    </Modal>
  );
}

// ─── Tipos de Peças ───────────────────────────────────────────────────────────
function Pecas({ pecas, save, goBack }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ nome: "", valor: "" });

  const abrir = (p) => { setForm(p ? { ...p } : { nome: "", valor: "" }); setModal(p || "nova"); };
  const salvar = () => {
    if (!form.nome || !form.valor) return alert("Preencha todos os campos.");
    const lista = form.id
      ? pecas.map((p) => p.id === form.id ? form : p)
      : [...pecas, { ...form, id: genId(), valor: parseFloat(form.valor) }];
    save(lista); setModal(null);
  };
  const [excluirPecaId, setExcluirPecaId] = useState(null);
  const excluir = (id) => setExcluirPecaId(id);
  const confirmarExcluirPeca = () => {
    save(pecas.filter(p => p.id !== excluirPecaId));
    setExcluirPecaId(null);
  };

  return (
    <div>
      <BtnVoltar onClick={goBack} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: -0.5, color:"#FFF" }}>Tipos de Peças</h1>
        <Btn onClick={() => abrir(null)}>+ Nova Peça</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 14 }}>
        {pecas.map((p) => (
          <Card key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{p.nome}</div>
              <div style={{ color: "#00C896", fontWeight: 800, fontSize: 18, marginTop: 4 }}>{fmt(p.valor)}</div>
              <div style={{ fontSize: 10, color: "#8892A4", marginTop: 2 }}>por peça</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Btn variant="ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => abrir(p)}>✎</Btn>
              <Btn variant="danger" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => excluir(p.id)}>✕</Btn>
            </div>
          </Card>
        ))}
      </div>
      {excluirPecaId && (
        <div style={{ position:"fixed", inset:0, background:"#1C1C2E66", backdropFilter:"blur(4px)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:"#FFF", borderRadius:20, padding:32, maxWidth:360, width:"100%", textAlign:"center", boxShadow:"0 20px 60px #1C1C2E22" }}>
            <div style={{ width:56, height:56, background:"#FFF0F0", borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24, margin:"0 auto 16px" }}>✕</div>
            <div style={{ fontWeight:800, fontSize:17, color:"#1C1C2E", marginBottom:8 }}>Excluir peça?</div>
            <div style={{ fontSize:13, color:"#8892A4", marginBottom:24 }}>Esta ação não pode ser desfeita.</div>
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <Btn variant="ghost" onClick={() => setExcluirPecaId(null)}>Cancelar</Btn>
              <Btn variant="danger" onClick={confirmarExcluirPeca}>Excluir</Btn>
            </div>
          </div>
        </div>
      )}
      {modal && (
        <Modal title={form.id ? "Editar Peça" : "Nova Peça"} onClose={() => setModal(null)}>
          <Input label="Nome da Peça" value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
          <Input label="Valor (R$)" type="number" step="0.01" value={form.valor} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <Btn variant="ghost" onClick={() => setModal(null)}>Cancelar</Btn>
            <Btn onClick={salvar}>Salvar</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Processos ────────────────────────────────────────────────────────────────
function Processos({ processos, pecas, save, goBack }) {
  const [pecaSelecionadaId, setPecaSelecionadaId] = useState(String(pecas[0]?.id || ""));
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState({ nome: "", pecaId: "", quantidade: 1 });
  const [pecaAnterior, setPecaAnterior] = useState(null);
  const [confirmarExcluir, setConfirmarExcluir] = useState(null);

  const pecaAtiva = pecas.find(p => String(p.id) === pecaSelecionadaId);
  const procsAtivos = processos.filter(p => String(p.pecaId) === pecaSelecionadaId);

  const procsDestaPeca = (pecaId, lista) =>
    (lista || processos).filter(p => String(p.pecaId) === String(pecaId));

  const recalcularPeca = (pecaId, lista) => {
    const peca = pecas.find(p => String(p.id) === String(pecaId));
    if (!peca) return lista;
    const procs = procsDestaPeca(pecaId, lista);
    const qtd = procs.length;
    // Valor por processo 
    const valorBase = qtd > 0 ? peca.valor / qtd : 0;
    return lista.map(p => {
      if (String(p.pecaId) !== String(pecaId)) return p;
      const qtdProc = parseInt(p.quantidade) || 1;
      const valorUnit = qtdProc > 0 ? valorBase / qtdProc : valorBase;
      return { ...p, percentual: valorBase, valorProcesso: valorBase, valorUnitario: valorUnit };
    });
  };

  const abrir = (p) => {
    const pecaId = p ? String(p.pecaId || pecaSelecionadaId) : pecaSelecionadaId;
    setForm(p ? { ...p, pecaId } : { nome: "", pecaId, quantidade: 1 });
    setPecaAnterior(p ? pecaId : null);
    setModalAberto(true);
  };

  const fechar = () => {
    setModalAberto(false);
    setForm({ nome: "", pecaId: pecaSelecionadaId, quantidade: 1 });
    setPecaAnterior(null);
  };

  const salvar = () => {
    if (!form.nome.trim()) return alert("Informe o nome do processo.");
    if (!form.quantidade || form.quantidade < 1) return alert("Informe a quantidade.");
    if (!form.pecaId) return alert("Selecione o tipo de peça.");
    let lista = form.id
      ? processos.map(p => p.id === form.id ? { ...form } : p)
      : [...processos, { ...form, id: genId() }];
    lista = recalcularPeca(form.pecaId, lista);
    if (form.id && pecaAnterior && String(pecaAnterior) !== String(form.pecaId)) {
      lista = recalcularPeca(pecaAnterior, lista);
    }
    save(lista);
    fechar();
  };

  const excluir = (proc) => {
    setConfirmarExcluir(proc);
  };

  const confirmarExclusao = () => {
    if (!confirmarExcluir) return;
    let lista = processos.filter(p => p.id !== confirmarExcluir.id);
    lista = recalcularPeca(confirmarExcluir.pecaId, lista);
    save(lista);
    setConfirmarExcluir(null);
  };

  const pSel = pecas.find(p => String(p.id) === String(form.pecaId));
  const qtdAtual = procsDestaPeca(form.pecaId).length;
  const divisorPreview = form.id ? qtdAtual : qtdAtual + 1;
  const valorBasePreview = pSel && divisorPreview > 0 ? pSel.valor / divisorPreview : 0;
  const qtdProcPreview = parseInt(form.quantidade) || 1;
  const valorPreview = qtdProcPreview > 0 ? valorBasePreview / qtdProcPreview : valorBasePreview;
  const valorCadaAtivo = pecaAtiva && procsAtivos.length > 0 ? pecaAtiva.valor / procsAtivos.length : 0;

  return (
    <div>
      <BtnVoltar onClick={goBack} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: -0.5, color:"#FFF" }}>Tipos de Processo</h1>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Valor por processo </p>
        </div>
        <Btn onClick={() => abrir(null)}>+ Novo Processo</Btn>
      </div>

      {/* Seletor de peça — dropdown */}
      <div style={{ marginBottom: 24, maxWidth: 420 }}>
        <label style={{ display: "block", fontSize: 15, letterSpacing: 1, textTransform: "uppercase", color: "#C06E7A", marginBottom: 8, fontWeight: 700 }}>
          Selecionar a Peça:
        </label>
        <select
          value={pecaSelecionadaId}
          onChange={e => setPecaSelecionadaId(e.target.value)}
          style={{ width: "100%", background: "#F4F5F7", border: "1px solid #2a2a3e", borderRadius: 8, padding: "11px 14px", color: "#1C1C2E", fontSize: 14, outline: "none", cursor: "pointer" }}>
          {pecas.map(p => {
            const qtd = processos.filter(x => String(x.pecaId) === String(p.id)).length;
            return (
              <option key={p.id} value={String(p.id)}>
                {p.nome} · R$ {parseFloat(p.valor).toFixed(2).replace(".", ",")} · {qtd} processo{qtd !== 1 ? "s" : ""}
              </option>
            );
          })}
        </select>
      </div>

      {/* Painel da peça selecionada */}
      {pecaAtiva && (
        <div>
          {/* Cabeçalho com fórmula */}
          <div style={{ background: "#FFFFFF", border: "1px solid #1e2030", borderRadius: 10, padding: "16px 20px", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 4, height: 32, background: "#C06E7A", borderRadius: 2 }} />
                <div>
                  <div style={{ fontWeight: 800, fontSize: 17, color: "#FFF" }}>{pecaAtiva.nome}</div>
                  <div style={{ fontSize: 11, color: "#8892A4", marginTop: 2 }}>
                    {procsAtivos.length} processo{procsAtivos.length !== 1 ? "s" : ""} cadastrado{procsAtivos.length !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>
              {procsAtivos.length > 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: "#8892A4", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Valor da peça</div>
                    <div style={{ fontWeight: 900, fontSize: 20, color: "#C06E7A" }}>{fmt(pecaAtiva.valor)}</div>
                  </div>
                  <div style={{ color: "#6B7280", fontSize: 26, fontWeight: 200 }}>÷</div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: "#8892A4", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Processos</div>
                    <div style={{ fontWeight: 900, fontSize: 20, color: "#EEC4C8" }}>{procsAtivos.length}</div>
                  </div>
                  <div style={{ color: "#6B7280", fontSize: 26, fontWeight: 200 }}>=</div>
                  <div style={{ textAlign: "center", background: "#00C89618", border: "1px solid #7ecb8f33", borderRadius: 8, padding: "8px 16px" }}>
                    <div style={{ fontSize: 9, color: "#00C89688", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Cada processo vale</div>
                    <div style={{ fontWeight: 900, fontSize: 24, color: "#00C896" }}>{fmt(valorCadaAtivo)}</div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "#8892A4" }}>
                  Nenhum processo ainda. Clique em <strong style={{ color: "#C06E7A" }}>+ Novo Processo</strong>.
                </div>
              )}
            </div>
          </div>

          {/* Cards dos processos */}
          {procsAtivos.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
              {procsAtivos.map((p, i) => (
                <Card key={p.id} style={{ padding: 16, borderLeft: "3px solid #c8a96e44" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 9, color: "#8892A4", marginBottom: 5, textTransform: "uppercase", letterSpacing: 1 }}>
                        {i + 1} / {procsAtivos.length}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#1C1C2E", marginBottom: 12 }}>{p.nome}</div>
                      <div style={{ fontWeight: 900, fontSize: 22, color: "#00C896" }}>{fmt(valorCadaAtivo)}</div>
                      <div style={{ fontSize: 10, color: "#8892A4", marginTop: 2 }}>por peça</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <Btn variant="ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => abrir(p)}>✎</Btn>
                      <Btn variant="danger" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => excluir(p)}>✕</Btn>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {pecas.length === 0 && (
        <Card style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 40, color: "#EAECF0", marginBottom: 12 }}>◇</div>
          <div style={{ color: "#8892A4", fontSize: 14, marginBottom: 6 }}>Nenhuma peça cadastrada.</div>
          <div style={{ color: "#6B7280", fontSize: 12 }}>Cadastre peças primeiro em "Tipos de Peças".</div>
        </Card>
      )}

      {/* Modal */}
      {/* Modal confirmação de exclusão */}
      {confirmarExcluir && (
        <div style={{ position:"fixed", inset:0, background:"#000b", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:"#FFFFFF", border:"1px solid #2a2a3e", borderRadius:14, padding:32, maxWidth:380, width:"100%", textAlign:"center" }}>
            <div style={{ fontSize:36, color:"#FF6B6B", marginBottom:16 }}>✕</div>
            <div style={{ fontWeight:800, fontSize:16, color:"#1C1C2E", marginBottom:8 }}>Excluir processo?</div>
            <div style={{ fontSize:13, color:"#9CA3AF", marginBottom:6 }}>
              <strong style={{ color:"#C06E7A" }}>{confirmarExcluir.nome}</strong>
            </div>
            <div style={{ fontSize:11, color:"#8892A4", marginBottom:24 }}>
              Os demais processos desta peça serão recalculados automaticamente.
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <button onClick={() => setConfirmarExcluir(null)}
                style={{ padding:"9px 24px", background:"#EEF0F5", border:"1px solid #2a2a3e", borderRadius:8, color:"#9CA3AF", fontSize:13, cursor:"pointer", fontFamily:"Georgia, serif" }}>
                Cancelar
              </button>
              <button onClick={confirmarExclusao}
                style={{ padding:"9px 24px", background:"#FFF0F0", border:"1px solid #e05c5c55", borderRadius:8, color:"#FF6B6B", fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Georgia, serif" }}>
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {modalAberto && (
        <Modal title={form.id ? "Editar Processo" : "Novo Processo"} onClose={fechar}>
          <Select label="Tipo de Peça *"
            value={form.pecaId}
            onChange={e => setForm(f => ({ ...f, pecaId: e.target.value }))}
            options={pecas.map(p => ({ value: String(p.id), label: `${p.nome} · ${fmt(p.valor)}` }))}
          />
          <Input label="Nome do Processo *" value={form.nome}
            onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
            placeholder="Ex: Costura Overlock, Bordado, Acabamento..." />

          {form.pecaId && pSel && (
            <div style={{ background: "#F4F5F7", borderRadius: 10, padding: 20, marginBottom: 16, border: "1px solid #1e2030" }}>
              <div style={{ fontSize: 10, color: "#8892A4", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16 }}>
                Cálculo automático ao salvar
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#6B7280", marginBottom: 6 }}>Valor da peça</div>
                  <div style={{ fontWeight: 800, fontSize: 20, color: "#C06E7A" }}>{fmt(pSel.valor)}</div>
                </div>
                <div style={{ color: "#6B7280", fontSize: 28, fontWeight: 200 }}>÷</div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#6B7280", marginBottom: 6 }}>Nº de processos</div>
                  <div style={{ fontWeight: 800, fontSize: 20, color: "#EEC4C8" }}>{divisorPreview}</div>
                  <div style={{ fontSize: 9, color: "#6B7280", marginTop: 3 }}>
                    {qtdAtual} atual{!form.id ? " + 1 novo" : ""}
                  </div>
                </div>
                <div style={{ color: "#6B7280", fontSize: 28, fontWeight: 200 }}>=</div>
                <div style={{ textAlign: "center", background: "#00C89618", border: "1px solid #7ecb8f44", borderRadius: 10, padding: "10px 20px" }}>
                  <div style={{ fontSize: 10, color: "#00C89688", marginBottom: 6 }}>Cada processo vale</div>
                  <div style={{ fontWeight: 900, fontSize: 28, color: "#00C896" }}>{fmt(valorPreview)}</div>
                </div>
              </div>
              {qtdAtual > 0 && !form.id && (
                <div style={{ marginTop: 14, padding: "9px 14px", background: "#FFFFFF", borderRadius: 8, fontSize: 11, color: "#8892A4", textAlign: "center" }}>
                  ⚠ Os {qtdAtual} processo{qtdAtual > 1 ? "s" : ""} já cadastrado{qtdAtual > 1 ? "s" : ""} desta peça também serão atualizados para {fmt(valorPreview)}/pc.
                </div>
              )}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="ghost" onClick={fechar}>Cancelar</Btn>
            <Btn onClick={salvar}>Salvar Processo</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}


// ─── Ponto ────────────────────────────────────────────────────────────────────
const EVENTOS_PONTO = [
  { id: "entrada",  label: "Entrada",  icon: "▶", color: "#00C896", desc: "Início do trabalho" },
  { id: "pausa",    label: "Pausa",    icon: "⏸", color: "#FF8C42", desc: "Intervalo / almoço" },
  { id: "retorno",  label: "Retorno",  icon: "⏭", color: "#4F8EF7", desc: "Volta da pausa" },
  { id: "saida",    label: "Saída",    icon: "⏹", color: "#FF6B6B", desc: "Fim do trabalho" },
];

function calcularHoras(registros) {
  let total = 0, entrada = null;
  const sorted = [...registros].sort((a, b) => a.hora.localeCompare(b.hora));
  for (const r of sorted) {
    if (r.evento === "entrada" || r.evento === "retorno") entrada = r.hora;
    if ((r.evento === "pausa" || r.evento === "saida") && entrada) {
      const [h1, m1] = entrada.split(":").map(Number);
      const [h2, m2] = r.hora.split(":").map(Number);
      total += (h2 * 60 + m2) - (h1 * 60 + m1);
      entrada = null;
    }
  }
  const h = Math.floor(Math.max(total, 0) / 60);
  const m = Math.max(total, 0) % 60;
  return total > 0 ? `${String(h).padStart(2,"0")}h${String(m).padStart(2,"0")}` : "—";
}

function getStatusAtual(registros) {
  if (!registros.length) return null;
  return [...registros].sort((a, b) => a.hora.localeCompare(b.hora)).at(-1).evento;
}

function Ponto({ costureiras, pontos, saveCostureiras, savePontos, goBack }) {
  const [aba, setAba] = useState("registrar");
  const [modalCost, setModalCost] = useState(false);
  const [formCost, setFormCost] = useState({ nome: "", funcao: "", telefone: "" });
  const [dataFiltro, setDataFiltro] = useState(today());
  const [horaManual, setHoraManual] = useState("");
  const [confirma, setConfirma] = useState(null);

  const horaAgora = () => new Date().toTimeString().slice(0, 5);

  const registrar = (costureira, evento) => {
    const hora = horaManual || horaAgora();
    const novo = { id: genId(), costureiraId: costureira.id, costureiraName: costureira.nome,
      data: dataFiltro, hora, evento, registradoEm: new Date().toISOString() };
    savePontos([...pontos, novo]);
    setConfirma({ nome: costureira.nome, evento, hora });
    setHoraManual("");
    setTimeout(() => setConfirma(null), 2500);
  };

  const excluirPonto = (id) => savePontos(pontos.filter(p => p.id !== id));

  const salvarCostureira = () => {
    if (!formCost.nome.trim()) return alert("Informe o nome.");
    const lista = formCost.id
      ? costureiras.map(c => c.id === formCost.id ? formCost : c)
      : [...costureiras, { ...formCost, id: genId() }];
    saveCostureiras(lista);
    setModalCost(false);
    setFormCost({ nome: "", funcao: "", telefone: "" });
  };

  const pontosDia = pontos.filter(p => p.data === dataFiltro);
  const evCor  = { entrada: "#00C896", pausa: "#FF8C42", retorno: "#4F8EF7", saida: "#FF6B6B" };
  const evIcon = { entrada: "▶", pausa: "⏸", retorno: "⏭", saida: "⏹" };

  const historico = {};
  pontos.forEach(p => {
    if (!historico[p.data]) historico[p.data] = {};
    if (!historico[p.data][p.costureiraId])
      historico[p.data][p.costureiraId] = { nome: p.costureiraName, regs: [] };
    historico[p.data][p.costureiraId].regs.push(p);
  });
  const datasHist = Object.keys(historico).sort((a, b) => b.localeCompare(a));

  const abaStyle = id => ({
    padding: "9px 18px", border: "none", cursor: "pointer", background: "transparent",
    color: aba === id ? "#C06E7A" : "#8892A4", fontWeight: aba === id ? 700 : 400,
    fontSize: 13, borderBottom: aba === id ? "2px solid #9C8FFF" : "2px solid transparent",
    fontFamily: "Georgia, serif", whiteSpace: "nowrap", transition: "all 0.15s",
  });

  return (
    <div>
      <BtnVoltar onClick={goBack} />
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div>
          <h1 style={{ color:"#f8fafc",fontSize:25, fontWeight:900, letterSpacing:-0.5 }}>Controle de Ponto</h1>
          <p style={{ color:"#666768", fontSize:13 }}>Registro de jornada das costureiras</p>
        </div>
        <Btn onClick={() => { setFormCost({ nome:"", funcao:"", telefone:"" }); setModalCost(true); }}>
          + Nova Costureira
        </Btn>
      </div>

      <div style={{ borderBottom:"1px solid #080808", marginBottom:20, display:"flex" }}>
        {[["registrar","⏱ Registrar Ponto"],["historico","◎ Histórico"],["costureiras","◇ Costureiras"]].map(([id,l]) => (
          <button key={id} style={abaStyle(id)} onClick={() => setAba(id)}>{l}</button>
        ))}
      </div>

      {/* ── REGISTRAR ─────────────────────────────────────────────────────── */}
      {aba === "registrar" && (
        <div>
          <Card style={{ marginBottom:16, padding:16 }}>
            <div style={{ display:"flex", gap:16, alignItems:"flex-end", flexWrap:"wrap" }}>
              <div>
                <label style={{ display:"block", fontSize:10, color:"#C06E7A", textTransform:"uppercase", letterSpacing:1, marginBottom:5, fontWeight:700 }}>Data</label>
                <input type="date" value={dataFiltro} onChange={e => setDataFiltro(e.target.value)}
                  style={{ background:"#F4F5F7", border:"1px solid #2a2a3e", borderRadius:6, padding:"8px 12px", color:"#1C1C2E", fontSize:13, outline:"none" }} />
              </div>
              <div>
                <label style={{ display:"block", fontSize:10, color:"#C06E7A", textTransform:"uppercase", letterSpacing:1, marginBottom:5, fontWeight:700 }}>Hora manual</label>
                <input type="time" value={horaManual} onChange={e => setHoraManual(e.target.value)}
                  style={{ background:"#F4F5F7", border:"1px solid #2a2a3e", borderRadius:6, padding:"8px 12px", color:"#1C1C2E", fontSize:13, outline:"none" }} />
              </div>
              <div style={{ fontSize:12, color:"#8892A4" }}>
                Sem hora manual usa <strong style={{ color:"#C06E7A" }}>{horaAgora()}</strong>
              </div>
            </div>
          </Card>

          {confirma && (
            <div style={{ background:"#00C89618", border:"1px solid #7ecb8f44", borderRadius:10, padding:"12px 18px", marginBottom:16, display:"flex", alignItems:"center", gap:12 }}>
              <span style={{ fontSize:22, color:"#00C896" }}>✓</span>
              <div>
                <div style={{ fontWeight:700, color:"#00C896", fontSize:14 }}>Ponto registrado!</div>
                <div style={{ fontSize:12, color:"#00C89688" }}>{confirma.nome} — {confirma.evento} às {confirma.hora}</div>
              </div>
            </div>
          )}

          {costureiras.length === 0 ? (
            <Card style={{ textAlign:"center", padding:48 }}>
              <div style={{ fontSize:36, color:"#EAECF0", marginBottom:12 }}>⏱</div>
              <div style={{ color:"#8892A4", fontSize:14 }}>Nenhuma costureira cadastrada.</div>
              <div style={{ color:"#6B7280", fontSize:12, marginTop:6 }}>Clique em "+ Nova Costureira" para começar.</div>
            </Card>
          ) : costureiras.map(c => {
            const regs = pontosDia.filter(p => p.costureiraId === c.id);
            const status = getStatusAtual(regs);
            const horas  = calcularHoras(regs);
            const pode = {
              entrada: !status || status === "saida",
              pausa:   status === "entrada" || status === "retorno",
              retorno: status === "pausa",
              saida:   status === "entrada" || status === "retorno",
            };
            return (
              <Card key={c.id} style={{ marginBottom:10, padding:0, overflow:"hidden", borderLeft:`3px solid ${status ? evCor[status] : "#DDE1E9"}` }}>
                <div style={{ padding:"14px 18px", display:"grid", gridTemplateColumns:"1fr auto", gap:12, alignItems:"center" }}>
                  <div>
                    <div style={{ fontWeight:800, fontSize:15, marginBottom:6 }}>{c.nome}</div>
                    <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap", marginBottom:8 }}>
                      {c.funcao && <span style={{ fontSize:11, color:"#8892A4" }}>{c.funcao}</span>}
                      {status ? (
                        <span style={{ background:evCor[status]+"22", color:evCor[status], padding:"2px 10px", borderRadius:20, fontSize:10, fontWeight:700 }}>
                          {evIcon[status]} {status.charAt(0).toUpperCase()+status.slice(1)}
                        </span>
                      ) : (
                        <span style={{ color:"#6B7280", fontSize:11 }}>Sem registro hoje</span>
                      )}
                    </div>
                    {regs.length > 0 && (
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                        {[...regs].sort((a,b)=>a.hora.localeCompare(b.hora)).map(r => (
                          <div key={r.id} style={{ display:"flex", alignItems:"center", gap:4, background:"#F4F5F7", borderRadius:6, padding:"3px 8px", border:`1px solid ${evCor[r.evento]}33` }}>
                            <span style={{ color:evCor[r.evento], fontSize:10 }}>{evIcon[r.evento]}</span>
                            <span style={{ fontSize:11, color:"#080808", fontFamily:"monospace" }}>{r.hora}</span>
                            <button onClick={() => excluirPonto(r.id)}
                              style={{ background:"transparent", border:"none", color:"#8892A4", cursor:"pointer", fontSize:10, paddingLeft:4 }}>✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:9, color:"#8892A4", textTransform:"uppercase", letterSpacing:1, marginBottom:2 }}>Horas hoje</div>
                    <div style={{ fontWeight:900, fontSize:24, color:horas!=="—"?"#00C896":"#6B7280" }}>{horas}</div>
                  </div>
                </div>
                {/* Botões de evento */}
                <div style={{ borderTop:"1px solid #1e2030", padding:"10px 18px", background:"#F4F5F766", display:"flex", gap:8, flexWrap:"wrap" }}>
                  {EVENTOS_PONTO.map(ev => (
                    <button key={ev.id} onClick={() => pode[ev.id] && registrar(c, ev.id)}
                      style={{
                        padding:"8px 16px", borderRadius:8, cursor:pode[ev.id]?"pointer":"not-allowed",
                        border:`1px solid ${pode[ev.id]?ev.color+"55":"#EAECF0"}`,
                        background:pode[ev.id]?ev.color+"18":"transparent",
                        color:pode[ev.id]?ev.color:"#6B7280", fontSize:12, fontWeight:700,
                        fontFamily:"Georgia, serif", opacity:pode[ev.id]?1:0.4, transition:"all 0.15s",
                        display:"flex", alignItems:"center", gap:6,
                      }}>
                      {ev.icon} {ev.label}
                    </button>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── HISTÓRICO ─────────────────────────────────────────────────────── */}
      {aba === "historico" && (
        <div>
          {datasHist.length === 0 ? (
            <Card style={{ textAlign:"center", padding:40 }}>
              <div style={{ color:"#8892A4" }}>Nenhum registro ainda.</div>
            </Card>
          ) : datasHist.map(dt => (
            <div key={dt} style={{ marginBottom:20 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                <div style={{ width:4, height:18, background:"#C06E7A", borderRadius:2 }} />
                <span style={{ fontWeight:800, fontSize:15 }}>
                  {new Date(dt + "T12:00:00").toLocaleDateString("pt-BR", { weekday:"long", day:"2-digit", month:"long", year:"numeric" })}
                </span>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:8, paddingLeft:8 }}>
                {Object.values(historico[dt]).map((entry, i) => {
                  const horas = calcularHoras(entry.regs);
                  const sortedR = [...entry.regs].sort((a,b)=>a.hora.localeCompare(b.hora));
                  return (
                    <Card key={i} style={{ padding:14 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                        <div style={{ flex:1 }}>
                          <div style={{ fontWeight:700, fontSize:14, marginBottom:8 }}>{entry.nome}</div>
                          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                            {sortedR.map((r,j) => (
                              <div key={j} style={{ display:"flex", alignItems:"center", gap:5, background:"#F4F5F7", borderRadius:6, padding:"4px 10px", border:`1px solid ${evCor[r.evento]}33` }}>
                                <span style={{ color:evCor[r.evento], fontSize:11 }}>{evIcon[r.evento]}</span>
                                <span style={{ fontSize:12, color:"#C06E7A", fontFamily:"monospace", fontWeight:700 }}>{r.hora}</span>
                                <span style={{ fontSize:10, color:"#8892A4" }}>{r.evento}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div style={{ textAlign:"right", flexShrink:0, marginLeft:16 }}>
                          <div style={{ fontSize:9, color:"#8892A4", textTransform:"uppercase", letterSpacing:1, marginBottom:3 }}>Total</div>
                          <div style={{ fontWeight:900, fontSize:22, color:horas!=="—"?"#00C896":"#6B7280" }}>{horas}</div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── COSTUREIRAS ───────────────────────────────────────────────────── */}
      {aba === "costureiras" && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:12 }}>
          {costureiras.length === 0 && (
            <div style={{ gridColumn:"1/-1" }}>
              <Card style={{ textAlign:"center", padding:48 }}>
                <div style={{ fontSize:36, color:"#EAECF0", marginBottom:12 }}>◇</div>
                <div style={{ color:"#8892A4", fontSize:14 }}>Nenhuma costureira cadastrada.</div>
              </Card>
            </div>
          )}
          {costureiras.map(c => {
            const totalRegs = pontos.filter(p => p.costureiraId === c.id).length;
            const dias = new Set(pontos.filter(p => p.costureiraId === c.id).map(p => p.data)).size;
            return (
              <Card key={c.id} style={{ padding:16 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:800, fontSize:15, marginBottom:4 }}>{c.nome}</div>
                    {c.funcao && <div style={{ fontSize:12, color:"#C06E7A", marginBottom:4 }}>{c.funcao}</div>}
                    {c.telefone && <div style={{ fontSize:11, color:"#8892A4", marginBottom:10 }}>{c.telefone}</div>}
                    <div style={{ display:"flex", gap:20 }}>
                      <div>
                        <div style={{ fontSize:9, color:"#8892A4", textTransform:"uppercase", letterSpacing:1 }}>Registros</div>
                        <div style={{ fontWeight:800, fontSize:20, color:"#4F8EF7" }}>{totalRegs}</div>
                      </div>
                      <div>
                        <div style={{ fontSize:9, color:"#8892A4", textTransform:"uppercase", letterSpacing:1 }}>Dias</div>
                        <div style={{ fontWeight:800, fontSize:20, color:"#EEC4C8" }}>{dias}</div>
                      </div>
                    </div>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    <Btn variant="ghost" style={{ padding:"5px 10px", fontSize:11 }}
                      onClick={() => { setFormCost({...c}); setModalCost(true); }}>✎</Btn>
                    <Btn variant="danger" style={{ padding:"5px 10px", fontSize:11 }}
                      onClick={() => saveCostureiras(costureiras.filter(x=>x.id!==c.id))}>✕</Btn>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal costureira */}
      {modalCost && (
        <Modal title={formCost.id ? "Editar Costureira" : "Nova Costureira"} onClose={() => setModalCost(false)}>
          {[["nome","Nome *","text","Nome completo"],["funcao","Função","text","Ex: Costureira, Bordadeira..."],["telefone","Telefone","text","(00) 00000-0000"]].map(([field,label,type,ph]) => (
            <div key={field} style={{ marginBottom:14 }}>
              <label style={{ display:"block", fontSize:10, letterSpacing:1, textTransform:"uppercase", color:"#C06E7A", marginBottom:5, fontWeight:700 }}>{label}</label>
              <input type={type} value={formCost[field]||""} placeholder={ph}
                onChange={e => setFormCost(f=>({...f,[field]:e.target.value}))}
                style={{ width:"100%", background:"#F4F5F7", border:"1px solid #2a2a3e", borderRadius:6, padding:"9px 12px", color:"#1C1C2E", fontSize:13, outline:"none", boxSizing:"border-box" }} />
            </div>
          ))}
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:8 }}>
            <Btn variant="ghost" onClick={() => setModalCost(false)}>Cancelar</Btn>
            <Btn onClick={salvarCostureira}>Salvar</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Produção ────────────────────────────────────────────────────────────────
const STATUS_FLOW = ["Aberta", "Em Produção", "Finalizada", "Entregue", "Cancelada"];
const STATUS_COLOR = { Aberta: "#4F8EF7", "Em Produção": "#FF8C42", Finalizada: "#C06E7A", Entregue: "#00C896", Cancelada: "#FF6B6B" };
const STATUS_ICON  = { Aberta: "◎", "Em Produção": "◷", Finalizada: "✓", Entregue: "★", Cancelada: "✕" };
const STATUS_DESC  = {
  Aberta: "Aguardando início da produção",
  "Em Produção": "Peças sendo confeccionadas",
  Finalizada: "Produção concluída, aguarda entrega",
  Entregue: "Entregue ao cliente",
  Cancelada: "Ordem cancelada",
};

function Producao({ ordens, saveOrdens, goBack }) {
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [busca, setBusca] = useState("");
  const [confirmando, setConfirmando] = useState(null); // { orderId, novoStatus }
  const [pagando, setPagando] = useState(null);

  const alterarStatus = (orderId, novoStatus) => {
    saveOrdens(ordens.map((o) => {
      if (o.id !== orderId) return o;
      return {
        ...o,
        status: novoStatus,
        pago: novoStatus === "Entregue" ? false : o.pago,
        dataPagamento: novoStatus === "Entregue" ? null : o.dataPagamento,
      };
    }));
    setConfirmando(null);
  };

  const pagarOrdem = (orderId) => {
    saveOrdens(ordens.map((o) => o.id === orderId ? { ...o, status: o.status === "Entregue" ? "Entregue" : o.status, pago: true, dataPagamento: today() } : o));
    setPagando(null);
  };

  const ordensFiltradas = ordens
    .filter(o => filtroStatus === "todos" || o.status === filtroStatus)
    .filter(o => o.cliente?.toLowerCase().includes(busca.toLowerCase()) || String(o.numero).includes(busca))
    .sort((a, b) => {
      const prioridade = { "Em Produção": 0, Aberta: 1, Finalizada: 2, Entregue: 3, Cancelada: 4 };
      return (prioridade[a.status] ?? 9) - (prioridade[b.status] ?? 9);
    });

  const contadores = STATUS_FLOW.reduce((acc, s) => {
    acc[s] = ordens.filter(o => o.status === s).length;
    return acc;
  }, {});

  return (
    <div>
      {/* Cabeçalho */}
      <BtnVoltar onClick={goBack} />
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: -0.5, color:"#f1eaea" }}>Painel de Produção</h1>
        <p style={{ color: "rgba(255, 255, 255, 0.91)", fontSize: 13 }}>Acompanhe e atualize o status de cada ordem</p>
      </div>

      {/* Contadores por status */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10, marginBottom: 24 }}>
        {STATUS_FLOW.map(s => (
          <button key={s} onClick={() => setFiltroStatus(filtroStatus === s ? "todos" : s)}
            style={{ background: filtroStatus === s ? STATUS_COLOR[s] + "22" : "#9c99991c", border: `1px solid ${filtroStatus === s ? STATUS_COLOR[s] : "#EAECF0"}`, borderRadius: 10, padding: "14px 16px", cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
            <div style={{ fontSize: 20, color: STATUS_COLOR[s], marginBottom: 6 }}>{STATUS_ICON[s]}</div>
            <div style={{ fontWeight: 900, fontSize: 22, color: "#FFF", fontFamily: "monospace" }}>{contadores[s] || 0}</div>
            <div style={{ fontSize: 15, color: filtroStatus === s ? STATUS_COLOR[s] : "#eaedf1f3", letterSpacing: 1, textTransform: "uppercase", marginTop: 2 }}>{s}</div>
          </button>
        ))}
      </div>

      {/* Barra de busca */}
      <div style={{ marginBottom: 16 }}>
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por cliente ou número da OS..."
          style={{ background: "#F4F5F7", border: "1px solid #2a2a3ef3", borderRadius: 8, padding: "10px 14px", color: "#1C1C2E", fontSize: 13, outline: "none", width: "100%", maxWidth: 420 }} />
      </div>

      {/* Cards de ordens */}
      {ordensFiltradas.length === 0 && (
        <Card style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 32, color: "#DDE1E9", marginBottom: 10 }}>◷</div>
          <div style={{ color: "#8892A4" }}>Nenhuma ordem encontrada.</div>
        </Card>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {ordensFiltradas.map(o => {
          const cor = STATUS_COLOR[o.status] || "#9CA3AF";
          const idxAtual = STATUS_FLOW.indexOf(o.status);
          const proximosStatus = STATUS_FLOW.filter((s, i) => i !== idxAtual && s !== "Cancelada");

          return (
            <Card key={o.id} style={{ padding: 0, overflow: "hidden", borderLeft: `3px solid ${cor}` }}>
              {/* Info da OS */}
              <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "90px 1fr auto", gap: 16, alignItems: "center" }}>
                <div>
                  <div style={{ color: "#C06E7A", fontWeight: 900, fontSize: 17, fontFamily: "monospace" }}>
                    #{String(o.numero).padStart(4,"0")}
                  </div>
                  <div style={{ fontSize: 10, color: "#8892A4", marginTop: 2 }}>{fmtDate(o.dataCriacao)}</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 5 }}>{o.cliente}</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <Badge color={cor}>{STATUS_ICON[o.status]} {o.status}</Badge>
                    <span style={{ fontSize: 11, color: "#8892A4" }}>
                      {o.itens?.reduce((a, i) => a + i.qtdTotal, 0) || 0} peças
                    </span>
                    {o.dataEntrega && (
                      <span style={{ fontSize: 11, color: o.status === "Finalizada" ? "#C06E7A" : "#8892A4" }}>
                        Entrega: {fmtDate(o.dataEntrega)}
                      </span>
                    )}
                  </div>
                  {/* Barra de progresso do fluxo */}
                  <div style={{ display: "flex", gap: 4, marginTop: 10, alignItems: "center" }}>
                    {["Aberta","Em Produção","Finalizada","Entregue"].map((s, i) => {
                      const ativo = STATUS_FLOW.indexOf(o.status) >= STATUS_FLOW.indexOf(s) && o.status !== "Cancelada";
                      return (
                        <div key={s} style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
                          <div style={{ flex: 1, height: 4, borderRadius: 2, background: ativo ? STATUS_COLOR[s] : "#EAECF0", transition: "background 0.3s" }} />
                          {i < 3 && <div style={{ width: 4, height: 4, borderRadius: "50%", background: ativo ? STATUS_COLOR[s] : "#EAECF0" }} />}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
                    {["Aberta","Em Produção","Finalizada","Entregue"].map(s => (
                      <div key={s} style={{ fontSize: 8, color: STATUS_FLOW.indexOf(o.status) >= STATUS_FLOW.indexOf(s) && o.status !== "Cancelada" ? STATUS_COLOR[s] : "#6B7280", letterSpacing: 0.5, textTransform: "uppercase", flex: 1 }}>{s}</div>
                    ))}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 900, fontSize: 16, color: "#00C896" }}>{fmt(o.valorTotal)}</div>
                </div>
              </div>

              {/* Botões de mudança de status */}
              <div style={{ borderTop: "1px solid #1e2030", padding: "10px 20px", background: "#f4f5f713", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "#8892A4", textTransform: "uppercase", letterSpacing: 1, marginRight: 4 }}>Mover para:</span>
                {proximosStatus.map(s => (
                  <button key={s} onClick={() => setConfirmando({ orderId: o.id, novoStatus: s, clienteNome: o.cliente, numero: o.numero })}
                    style={{ padding: "6px 14px", borderRadius: 20, border: `1px solid ${STATUS_COLOR[s]}55`, background: STATUS_COLOR[s] + "18", color: STATUS_COLOR[s], fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "Georgia, serif", transition: "all 0.15s" }}>
                    {STATUS_ICON[s]} {s}
                  </button>
                ))}
                {o.status === "Entregue" && !o.pago && (
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginLeft:"auto" }}>
                    <span style={{ fontSize:10, color:"#F7C948", fontWeight:700, letterSpacing:1, textTransform:"uppercase", background:"rgba(247,201,72,0.12)", border:"1px solid rgba(247,201,72,0.25)", borderRadius:20, padding:"5px 10px" }}>
                      Pagamento pendente
                    </span>
                    <button onClick={() => setPagando({ orderId: o.id, clienteNome: o.cliente, numero: o.numero, valor: o.valorTotal })}
                      style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid #00C89655", background: "#00C89618", color: "#00C896", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "Georgia, serif" }}>
                      💳 Confirmar recebimento
                    </button>
                  </div>
                )}
                {o.status !== "Cancelada" && (
                  <button onClick={() => setConfirmando({ orderId: o.id, novoStatus: "Cancelada", clienteNome: o.cliente, numero: o.numero })}
                    style={{ padding: "6px 14px", borderRadius: 20, border: "1px solid #e05c5c33", background: "#e05c5c11", color: "#FF6B6B", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "Georgia, serif", marginLeft: "auto" }}>
                    ✕ Cancelar
                  </button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Modal de confirmação */}
      {confirmando && (
        <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#FFFFFF", border: "1px solid #2a2a3e", borderRadius: 14, padding: 32, maxWidth: 400, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 36, color: STATUS_COLOR[confirmando.novoStatus], marginBottom: 16 }}>
              {STATUS_ICON[confirmando.novoStatus]}
            </div>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#1C1C2E", marginBottom: 8 }}>
              Confirmar mudança de status
            </div>
            <div style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 6 }}>
              OS <strong style={{ color: "#C06E7A" }}>#{String(confirmando.numero).padStart(4,"0")}</strong> — {confirmando.clienteNome}
            </div>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 24 }}>
              Novo status:{" "}
              <strong style={{ color: STATUS_COLOR[confirmando.novoStatus] }}>
                {confirmando.novoStatus}
              </strong>
              <div style={{ fontSize: 11, color: "#8892A4", marginTop: 4 }}>{STATUS_DESC[confirmando.novoStatus]}</div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={() => setConfirmando(null)}
                style={{ padding: "9px 24px", background: "#EEF0F5", border: "1px solid #2a2a3e", borderRadius: 8, color: "#9CA3AF", fontSize: 13, cursor: "pointer", fontFamily: "Georgia, serif" }}>
                Cancelar
              </button>
              <button onClick={() => alterarStatus(confirmando.orderId, confirmando.novoStatus)}
                style={{ padding: "9px 24px", background: STATUS_COLOR[confirmando.novoStatus] + "33", border: `1px solid ${STATUS_COLOR[confirmando.novoStatus]}88`, borderRadius: 8, color: STATUS_COLOR[confirmando.novoStatus], fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "Georgia, serif" }}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {pagando && (
        <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#FFFFFF", border: "1px solid #2a2a3e", borderRadius: 14, padding: 32, maxWidth: 400, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 36, color: "#00C896", marginBottom: 16 }}>💳</div>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#1C1C2E", marginBottom: 8 }}>Confirmar recebimento</div>
            <div style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 6 }}>
              OS <strong style={{ color: "#C06E7A" }}>#{String(pagando.numero).padStart(4,"0")}</strong> — {pagando.clienteNome}
            </div>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 24 }}>
              O valor de <strong style={{ color: "#00C896" }}>{fmt(pagando.valor)}</strong> será movido para Entradas do financeiro do ateliê.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={() => setPagando(null)}
                style={{ padding: "9px 24px", background: "#EEF0F5", border: "1px solid #2a2a3e", borderRadius: 8, color: "#9CA3AF", fontSize: 13, cursor: "pointer", fontFamily: "Georgia, serif" }}>
                Cancelar
              </button>
              <button onClick={() => pagarOrdem(pagando.orderId)}
                style={{ padding: "9px 24px", background: "#00C89633", border: "1px solid #00C89688", borderRadius: 8, color: "#00C896", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "Georgia, serif" }}>
                Confirmar Recebimento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Financeiro do Ateliê ─────────────────────────────────────────────────────
const CATEGORIAS_DESP = [
  { id:"material",   label:"Material/Tecido",    icon:"∿", cor:"#FF8C42" },
  { id:"aluguel",    label:"Aluguel",             icon:"⌂", cor:"#FF6B6B" },
  { id:"energia",    label:"Energia Elétrica",    icon:"↯", cor:"#F7C948" },
  { id:"maquina",    label:"Máquinas/Equipamentos",icon:"⚙", cor:"#4F8EF7" },
  { id:"salario",    label:"Salários/Mão de obra",icon:"✦", cor:"#C06E7A" },
  { id:"transporte", label:"Transporte/Frete",    icon:"▷", cor:"#B39DDB" },
  { id:"imposto",    label:"Impostos/Taxas",      icon:"≡", cor:"#FF6B6B" },
  { id:"marketing",  label:"Marketing",           icon:"◈", cor:"#00C896" },
  { id:"outros",     label:"Outros",              icon:"□", cor:"#9CA3AF" },
];

function Financeiro({ ordens, despesas, saveDespesas, saveOrdens, goBack }) {
  const [aba, setAba] = useState("visao");
  const [periodo, setPeriodo] = useState("mes");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim]     = useState("");
  const [modalDesp, setModalDesp] = useState(false);
  const [editDesp, setEditDesp]   = useState(null);
  const [formDesp, setFormDesp]   = useState({ descricao:"", valor:"", categoria:"material", data:today(), recorrente:false, obs:"" });
  const [filtroCateg, setFiltroCateg] = useState("todas");
  const [confirmarExcDesp, setConfirmarExcDesp] = useState(null);
  const [pagando, setPagando] = useState(null);
  const agora = new Date();

  const filtrar = (item) => {
    const d = new Date(item.data || item.dataCriacao);
    if (periodo === "mes")       return d.getMonth()===agora.getMonth() && d.getFullYear()===agora.getFullYear();
    if (periodo === "trimestre") { const ini=new Date(agora); ini.setMonth(agora.getMonth()-3); return d>=ini; }
    if (periodo === "ano")       return d.getFullYear()===agora.getFullYear();
    if (periodo === "custom")    {
      if (dataInicio && d < new Date(dataInicio)) return false;
      if (dataFim    && d > new Date(dataFim))    return false;
      return true;
    }
    return true;
  };

  const ordsPagas      = ordens.filter(o => isOrdemEmEntrada(o) && filtrar(o));
  const ordsAReceber   = ordens.filter(o => isOrdemAReceber(o) && filtrar(o));
  const despFilt       = despesas.filter(filtrar).filter(d => filtroCateg==="todas" || d.categoria===filtroCateg);

  const totalEntradas  = ordsPagas.reduce((s,o) => s+(o.valorTotal||0), 0);
  const totalAReceber  = ordsAReceber.reduce((s,o) => s+(o.valorTotal||0), 0);
  const totalDespesas  = despFilt.reduce((s,d) => s+parseFloat(d.valor||0), 0);
  const lucroLiquido   = totalEntradas - totalDespesas;
  const margem         = totalEntradas > 0 ? (lucroLiquido/totalEntradas*100).toFixed(1) : 0;

  // Despesas por categoria
  const despPorCateg = CATEGORIAS_DESP.map(c => ({
    ...c,
    total: despesas.filter(filtrar).filter(d => d.categoria===c.id).reduce((s,d)=>s+parseFloat(d.valor||0),0)
  })).filter(c => c.total > 0).sort((a,b) => b.total - a.total);
  const maxDesp = despPorCateg[0]?.total || 1;

  // Evolução mensal (6 meses)
  const meses = Array.from({length:6}, (_,i) => {
    const d = new Date(agora.getFullYear(), agora.getMonth()-5+i, 1);
    const entr = ordens.filter(o=>o.status==="Entregue" && isOrdemPaga(o)).filter(o=>{const od=new Date(o.dataCriacao); return od.getMonth()===d.getMonth()&&od.getFullYear()===d.getFullYear();}).reduce((s,o)=>s+(o.valorTotal||0),0);
    const desp = despesas.filter(o=>{const od=new Date(o.data); return od.getMonth()===d.getMonth()&&od.getFullYear()===d.getFullYear();}).reduce((s,o)=>s+parseFloat(o.valor||0),0);
    return { label: d.toLocaleDateString("pt-BR",{month:"short"}), entr, desp, lucro: entr-desp };
  });
  const maxBar = Math.max(...meses.map(m => Math.max(m.entr, m.desp)), 1);

  const pagarOrdem = (orderId) => {
    saveOrdens(ordens.map(o => o.id === orderId ? { ...o, pago: true, dataPagamento: today() } : o));
    setPagando(null);
  };

  const abrirDesp = (d) => {
    setEditDesp(d||null);
    setFormDesp(d ? {...d} : { descricao:"", valor:"", categoria:"material", data:today(), recorrente:false, obs:"" });
    setModalDesp(true);
  };
  const salvarDesp = () => {
    if (!formDesp.descricao||!formDesp.valor) return alert("Preencha descrição e valor.");
    const entry = { ...formDesp, id: editDesp?.id||genId(), valor: parseFloat(formDesp.valor) };
    saveDespesas(editDesp ? despesas.map(d=>d.id===editDesp.id?entry:d) : [...despesas,entry]);
    setModalDesp(false);
  };
  const excluirDesp = () => {
    saveDespesas(despesas.filter(d=>d.id!==confirmarExcDesp));
    setConfirmarExcDesp(null);
  };

  const abaStyle = id => ({
    padding:"10px 18px", border:"none", cursor:"pointer", background:"transparent",
    color:aba===id?"#EEC4C8":"rgba(255,255,255,0.4)", fontWeight:aba===id?700:400,
    fontSize:13, borderBottom:aba===id?"2px solid #C06E7A":"2px solid transparent",
    fontFamily:"inherit", whiteSpace:"nowrap", transition:"all 0.15s",
  });

  const periodoLabel = () => {
    if (periodo==="mes") return agora.toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
    if (periodo==="trimestre") return "Últimos 3 meses";
    if (periodo==="ano") return `Ano ${agora.getFullYear()}`;
    if (periodo==="custom" && (dataInicio||dataFim)) return `${dataInicio?fmtDate(dataInicio):"início"} → ${dataFim?fmtDate(dataFim):"hoje"}`;
    return "Todos";
  };

  return (
    <div>
      <BtnVoltar onClick={goBack} />
      <div style={{ marginBottom:20 }}>
        <h1 style={{ fontSize:24, fontWeight:900, color:"#FFF", letterSpacing:-0.5, marginBottom:4 }}>Financeiro do Ateliê</h1>
        <p style={{ color:"rgba(238,196,200,0.6)", fontSize:13 }}>{periodoLabel()}</p>
      </div>

      {/* Filtros */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:20 }}>
        {[["mes","Mês"],["trimestre","Trimestre"],["ano","Ano"],["todos","Todos"],["custom","Período"]].map(([v,l])=>(
          <button key={v} onClick={()=>setPeriodo(v)}
            style={{ padding:"7px 16px", borderRadius:20, border:`1px solid ${periodo===v?"#C06E7A":"rgba(255,255,255,0.1)"}`, background:periodo===v?"rgba(192,110,122,0.2)":"transparent", color:periodo===v?"#EEC4C8":"rgba(255,255,255,0.5)", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
            {l}
          </button>
        ))}
      </div>
      {periodo==="custom" && (
        <div style={{ display:"flex", gap:12, marginBottom:16, flexWrap:"wrap" }}>
          {[["De",dataInicio,setDataInicio],["Até",dataFim,setDataFim]].map(([label,val,set])=>(
            <div key={label}>
              <label style={{ fontSize:10, color:"rgba(238,196,200,0.6)", display:"block", marginBottom:4, textTransform:"uppercase", letterSpacing:1 }}>{label}</label>
              <input type="date" value={val} onChange={e=>set(e.target.value)}
                style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(192,110,122,0.3)", borderRadius:8, padding:"8px 12px", color:"#FFF", fontSize:13, outline:"none" }}/>
            </div>
          ))}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:12, marginBottom:20 }}>
        {[
          { label:"Entradas",    val:fmt(totalEntradas), color:"#00C896", icon:"↑" },
          { label:"A Receber",   val:fmt(totalAReceber), color:"#4F8EF7", icon:"◷" },
          { label:"Despesas",    val:fmt(totalDespesas), color:"#FF6B6B", icon:"↓" },
          { label:"Lucro Líq.",  val:fmt(lucroLiquido),  color: lucroLiquido>=0?"#00C896":"#FF6B6B", icon:"=" },
          { label:"Margem",      val:`${margem}%`,        color:"#EEC4C8", icon:"%" },
        ].map(k=>(
          <div key={k.label} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(192,110,122,0.12)", borderRadius:14, padding:"16px 14px" }}>
            <div style={{ fontSize:18, color:k.color, marginBottom:8 }}>{k.icon}</div>
            <div style={{ fontSize:18, fontWeight:900, color:"#FFF", marginBottom:4 }}>{k.val}</div>
            <div style={{ fontSize:10, color:"rgba(238,196,200,0.5)", textTransform:"uppercase", letterSpacing:1 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Abas */}
      <div style={{ borderBottom:"1px solid rgba(255,255,255,0.08)", marginBottom:20, display:"flex", overflowX:"auto" }}>
        {[["visao","≡ Visão Geral"],["despesas","↓ Despesas"],["dre","≡ DRE"]].map(([id,l])=>(
          <button key={id} style={abaStyle(id)} onClick={()=>setAba(id)}>{l}</button>
        ))}
      </div>

      {/* ── VISÃO GERAL ── */}
      {pagando && (
        <div style={{ position:"fixed", inset:0, background:"#000b", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:"#FFFFFF", border:"1px solid #2a2a3e", borderRadius:14, padding:32, maxWidth:400, width:"100%", textAlign:"center" }}>
            <div style={{ fontSize:36, color:"#00C896", marginBottom:16 }}>💳</div>
            <div style={{ fontWeight:800, fontSize:17, color:"#1C1C2E", marginBottom:8 }}>Confirmar recebimento</div>
            <div style={{ fontSize:13, color:"#9CA3AF", marginBottom:24 }}>
              O valor de <strong style={{ color:"#00C896" }}>{fmt(pagando.valor)}</strong> será registrado como entrada financeira.
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <button onClick={() => setPagando(null)} style={{ padding:"9px 24px", background:"#EEF0F5", border:"1px solid #2a2a3e", borderRadius:8, color:"#9CA3AF", fontSize:13, cursor:"pointer", fontFamily:"Georgia, serif" }}>Cancelar</button>
              <button onClick={() => pagarOrdem(pagando.orderId)} style={{ padding:"9px 24px", background:"#00C89633", border:"1px solid #00C89688", borderRadius:8, color:"#00C896", fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"Georgia, serif" }}>Confirmar Pagamento</button>
            </div>
          </div>
        </div>
      )}

      {aba==="visao" && (
        <div>
          {/* Gráfico barras */}
          <Card style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, color:"rgba(238,196,200,0.6)", marginBottom:16, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>Evolução — Últimos 6 Meses</div>
            <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:120 }}>
              {meses.map((m,i)=>(
                <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                  <div style={{ width:"100%", display:"flex", gap:2, alignItems:"flex-end", height:90 }}>
                    <div style={{ flex:1, background:"rgba(0,200,150,0.7)", borderRadius:"4px 4px 0 0", height:`${(m.entr/maxBar)*90}px`, transition:"height 0.4s", minHeight:2 }} title={`Entrada: ${fmt(m.entr)}`} />
                    <div style={{ flex:1, background:"rgba(255,107,107,0.7)", borderRadius:"4px 4px 0 0", height:`${(m.desp/maxBar)*90}px`, transition:"height 0.4s", minHeight: m.desp>0?2:0 }} title={`Despesa: ${fmt(m.desp)}`} />
                  </div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)" }}>{m.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:16, marginTop:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}><div style={{ width:10, height:10, borderRadius:2, background:"rgba(0,200,150,0.7)" }}/><span style={{ fontSize:11, color:"rgba(255,255,255,0.5)" }}>Entradas</span></div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}><div style={{ width:10, height:10, borderRadius:2, background:"rgba(255,107,107,0.7)" }}/><span style={{ fontSize:11, color:"rgba(255,255,255,0.5)" }}>Despesas</span></div>
            </div>
          </Card>

          {/* Despesas por categoria */}
          <Card style={{ marginBottom:16 }}>
            <div style={{ fontSize:12, color:"rgba(238,196,200,0.6)", marginBottom:14, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>Contas a Receber</div>
            {ordsAReceber.length===0 && <div style={{ color:"rgba(255,255,255,0.3)", fontSize:13 }}>Nenhuma conta pendente.</div>}
            {ordsAReceber.map(o=>(
              <div key={o.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, padding:"10px 0", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div>
                  <div style={{ fontWeight:700, color:"#FFF", fontSize:13 }}>#{String(o.numero).padStart(4,"0")} · {o.cliente}</div>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", marginTop:2 }}>{o.status === "Entregue" ? "Entregue — aguardando pagamento" : o.status}</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontWeight:800, color:o.status==="Entregue"?"#EEC4C8":"#4F8EF7" }}>{fmt(o.valorTotal)}</span>
                  {o.status === "Entregue" && !isOrdemPaga(o) && (
                    <button onClick={() => setPagando({ orderId: o.id, clienteNome: o.cliente, numero: o.numero, valor: o.valorTotal })}
                      style={{ padding:"6px 12px", borderRadius:20, border:"1px solid #00C89655", background:"#00C89618", color:"#00C896", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                      Receber
                    </button>
                  )}
                </div>
              </div>
            ))}
          </Card>

          <Card>
            <div style={{ fontSize:12, color:"rgba(238,196,200,0.6)", marginBottom:14, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>Despesas por Categoria</div>
            {despPorCateg.length===0 && <div style={{ color:"rgba(255,255,255,0.3)", fontSize:13 }}>Nenhuma despesa no período.</div>}
            {despPorCateg.map(c=>(
              <div key={c.id} style={{ marginBottom:12 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                  <span style={{ fontSize:13, color:"rgba(255,255,255,0.8)" }}>{c.icon} {c.label}</span>
                  <span style={{ fontSize:13, fontWeight:700, color:c.cor }}>{fmt(c.total)}</span>
                </div>
                <div style={{ height:5, background:"rgba(255,255,255,0.06)", borderRadius:3 }}>
                  <div style={{ height:5, background:c.cor, borderRadius:3, width:`${c.total/maxDesp*100}%`, transition:"width 0.4s" }} />
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* ── DESPESAS ── */}
      {aba==="despesas" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, flexWrap:"wrap", gap:10 }}>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              <button onClick={()=>setFiltroCateg("todas")}
                style={{ padding:"6px 14px", borderRadius:20, border:`1px solid ${filtroCateg==="todas"?"#C06E7A":"rgba(255,255,255,0.1)"}`, background:filtroCateg==="todas"?"rgba(192,110,122,0.2)":"transparent", color:filtroCateg==="todas"?"#EEC4C8":"rgba(255,255,255,0.4)", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                Todas
              </button>
              {CATEGORIAS_DESP.map(c=>(
                <button key={c.id} onClick={()=>setFiltroCateg(c.id)}
                  style={{ padding:"6px 14px", borderRadius:20, border:`1px solid ${filtroCateg===c.id?c.cor:"rgba(255,255,255,0.1)"}`, background:filtroCateg===c.id?c.cor+"22":"transparent", color:filtroCateg===c.id?c.cor:"rgba(255,255,255,0.4)", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                  {c.icon} {c.label}
                </button>
              ))}
            </div>
            <Btn onClick={()=>abrirDesp(null)}>+ Nova Despesa</Btn>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {despFilt.length===0 && <Card style={{ textAlign:"center", padding:32 }}><div style={{ color:"rgba(255,255,255,0.3)" }}>Nenhuma despesa encontrada.</div></Card>}
            {[...despFilt].sort((a,b)=>new Date(b.data)-new Date(a.data)).map(d=>{
              const cat = CATEGORIAS_DESP.find(c=>c.id===d.categoria)||CATEGORIAS_DESP.at(-1);
              return (
                <Card key={d.id} style={{ padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:14, flex:1 }}>
                    <div style={{ width:44, height:44, borderRadius:12, background:cat.cor+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{cat.icon}</div>
                    <div>
                      <div style={{ fontWeight:700, fontSize:14, color:"#FFF", marginBottom:3 }}>{d.descricao}</div>
                      <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                        <span style={{ fontSize:11, color:cat.cor }}>{cat.label}</span>
                        <span style={{ fontSize:11, color:"rgba(255,255,255,0.35)" }}>{fmtDate(d.data)}</span>
                        {d.recorrente && <span style={{ fontSize:10, background:"rgba(79,142,247,0.2)", color:"#4F8EF7", padding:"1px 8px", borderRadius:10, fontWeight:700 }}>Fixo</span>}
                      </div>
                      {d.obs && <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", marginTop:2 }}>{d.obs}</div>}
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
                    <div style={{ fontWeight:900, fontSize:16, color:"#FF6B6B" }}>- {fmt(d.valor)}</div>
                    <Btn variant="ghost" style={{ padding:"5px 10px", fontSize:11 }} onClick={()=>abrirDesp(d)}>✎</Btn>
                    <Btn variant="danger" style={{ padding:"5px 10px", fontSize:11 }} onClick={()=>setConfirmarExcDesp(d.id)}>✕</Btn>
                  </div>
                </Card>
              );
            })}
          </div>
          {despFilt.length>0 && (
            <div style={{ textAlign:"right", padding:"12px 0", fontWeight:800, fontSize:16, color:"#FF6B6B" }}>
              Total: - {fmt(totalDespesas)}
            </div>
          )}
        </div>
      )}

      {/* ── DRE ── */}
      {aba==="dre" && (
        <Card>
          <div style={{ fontSize:13, fontWeight:700, color:"rgba(238,196,200,0.8)", textTransform:"uppercase", letterSpacing:1, marginBottom:20 }}>
            Demonstrativo de Resultado — {periodoLabel()}
          </div>
          {[
            { label:"(+) Receita Bruta (OS Entregues)", val:totalEntradas, cor:"#00C896", bold:false },
            { label:"(+) A Receber (em andamento)",     val:totalAReceber, cor:"#4F8EF7", bold:false },
            { label:"(=) Receita Total",                val:totalEntradas+totalAReceber, cor:"#EEC4C8", bold:true, sep:true },
            ...CATEGORIAS_DESP.map(c=>{
              const t = despesas.filter(filtrar).filter(d=>d.categoria===c.id).reduce((s,d)=>s+parseFloat(d.valor||0),0);
              return t>0 ? { label:`(-) ${c.label}`, val:t, cor:"#FF6B6B", bold:false } : null;
            }).filter(Boolean),
            { label:"(=) Total de Despesas",            val:totalDespesas, cor:"#FF6B6B", bold:true, sep:true },
            { label:"(=) LUCRO LÍQUIDO",                val:lucroLiquido,  cor:lucroLiquido>=0?"#00C896":"#FF6B6B", bold:true, grande:true, sep:true },
            { label:"Margem de Lucro",                  val:null, extra:`${margem}%`, cor:"#EEC4C8", bold:false },
          ].map((row, i) => row && (
            <div key={i}>
              {row.sep && <div style={{ height:1, background:"rgba(255,255,255,0.08)", margin:"12px 0" }} />}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0" }}>
                <span style={{ fontSize:row.grande?16:13, fontWeight:row.bold?700:400, color:row.bold?"rgba(255,255,255,0.9)":"rgba(255,255,255,0.6)" }}>
                  {row.label}
                </span>
                <span style={{ fontSize:row.grande?20:14, fontWeight:row.bold?900:600, color:row.cor }}>
                  {row.extra || fmt(row.val)}
                </span>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Modal despesa */}
      {modalDesp && (
        <Modal title={editDesp?"Editar Despesa":"Nova Despesa"} onClose={()=>setModalDesp(false)}>
          <Input label="Descrição *" value={formDesp.descricao} onChange={e=>setFormDesp(f=>({...f,descricao:e.target.value}))} placeholder="Ex: Compra de tecido, Aluguel..." />
          <Input label="Valor (R$) *" type="number" step="0.01" min="0" value={formDesp.valor} onChange={e=>setFormDesp(f=>({...f,valor:e.target.value}))} />
          <Select label="Categoria" value={formDesp.categoria} onChange={e=>setFormDesp(f=>({...f,categoria:e.target.value}))}
            options={CATEGORIAS_DESP.map(c=>({value:c.id,label:`${c.icon} ${c.label}`}))} />
          <Input label="Data" type="date" value={formDesp.data} onChange={e=>setFormDesp(f=>({...f,data:e.target.value}))} />
          <div style={{ marginBottom:16 }}>
            <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
              <input type="checkbox" checked={formDesp.recorrente} onChange={e=>setFormDesp(f=>({...f,recorrente:e.target.checked}))}
                style={{ width:18, height:18, accentColor:"#C06E7A" }} />
              <span style={{ fontSize:13, color:"rgba(238,196,200,0.8)", fontWeight:600 }}>Despesa fixa/recorrente</span>
            </label>
          </div>
          <div style={{ marginBottom:16 }}>
            <label style={{ display:"block", fontSize:11, color:"rgba(238,196,200,0.6)", marginBottom:6, fontWeight:600, textTransform:"uppercase", letterSpacing:0.5 }}>Observação</label>
            <textarea value={formDesp.obs||""} onChange={e=>setFormDesp(f=>({...f,obs:e.target.value}))} rows={2}
              style={{ width:"100%", background:"rgba(255,255,255,0.08)", border:"1.5px solid rgba(255,255,255,0.12)", borderRadius:10, padding:"10px 14px", color:"#FFF", fontSize:14, outline:"none", fontFamily:"inherit", resize:"vertical", boxSizing:"border-box" }} />
          </div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn variant="ghost" onClick={()=>setModalDesp(false)}>Cancelar</Btn>
            <Btn onClick={salvarDesp}>Salvar</Btn>
          </div>
        </Modal>
      )}

      {/* Confirmar exclusão */}
      {confirmarExcDesp && (
        <div style={{ position:"fixed", inset:0, background:"rgba(10,8,30,0.85)", backdropFilter:"blur(10px)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:"linear-gradient(145deg,#2a2d30,#3a3d40)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:32, maxWidth:340, width:"100%", textAlign:"center" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>✕</div>
            <div style={{ fontWeight:800, fontSize:17, color:"#FFF", marginBottom:8 }}>Excluir despesa?</div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", marginBottom:24 }}>Esta ação não pode ser desfeita.</div>
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <Btn variant="ghost" onClick={()=>setConfirmarExcDesp(null)}>Cancelar</Btn>
              <Btn variant="danger" onClick={excluirDesp}>Excluir</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Financeiro Pessoal ───────────────────────────────────────────────────────
const CATEGORIAS_PESSOAL = [
  { id:"moradia",    label:"Moradia",         icon:"⌂", cor:"#4F8EF7" },
  { id:"alimentacao",label:"Alimentação",     icon:"⊕", cor:"#FF8C42" },
  { id:"transporte", label:"Transporte",      icon:"▷", cor:"#F7C948" },
  { id:"saude",      label:"Saúde",           icon:"♥", cor:"#FF6B6B" },
  { id:"educacao",   label:"Educação",        icon:"≋", cor:"#B39DDB" },
  { id:"lazer",      label:"Lazer",           icon:"★", cor:"#00C896" },
  { id:"vestuario",  label:"Vestuário",       icon:"✿", cor:"#C06E7A" },
  { id:"assinatura", label:"Assinaturas",     icon:"▤", cor:"#EEC4C8" },
  { id:"outros",     label:"Outros",          icon:"□", cor:"#9CA3AF" },
];

function FinanceiroPessoal({ lucroAtelier, gastos, saveGastos, goBack }) {
  const [aba, setAba]         = useState("resumo");
  const [modalGasto, setModalGasto] = useState(false);
  const [modalEntrada, setModalEntrada] = useState(false);
  const [editGasto, setEditGasto]   = useState(null);
  const [confirmarExc, setConfirmarExc] = useState(null);
  const [formEntrada, setFormEntrada] = useState({ descricao:"", valor:"", data:today() });
  const [formGasto, setFormGasto] = useState({
    descricao:"", valor:"", categoria:"moradia", tipo:"avista",
    data:today(), vencimento:"", totalParcelas:2, parcelaAtual:1,
    pago:false, fixo:false, obs:""
  });

  const agora = new Date();
  const mesAtual = agora.getMonth();
  const anoAtual = agora.getFullYear();

  // Gastos do mês atual
  const gastosMes = gastos.filter(g => {
    if (g.natureza === "entrada") return false;
    const d = new Date(g.data);
    return d.getMonth()===mesAtual && d.getFullYear()===anoAtual;
  });
  const entradasMes = gastos.filter(g => {
    if (g.natureza !== "entrada") return false;
    const d = new Date(g.data);
    return d.getMonth()===mesAtual && d.getFullYear()===anoAtual;
  });

  // Gastos fixos (sempre ativos)
  const gastosFixos    = gastos.filter(g => g.natureza !== "entrada" && g.fixo);
  const gastosAvista   = gastosMes.filter(g => !g.fixo && g.tipo==="avista");
  const gastosParc     = gastosMes.filter(g => !g.fixo && g.tipo==="parcelado");
  const vencendoHoje   = gastos.filter(g => g.natureza !== "entrada" && g.vencimento === today() && !g.pago);
  const vencendo7      = gastos.filter(g => {
    if (g.natureza === "entrada" || !g.vencimento || g.pago) return false;
    const v = new Date(g.vencimento);
    const diff = Math.floor((v - agora)/(1000*60*60*24));
    return diff >= 0 && diff <= 7;
  });

  const totalFixos  = gastosFixos.reduce((s,g)=>s+parseFloat(g.valor||0),0);
  const totalAvista = gastosAvista.reduce((s,g)=>s+parseFloat(g.valor||0),0);
  const totalParc   = gastosParc.reduce((s,g)=>s+parseFloat(g.valor||0),0);
  const totalMes    = totalFixos + totalAvista + totalParc;
  const totalEntradas = entradasMes.reduce((s,g)=>s+parseFloat(g.valor||0),0);
  const totalRendas = lucroAtelier + totalEntradas;
  const saldo       = totalRendas - totalMes;
  const pctGasto    = totalRendas > 0 ? Math.min(100,(totalMes/totalRendas*100)) : 0;

  const abrirGasto = (g) => {
    setEditGasto(g||null);
    setFormGasto(g?{...g}:{descricao:"",valor:"",categoria:"moradia",tipo:"avista",data:today(),vencimento:"",totalParcelas:2,parcelaAtual:1,pago:false,fixo:false,obs:""});
    setModalGasto(true);
  };
  const salvarGasto = () => {
    if (!formGasto.descricao||!formGasto.valor) return alert("Preencha descrição e valor.");
    const entry = {...formGasto, id:editGasto?.id||genId(), valor:parseFloat(formGasto.valor)};
    saveGastos(editGasto ? gastos.map(g=>g.id===editGasto.id?entry:g) : [...gastos,entry]);
    setModalGasto(false);
  };
  const abrirEntrada = () => {
    setFormEntrada({ descricao:"", valor:"", data:today() });
    setModalEntrada(true);
  };
  const salvarEntrada = () => {
    if (!formEntrada.descricao || !formEntrada.valor) return alert("Preencha descrição e valor.");
    saveGastos([...gastos, { ...formEntrada, id:genId(), natureza:"entrada", valor:parseFloat(formEntrada.valor) }]);
    setModalEntrada(false);
  };
  const excluir = () => { saveGastos(gastos.filter(g=>g.id!==confirmarExc)); setConfirmarExc(null); };
  const togglePago = (id) => saveGastos(gastos.map(g=>g.id===id?{...g,pago:!g.pago}:g));

  const abaStyle = id => ({
    padding:"10px 16px", border:"none", cursor:"pointer", background:"transparent",
    color:aba===id?"#EEC4C8":"rgba(255,255,255,0.4)", fontWeight:aba===id?700:400,
    fontSize:13, borderBottom:aba===id?"2px solid #C06E7A":"2px solid transparent",
    fontFamily:"inherit", whiteSpace:"nowrap",
  });

  const CardGasto = ({g}) => {
    const cat = CATEGORIAS_PESSOAL.find(c=>c.id===g.categoria)||CATEGORIAS_PESSOAL.at(-1);
    const venc = g.vencimento ? new Date(g.vencimento) : null;
    const daysLeft = venc ? Math.floor((venc-agora)/(1000*60*60*24)) : null;
    const atrasado = daysLeft !== null && daysLeft < 0 && !g.pago;
    return (
      <Card style={{ padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, opacity:g.pago?0.6:1, borderLeft:`3px solid ${g.pago?"#00C896":atrasado?"#FF6B6B":cat.cor}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, flex:1, minWidth:0 }}>
          <div style={{ width:44, height:44, borderRadius:12, background:cat.cor+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{cat.icon}</div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontWeight:700, fontSize:14, color:g.pago?"rgba(255,255,255,0.5)":"#FFF", marginBottom:3, textDecoration:g.pago?"line-through":"none" }}>{g.descricao}</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {g.fixo && <span style={{ fontSize:10, background:"rgba(79,142,247,0.2)", color:"#4F8EF7", padding:"1px 8px", borderRadius:10, fontWeight:700 }}>Fixo</span>}
              {g.tipo==="parcelado" && <span style={{ fontSize:10, background:"rgba(192,110,122,0.2)", color:"#EEC4C8", padding:"1px 8px", borderRadius:10, fontWeight:700 }}>{g.parcelaAtual}/{g.totalParcelas}x</span>}
              {g.pago && <span style={{ fontSize:10, background:"rgba(0,200,150,0.2)", color:"#00C896", padding:"1px 8px", borderRadius:10, fontWeight:700 }}>✓ Pago</span>}
              {atrasado && <span style={{ fontSize:10, background:"rgba(255,107,107,0.2)", color:"#FF6B6B", padding:"1px 8px", borderRadius:10, fontWeight:700 }}>⚠ Atrasado</span>}
              {venc && !g.pago && daysLeft>=0 && daysLeft<=7 && <span style={{ fontSize:10, background:"rgba(247,201,72,0.2)", color:"#F7C948", padding:"1px 8px", borderRadius:10, fontWeight:700 }}>Vence em {daysLeft}d</span>}
              {g.vencimento && <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)" }}>Venc: {fmtDate(g.vencimento)}</span>}
            </div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          <div style={{ fontWeight:900, fontSize:16, color:g.pago?"rgba(255,255,255,0.4)":"#FF6B6B" }}>- {fmt(g.valor)}</div>
          <button onClick={()=>togglePago(g.id)}
            style={{ width:32, height:32, borderRadius:8, background:g.pago?"rgba(0,200,150,0.2)":"rgba(255,255,255,0.06)", border:`1px solid ${g.pago?"#00C89655":"rgba(255,255,255,0.1)"}`, cursor:"pointer", fontSize:14, color:g.pago?"#00C896":"rgba(255,255,255,0.3)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            {g.pago?"✓":"○"}
          </button>
          <Btn variant="ghost" style={{ padding:"5px 9px", fontSize:11 }} onClick={()=>abrirGasto(g)}>✎</Btn>
          <Btn variant="danger" style={{ padding:"5px 9px", fontSize:11 }} onClick={()=>setConfirmarExc(g.id)}>✕</Btn>
        </div>
      </Card>
    );
  };

  return (
    <div>
      <BtnVoltar onClick={goBack} />
      <div style={{ marginBottom:20, display:"flex", justifyContent:"space-between", alignItems:"flex-start", flexWrap:"wrap", gap:10 }}>
        <div>
          <h1 style={{ fontSize:24, fontWeight:900, color:"#FFF", letterSpacing:-0.5, marginBottom:4 }}>Financeiro Pessoal</h1>
          <p style={{ color:"rgba(238,196,200,0.6)", fontSize:13 }}>{agora.toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}</p>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <Btn onClick={abrirEntrada} style={{ background:"linear-gradient(135deg,#00A879,#008A68)", boxShadow:"0 4px 14px #00C89633" }}>+ Nova Entrada</Btn>
          <Btn onClick={()=>abrirGasto(null)}>+ Novo Gasto</Btn>
        </div>
      </div>

      {/* Alertas */}
      {vencendoHoje.length>0 && (
        <div style={{ background:"rgba(255,107,107,0.12)", border:"1px solid rgba(255,107,107,0.3)", borderRadius:12, padding:"12px 16px", marginBottom:16, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:20 }}>⚠</span>
          <div style={{ fontSize:13, color:"#FF6B6B" }}>
            <strong>{vencendoHoje.length} conta(s) vencem hoje!</strong> {vencendoHoje.map(g=>g.descricao).join(", ")}
          </div>
        </div>
      )}
      {vencendo7.length>0 && vencendoHoje.length===0 && (
        <div style={{ background:"rgba(247,201,72,0.1)", border:"1px solid rgba(247,201,72,0.25)", borderRadius:12, padding:"12px 16px", marginBottom:16, display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:18 }}>!</span>
          <div style={{ fontSize:13, color:"#F7C948" }}>{vencendo7.length} conta(s) vencem nos próximos 7 dias.</div>
        </div>
      )}

      {/* Saldo / salário card */}
      <div style={{ background:"linear-gradient(135deg,rgba(192,110,122,0.2),rgba(168,82,96,0.15))", border:"1px solid rgba(192,110,122,0.3)", borderRadius:18, padding:"20px 22px", marginBottom:20 }}>
        <div style={{ fontSize:11, color:"rgba(238,196,200,0.6)", textTransform:"uppercase", letterSpacing:1, marginBottom:12 }}>Rendas do mês</div>
        <div style={{ fontSize:32, fontWeight:900, color:"#FFF", marginBottom:16 }}>{fmt(totalRendas)}</div>
        <div style={{ height:8, background:"rgba(255,255,255,0.08)", borderRadius:6, overflow:"hidden", marginBottom:8 }}>
          <div style={{ height:"100%", width:`${pctGasto}%`, background:`linear-gradient(90deg,#00C896,${pctGasto>80?"#FF6B6B":"#F7C948"})`, borderRadius:6, transition:"width 0.5s" }} />
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:12 }}>
          <span style={{ color:"rgba(255,255,255,0.4)" }}>Gasto: {fmt(totalMes)} ({pctGasto.toFixed(1)}%)</span>
          <span style={{ color:saldo>=0?"#00C896":"#FF6B6B", fontWeight:700 }}>Saldo: {fmt(saldo)}</span>
        </div>
      </div>

      {/* Mini KPIs */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:20 }}>
        {[
          { label:"Fixos",      val:fmt(totalFixos),  color:"#4F8EF7", icon:"◆" },
          { label:"À Vista",    val:fmt(totalAvista), color:"#FF8C42", icon:"$" },
          { label:"Parcelados", val:fmt(totalParc),   color:"#C06E7A", icon:"▣" },
        ].map(k=>(
          <div key={k.label} style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(192,110,122,0.12)", borderRadius:14, padding:"14px 12px", textAlign:"center" }}>
            <div style={{ fontSize:20, marginBottom:6 }}>{k.icon}</div>
            <div style={{ fontSize:15, fontWeight:900, color:k.color, marginBottom:3 }}>{k.val}</div>
            <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", textTransform:"uppercase", letterSpacing:1 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Abas */}
      <div style={{ borderBottom:"1px solid rgba(255,255,255,0.08)", marginBottom:16, display:"flex", overflowX:"auto" }}>
        {[["resumo","≡ Resumo"],["fixos","◆ Fixos"],["avista","$ À Vista"],["parcelados","▣ Parcelados"],["todos","≡ Todos"]].map(([id,l])=>(
          <button key={id} style={abaStyle(id)} onClick={()=>setAba(id)}>{l}</button>
        ))}
      </div>

      {/* Listas por aba */}
      {aba==="resumo" && (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {/* DRE Pessoal */}
          <Card>
            <div style={{ fontSize:12, color:"rgba(238,196,200,0.6)", fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:18 }}>
              Resultado Mensal — {agora.toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}
            </div>
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Rendas</div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:"rgba(0,200,150,0.08)", borderRadius:10, border:"1px solid rgba(0,200,150,0.15)", marginBottom:4 }}>
                <span style={{ fontSize:13, color:"rgba(255,255,255,0.7)" }}>Salario (lucro atelier)</span>
                <span style={{ fontSize:14, fontWeight:800, color:"#00C896" }}>+ {fmt(lucroAtelier)}</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 12px" }}>
                {entradasMes.map(entrada=>(
                  <div key={entrada.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, padding:"7px 12px", background:"rgba(0,200,150,0.05)", borderRadius:8, marginBottom:4 }}>
                    <span style={{ fontSize:13, color:"rgba(255,255,255,0.65)" }}>{entrada.descricao} <span style={{ color:"rgba(255,255,255,0.3)", fontSize:11 }}>({fmtDate(entrada.data)})</span></span>
                    <span style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <strong style={{ fontSize:13, color:"#00C896" }}>+ {fmt(entrada.valor)}</strong>
                      <Btn variant="danger" style={{ padding:"3px 7px", fontSize:10 }} onClick={()=>setConfirmarExc(entrada.id)}>✕</Btn>
                    </span>
                  </div>
                ))}
                <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 12px" }}>
                  <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)", fontWeight:700 }}>TOTAL DE RENDAS</span>
                  <span style={{ fontSize:14, fontWeight:900, color:"#00C896" }}>{fmt(totalRendas)}</span>
                </div>
              </div>
            </div>
            <div style={{ height:1, background:"rgba(255,255,255,0.07)", marginBottom:12 }} />
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", textTransform:"uppercase", letterSpacing:1, marginBottom:8 }}>Gastos</div>
              {[
                { label:"Fixos mensais", val:totalFixos,  color:"#4F8EF7" },
                { label:"A vista",       val:totalAvista, color:"#FF8C42" },
                { label:"Parcelados",    val:totalParc,   color:"#C06E7A" },
              ].filter(r=>r.val>0).map(r => (
                <div key={r.label} style={{ display:"flex", justifyContent:"space-between", padding:"7px 12px", marginBottom:4, background:"rgba(255,107,107,0.06)", borderRadius:8 }}>
                  <span style={{ fontSize:13, color:"rgba(255,255,255,0.6)" }}>{r.label}</span>
                  <span style={{ fontSize:13, fontWeight:700, color:r.color }}>- {fmt(r.val)}</span>
                </div>
              ))}
              <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 12px" }}>
                <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)", fontWeight:700 }}>TOTAL DE GASTOS</span>
                <span style={{ fontSize:14, fontWeight:900, color:"#FF6B6B" }}>- {fmt(totalMes)}</span>
              </div>
            </div>
            <div style={{ height:1, background:"rgba(255,255,255,0.07)", marginBottom:14 }} />
            <div style={{ background:saldo>=0?"rgba(0,200,150,0.12)":"rgba(255,107,107,0.12)", border:`1px solid ${saldo>=0?"rgba(0,200,150,0.3)":"rgba(255,107,107,0.3)"}`, borderRadius:14, padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Resultado do Mes</div>
                <div style={{ fontSize:12, color:"rgba(255,255,255,0.35)" }}>
                  {saldo>=0 ? `${pctGasto.toFixed(1)}% comprometido` : `Deficit acima da renda`}
                </div>
              </div>
              <div style={{ fontSize:28, fontWeight:900, color:saldo>=0?"#00C896":"#FF6B6B" }}>
                {saldo>=0?"+":""}{fmt(saldo)}
              </div>
            </div>
          </Card>
          {/* Gastos por Categoria */}
          <Card>
            <div style={{ fontSize:12, color:"rgba(238,196,200,0.6)", fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:14 }}>Gastos por Categoria</div>
            {CATEGORIAS_PESSOAL.map(cat=>{
              const total = [...gastosMes,...gastosFixos].filter(g=>g.categoria===cat.id).reduce((s,g)=>s+parseFloat(g.valor||0),0);
              if (!total) return null;
              return (
                <div key={cat.id} style={{ marginBottom:11 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                    <span style={{ fontSize:13, color:"rgba(255,255,255,0.75)" }}>{cat.icon} {cat.label}</span>
                    <div style={{ textAlign:"right" }}>
                      <span style={{ fontSize:13, fontWeight:700, color:cat.cor }}>{fmt(total)}</span>
                      <span style={{ fontSize:10, color:"rgba(255,255,255,0.3)", marginLeft:6 }}>{lucroAtelier>0?(total/lucroAtelier*100).toFixed(1):0}%</span>
                    </div>
                  </div>
                  <div style={{ height:5, background:"rgba(255,255,255,0.06)", borderRadius:3 }}>
                    <div style={{ height:5, background:cat.cor, borderRadius:3, width:totalMes>0?`${total/totalMes*100}%`:"0%", transition:"width 0.4s" }}/>
                  </div>
                </div>
              );
            })}
            {totalMes===0 && <div style={{ color:"rgba(255,255,255,0.3)", fontSize:13, textAlign:"center", padding:"16px 0" }}>Nenhum gasto registrado este mes.</div>}
          </Card>
        </div>
      )}
      {aba==="fixos" && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {gastosFixos.length===0&&<Card style={{textAlign:"center",padding:32}}><div style={{color:"rgba(255,255,255,0.3)"}}>Nenhum gasto fixo.</div></Card>}
          {gastosFixos.map(g=><CardGasto key={g.id} g={g}/>)}
        </div>
      )}
      {aba==="avista" && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {gastosAvista.length===0&&<Card style={{textAlign:"center",padding:32}}><div style={{color:"rgba(255,255,255,0.3)"}}>Nenhum gasto à vista este mês.</div></Card>}
          {gastosAvista.map(g=><CardGasto key={g.id} g={g}/>)}
        </div>
      )}
      {aba==="parcelados" && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {gastosParc.length===0&&<Card style={{textAlign:"center",padding:32}}><div style={{color:"rgba(255,255,255,0.3)"}}>Nenhum parcelado este mês.</div></Card>}
          {gastosParc.map(g=><CardGasto key={g.id} g={g}/>)}
        </div>
      )}
      {aba==="todos" && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {[...gastosFixos,...gastosMes].length===0&&<Card style={{textAlign:"center",padding:32}}><div style={{color:"rgba(255,255,255,0.3)"}}>Nenhum gasto encontrado.</div></Card>}
          {[...gastosFixos,...[...gastosAvista,...gastosParc].sort((a,b)=>new Date(b.data)-new Date(a.data))].map(g=><CardGasto key={g.id} g={g}/>)}
        </div>
      )}

      {/* Modal gasto */}
      {modalGasto && (
        <Modal title={editGasto?"Editar Gasto":"Novo Gasto"} onClose={()=>setModalGasto(false)}>
          <Input label="Descrição *" value={formGasto.descricao} onChange={e=>setFormGasto(f=>({...f,descricao:e.target.value}))} placeholder="Ex: Aluguel, Netflix, Mercado..." />
          <Input label="Valor (R$) *" type="number" step="0.01" value={formGasto.valor} onChange={e=>setFormGasto(f=>({...f,valor:e.target.value}))} />
          <Select label="Categoria" value={formGasto.categoria} onChange={e=>setFormGasto(f=>({...f,categoria:e.target.value}))}
            options={CATEGORIAS_PESSOAL.map(c=>({value:c.id,label:`${c.icon} ${c.label}`}))} />
          <Select label="Tipo" value={formGasto.tipo} onChange={e=>setFormGasto(f=>({...f,tipo:e.target.value}))}
            options={[{value:"avista",label:"$ À Vista"},{value:"parcelado",label:"▣ Parcelado"}]} />
          {formGasto.tipo==="parcelado" && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Input label="Parcela atual" type="number" min="1" value={formGasto.parcelaAtual} onChange={e=>setFormGasto(f=>({...f,parcelaAtual:parseInt(e.target.value)||1}))} />
              <Input label="Total parcelas" type="number" min="1" value={formGasto.totalParcelas} onChange={e=>setFormGasto(f=>({...f,totalParcelas:parseInt(e.target.value)||2}))} />
            </div>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Input label="Data" type="date" value={formGasto.data} onChange={e=>setFormGasto(f=>({...f,data:e.target.value}))} />
            <Input label="Vencimento" type="date" value={formGasto.vencimento||""} onChange={e=>setFormGasto(f=>({...f,vencimento:e.target.value}))} />
          </div>
          <div style={{ display:"flex", gap:20, marginBottom:16 }}>
            <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
              <input type="checkbox" checked={formGasto.fixo} onChange={e=>setFormGasto(f=>({...f,fixo:e.target.checked}))}
                style={{ width:18, height:18, accentColor:"#4F8EF7" }}/>
              <span style={{ fontSize:13, color:"rgba(238,196,200,0.8)" }}>Gasto fixo mensal</span>
            </label>
            <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer" }}>
              <input type="checkbox" checked={formGasto.pago} onChange={e=>setFormGasto(f=>({...f,pago:e.target.checked}))}
                style={{ width:18, height:18, accentColor:"#00C896" }}/>
              <span style={{ fontSize:13, color:"rgba(238,196,200,0.8)" }}>Já pago</span>
            </label>
          </div>
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn variant="ghost" onClick={()=>setModalGasto(false)}>Cancelar</Btn>
            <Btn onClick={salvarGasto}>Salvar</Btn>
          </div>
        </Modal>
      )}

      {modalEntrada && (
        <Modal title="Nova Entrada" onClose={()=>setModalEntrada(false)}>
          <Input label="Descrição *" value={formEntrada.descricao} onChange={e=>setFormEntrada(f=>({...f,descricao:e.target.value}))} placeholder="Ex: Salário, venda, renda extra..." />
          <Input label="Valor (R$) *" type="number" step="0.01" min="0.01" value={formEntrada.valor} onChange={e=>setFormEntrada(f=>({...f,valor:e.target.value}))} />
          <Input label="Data" type="date" value={formEntrada.data} onChange={e=>setFormEntrada(f=>({...f,data:e.target.value}))} />
          <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
            <Btn variant="ghost" onClick={()=>setModalEntrada(false)}>Cancelar</Btn>
            <Btn onClick={salvarEntrada} style={{ background:"linear-gradient(135deg,#00A879,#008A68)" }}>Salvar Entrada</Btn>
          </div>
        </Modal>
      )}

      {confirmarExc && (
        <div style={{ position:"fixed", inset:0, background:"rgba(10,8,30,0.85)", backdropFilter:"blur(10px)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div style={{ background:"linear-gradient(145deg,#2a2d30,#3a3d40)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:32, maxWidth:340, width:"100%", textAlign:"center" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>✕</div>
            <div style={{ fontWeight:800, fontSize:17, color:"#FFF", marginBottom:8 }}>Excluir lançamento?</div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", marginBottom:24 }}>Esta ação não pode ser desfeita.</div>
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <Btn variant="ghost" onClick={()=>setConfirmarExc(null)}>Cancelar</Btn>
              <Btn variant="danger" onClick={excluir}>Excluir</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Relatórios ─────────────────────────────────────────────────────────────────────────────────────────────────────
function Relatorios({ data, empresa, goBack }) {
  const emp = empresa || {};
  const [periodo, setPeriodo] = useState({ inicio: "", fim: "" });
  const [pdfView, setPdfView] = useState(null);
  const [abaRel, setAbaRel] = useState("os");

  const filtrar = (o) => {
    if (!periodo.inicio && !periodo.fim) return true;
    const d = new Date(o.dataCriacao);
    if (periodo.inicio && d < new Date(periodo.inicio)) return false;
    if (periodo.fim   && d > new Date(periodo.fim))    return false;
    return true;
  };

  const ordens = data.ordens.filter(filtrar);
  const totalFat    = ordens.reduce((s,o) => s+(o.valorTotal||0), 0);
  const totalPecas  = ordens.reduce((s,o) => s+(o.itens?.reduce((a,i)=>a+i.qtdTotal,0)||0), 0);
  const recebido    = ordens.filter(o=>o.status==="Entregue" && isOrdemPaga(o)).reduce((s,o)=>s+(o.valorTotal||0),0);
  const aReceber    = ordens.filter(o=>isOrdemAReceber(o)).reduce((s,o)=>s+(o.valorTotal||0),0);
  const cancelado   = ordens.filter(o=>o.status==="Cancelada").reduce((s,o)=>s+(o.valorTotal||0),0);

  const SC = { Aberta:"#4F8EF7","Em Produção":"#FF8C42",Finalizada:"#C06E7A",Entregue:"#00C896",Cancelada:"#FF6B6B" };

  const periodoLabel = () => {
    if (!periodo.inicio && !periodo.fim) return "Todos os períodos";
    return `${periodo.inicio ? fmtDate(periodo.inicio) : "Início"} até ${periodo.fim ? fmtDate(periodo.fim) : "Hoje"}`;
  };

  const cabecalhoPDF = (titulo) => `
    <div class="header">
      <div class="logo-block">
        <div class="logo"><span class="dot">●</span> ${emp.nome || "Atelier Costura Pro"}</div>
        <div class="tagline">Costura Pro</div>
        <div class="emp-info">
          ${emp.cnpj ? "CNPJ: " + emp.cnpj + (emp.ie ? " · IE: " + emp.ie : "") + "<br>" : ""}
          ${emp.telefone ? emp.telefone + (emp.email ? " · " + emp.email : "") : ""}
        </div>
      </div>
      <div class="doc-info">
        <div class="doc-title">${titulo}</div>
        <div class="doc-meta">Período: ${periodoLabel()}<br>Emissão: ${new Date().toLocaleDateString("pt-BR")}</div>
      </div>
    </div>`;

  const resumoPDF = () => `
    <div class="section-title">Resumo Executivo</div>
    <div class="fields">
      <div class="field"><label>Total de OS</label><value>${ordens.length}</value></div>
      <div class="field"><label>Total de Peças</label><value>${totalPecas}</value></div>
      <div class="field"><label>Faturamento Geral</label><value>${fmt(totalFat)}</value></div>
      <div class="field"><label>Ticket Médio</label><value>${ordens.length>0?fmt(totalFat/ordens.length):"R$ 0,00"}</value></div>
    </div>`;

  // ── Relatório de OS ────────────────────────────────────────────────────────
  const gerarRelOS = () => {
    const html = cabecalhoPDF("Relatório de Ordens de Serviço") + resumoPDF() + `
      <h2>Listagem de Ordens</h2>
      <table>
        <thead><tr><th>Nº OS</th><th>Cliente</th><th>Emissão</th><th>Entrega</th><th>Peças</th><th>Valor</th><th>Status</th></tr></thead>
        <tbody>
          ${ordens.map(o=>`
            <tr>
              <td style="font-weight:700;color:#c8a96e">#${String(o.numero).padStart(4,"0")}</td>
              <td>${o.cliente}</td>
              <td>${fmtDate(o.dataCriacao)}</td>
              <td>${o.dataEntrega?fmtDate(o.dataEntrega):"—"}</td>
              <td style="text-align:center">${o.itens?.reduce((a,i)=>a+i.qtdTotal,0)||0}</td>
              <td style="text-align:right;font-weight:700">${fmt(o.valorTotal)}</td>
              <td><span class="badge">${o.status}</span></td>
            </tr>
            ${(o.itens||[]).map(it=>`
              <tr style="background:#f5f5f5">
                <td style="padding-left:24px;color:#999;font-size:11px" colspan="2">↳ ${it.nomePeca}</td>
                <td colspan="2" style="font-size:11px;color:#999">
                  Grade: ${Object.entries(it.grade||{}).filter(([,v])=>v>0).map(([g,v])=>`${g}:${v}`).join(" · ")}
                </td>
                <td style="text-align:center;font-size:11px;color:#999">${it.qtdTotal}</td>
                <td style="text-align:right;font-size:11px;color:#999">${fmt(it.valorItem)}</td>
                <td></td>
              </tr>`).join("")}
          `).join("")}
        </tbody>
      </table>
      <div class="total-box"><span class="total-label">Total</span><span class="total-value">TOTAL GERAL: ${fmt(totalFat)}</span></div>`;
    setPdfView({ htmlContent: gerarPDF(html, "Relatório de OS"), titulo: "Relatório de OS" });
  };

  // ── Relatório de Faturamento ───────────────────────────────────────────────
  const gerarRelFaturamento = () => {
    const porMes = {};
    ordens.forEach(o => {
      const d = new Date(o.dataCriacao);
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      const label = d.toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
      if (!porMes[k]) porMes[k] = { label, valor:0, qtd:0, pecas:0 };
      porMes[k].valor += o.valorTotal||0;
      porMes[k].qtd++;
      porMes[k].pecas += o.itens?.reduce((a,i)=>a+i.qtdTotal,0)||0;
    });
    const meses = Object.entries(porMes).sort((a,b)=>a[0].localeCompare(b[0]));
    const html = cabecalhoPDF("Relatório de Faturamento") + `
      <h2>Resumo Financeiro</h2>
      <div class="fields">
        <div class="field"><label>Faturamento Total</label><value>${fmt(totalFat)}</value></div>
        <div class="field"><label>Recebido</label><value style="color:#2e7d32">${fmt(recebido)}</value></div>
        <div class="field"><label>A Receber</label><value style="color:#1565c0">${fmt(aReceber)}</value></div>
        <div class="field"><label>Cancelado</label><value style="color:#c62828">${fmt(cancelado)}</value></div>
      </div>
      <h2>Faturamento por Mês</h2>
      <table>
        <thead><tr><th>Mês</th><th>OS</th><th>Peças</th><th>Faturamento</th><th>Ticket Médio</th></tr></thead>
        <tbody>
          ${meses.map(([,m])=>`
            <tr>
              <td style="font-weight:700;text-transform:capitalize">${m.label}</td>
              <td style="text-align:center">${m.qtd}</td>
              <td style="text-align:center">${m.pecas}</td>
              <td style="text-align:right;font-weight:700">${fmt(m.valor)}</td>
              <td style="text-align:right">${m.qtd>0?fmt(m.valor/m.qtd):"—"}</td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div class="total-box"><span class="total-label">Total</span><span class="total-value">FATURAMENTO TOTAL: ${fmt(totalFat)}</span></div>
      <h2 style="margin-top:30px">Faturamento por Status</h2>
      <table>
        <thead><tr><th>Status</th><th>Qtd OS</th><th>Total</th><th>%</th></tr></thead>
        <tbody>
          ${["Entregue","Finalizada","Em Produção","Aberta","Cancelada"].map(s=>{
            const ords = ordens.filter(o=>o.status===s);
            const val = ords.reduce((a,o)=>a+(o.valorTotal||0),0);
            return ords.length>0?`<tr><td>${s}</td><td style="text-align:center">${ords.length}</td><td style="text-align:right;font-weight:700">${fmt(val)}</td><td style="text-align:center">${totalFat>0?(val/totalFat*100).toFixed(1):0}%</td></tr>`:"";
          }).join("")}
        </tbody>
      </table>`;
    setPdfView({ htmlContent: gerarPDF(html, "Relatório de Faturamento"), titulo: "Relatório de Faturamento" });
  };

  // ── Relatório de Contas ────────────────────────────────────────────────────
  const gerarRelContas = () => {
    const entregues = ordens.filter(o=>o.status==="Entregue" && isOrdemPaga(o));
    const emAberto  = ordens.filter(o=>isOrdemAReceber(o));
    const html = cabecalhoPDF("Relatório de Contas") + `
      <h2>Resumo de Contas</h2>
      <div class="fields">
        <div class="field"><label>Total Recebido</label><value style="color:#2e7d32">${fmt(recebido)}</value></div>
        <div class="field"><label>Total a Receber</label><value style="color:#1565c0">${fmt(aReceber)}</value></div>
        <div class="field"><label>Cancelado</label><value style="color:#c62828">${fmt(cancelado)}</value></div>
        <div class="field"><label>Saldo Geral</label><value>${fmt(totalFat-cancelado)}</value></div>
      </div>
      <h2>Contas Recebidas (Entregas)</h2>
      <table>
        <thead><tr><th>Nº OS</th><th>Cliente</th><th>Data</th><th>Peças</th><th>Valor Recebido</th></tr></thead>
        <tbody>
          ${entregues.length>0?entregues.map(o=>`
            <tr>
              <td style="font-weight:700;color:#c8a96e">#${String(o.numero).padStart(4,"0")}</td>
              <td>${o.cliente}</td>
              <td>${fmtDate(o.dataCriacao)}</td>
              <td style="text-align:center">${o.itens?.reduce((a,i)=>a+i.qtdTotal,0)||0}</td>
              <td style="text-align:right;font-weight:700;color:#2e7d32">${fmt(o.valorTotal)}</td>
            </tr>`).join("") : "<tr><td colspan='5' style='text-align:center;color:#999'>Nenhuma entrega no período</td></tr>"}
        </tbody>
      </table>
      <div class="total" style="background:#2e7d32">TOTAL RECEBIDO: ${fmt(recebido)}</div>
      <h2 style="margin-top:30px">Contas a Receber (Em Aberto)</h2>
      <table>
        <thead><tr><th>Nº OS</th><th>Cliente</th><th>Status</th><th>Entrega Prev.</th><th>Valor a Receber</th></tr></thead>
        <tbody>
          ${emAberto.length>0?emAberto.map(o=>`
            <tr>
              <td style="font-weight:700;color:#c8a96e">#${String(o.numero).padStart(4,"0")}</td>
              <td>${o.cliente}</td>
              <td><span class="badge">${o.status}</span></td>
              <td>${o.dataEntrega?fmtDate(o.dataEntrega):"—"}</td>
              <td style="text-align:right;font-weight:700;color:#1565c0">${fmt(o.valorTotal)}</td>
            </tr>`).join("") : "<tr><td colspan='5' style='text-align:center;color:#999'>Nenhuma conta em aberto</td></tr>"}
        </tbody>
      </table>
      <div class="total" style="background:#1565c0">TOTAL A RECEBER: ${fmt(aReceber)}</div>`;
    setPdfView({ htmlContent: gerarPDF(html, "Relatório de Contas"), titulo: "Relatório de Contas" });
  };

  // ── Relatório de Produção ──────────────────────────────────────────────────
  const gerarRelProducao = () => {
    const statusList = ["Aberta","Em Produção","Finalizada","Entregue","Cancelada"];
    const porPeca = {};
    ordens.forEach(o => (o.itens||[]).forEach(i => {
      if (!porPeca[i.nomePeca]) porPeca[i.nomePeca] = { qtd:0, valor:0, os:0 };
      porPeca[i.nomePeca].qtd   += i.qtdTotal||0;
      porPeca[i.nomePeca].valor += i.valorItem||0;
      porPeca[i.nomePeca].os++;
    }));
    const html = cabecalhoPDF("Relatório de Produção") + `
      <h2>Resumo de Produção</h2>
      <div class="fields">
        <div class="field"><label>Total de OS</label><value>${ordens.length}</value></div>
        <div class="field"><label>Total de Peças Produzidas</label><value>${totalPecas}</value></div>
        <div class="field"><label>Média Peças/OS</label><value>${ordens.length>0?(totalPecas/ordens.length).toFixed(1):0}</value></div>
      </div>
      <h2>Produção por Status</h2>
      <table>
        <thead><tr><th>Status</th><th>Qtd OS</th><th>Peças</th><th>Valor</th></tr></thead>
        <tbody>
          ${statusList.map(s=>{
            const ords = ordens.filter(o=>o.status===s);
            const pecas = ords.reduce((a,o)=>a+(o.itens?.reduce((b,i)=>b+i.qtdTotal,0)||0),0);
            const valor = ords.reduce((a,o)=>a+(o.valorTotal||0),0);
            return ords.length>0?`<tr><td>${s}</td><td style="text-align:center">${ords.length}</td><td style="text-align:center">${pecas}</td><td style="text-align:right;font-weight:700">${fmt(valor)}</td></tr>`:"";
          }).join("")}
        </tbody>
      </table>
      <h2>Produção por Tipo de Peça</h2>
      <table>
        <thead><tr><th>Tipo de Peça</th><th>OS</th><th>Qtd Produzida</th><th>Receita</th><th>Vlr Médio</th></tr></thead>
        <tbody>
          ${Object.entries(porPeca).sort((a,b)=>b[1].qtd-a[1].qtd).map(([nome,v])=>`
            <tr>
              <td style="font-weight:700">${nome}</td>
              <td style="text-align:center">${v.os}</td>
              <td style="text-align:center;font-weight:700">${v.qtd}</td>
              <td style="text-align:right;font-weight:700">${fmt(v.valor)}</td>
              <td style="text-align:right">${v.qtd>0?fmt(v.valor/v.qtd):"—"}</td>
            </tr>`).join("")}
        </tbody>
      </table>
      <h2>Detalhamento de Ordens por Grade</h2>
      <table>
        <thead><tr><th>Nº OS</th><th>Cliente</th><th>Peça</th><th colspan="2">Grade (Tam:Qtd)</th><th>Total</th></tr></thead>
        <tbody>
          ${ordens.map(o=>(o.itens||[]).map(it=>`
            <tr>
              <td style="font-weight:700;color:#c8a96e">#${String(o.numero).padStart(4,"0")}</td>
              <td>${o.cliente}</td>
              <td>${it.nomePeca}</td>
              <td colspan="2" style="font-size:11px">
                ${Object.entries(it.grade||{}).filter(([,v])=>v>0).map(([g,v])=>`${g}:${v}`).join("  ")}
              </td>
              <td style="text-align:center;font-weight:700">${it.qtdTotal}</td>
            </tr>`).join("")).join("")}
        </tbody>
      </table>`;
    setPdfView({ htmlContent: gerarPDF(html, "Relatório de Produção"), titulo: "Relatório de Produção" });
  };

  // ── Nota de Serviço em lote ────────────────────────────────────────────────
  const gerarNotaServico = (o) => {
    const issAliq = parseFloat(emp.aliquota_iss||3);
    const valorIss = o.valorTotal * issAliq / 100;
    const valorLiquido = o.valorTotal - valorIss;
    const html = `
      <div class="header" style="margin-bottom:20px">
        <div class="logo-block">
          <div class="logo"><span class="dot">●</span> ${emp.nome || "Atelier Costura Pro"}</div>
          <div class="tagline">NOTA FISCAL DE SERVIÇOS</div>
          <div class="emp-info">
            ${emp.cnpj ? "CNPJ: " + emp.cnpj : ""}${emp.municipio_codigo ? " · Reg. Mun.: " + emp.municipio_codigo : ""}<br>
            ${emp.endereco ? emp.endereco + (emp.cidade ? ", " + emp.cidade : "") + (emp.estado ? " - " + emp.estado : "") : ""}<br>
            ${emp.telefone ? "Tel.: " + emp.telefone : ""}
          </div>
        </div>
        <div class="doc-info">
          <div class="doc-title">NFS-e</div>
          <div class="doc-meta"><strong>Nº ${String(o.numero).padStart(6,"0")}</strong><br>Emissão: ${fmtDate(o.dataCriacao)}<br>Competência: ${fmtDate(o.dataCriacao)}<br><span class="badge">Em aberto</span></div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1.2fr 0.8fr;gap:16px;margin-bottom:18px">
        <div style="background:#F8F9FB;border:1px solid #EAECF0;border-radius:14px;padding:16px 18px">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#8892A4;font-weight:700;margin-bottom:8px">Tomador</div>
          <div style="font-size:14px;font-weight:800;color:#1C1C2E">${o.cliente}</div>
          <div style="font-size:12px;color:#6B7280;margin-top:6px">CPF/CNPJ: ${o.documento||"Não informado"}</div>
          <div style="font-size:12px;color:#6B7280">Telefone: ${o.telefone||"—"}</div>
          ${o.email ? `<div style="font-size:12px;color:#6B7280">E-mail: ${o.email}</div>` : ""}
        </div>
        <div style="background:#FFF7F2;border:1px solid #F3D9CC;border-radius:14px;padding:16px 18px">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#C06E7A;font-weight:700;margin-bottom:8px">Cobrança</div>
          <div style="font-size:13px;font-weight:700;color:#1C1C2E">Boleto / Cobrança</div>
          <div style="font-size:12px;color:#6B7280;margin-top:6px">Vencimento: ${o.dataEntrega ? fmtDate(o.dataEntrega) : "A definir"}</div>
          <div style="font-size:12px;color:#6B7280">Valor: ${fmt(o.valorTotal)}</div>
        </div>
      </div>

      <div class="section-title">Discriminação dos Serviços</div>
      <table>
        <thead><tr><th>Descrição</th><th style="text-align:center">Qtd</th><th style="text-align:right">Vlr. Unit.</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>
          ${(o.itens||[]).map(it=>`
            <tr>
              <td><strong>${it.nomePeca}</strong><br><span style="font-size:10px;color:#8892A4">${Object.entries(it.grade||{}).filter(([,v])=>v>0).map(([g,v])=>g+":"+v).join(" · ")}</span></td>
              <td style="text-align:center;font-weight:700;color:#6C63FF">${it.qtdTotal}</td>
              <td style="text-align:right">${fmt(it.valorUnitario||0)}</td>
              <td style="text-align:right;font-weight:700">${fmt(it.valorItem)}</td>
            </tr>`).join("")}
          ${(o.processosSelecionados||[]).map(p=>`
            <tr>
              <td><strong>Processo:</strong> ${p.nome}</td>
              <td style="text-align:center">—</td>
              <td style="text-align:right">—</td>
              <td style="text-align:right;font-weight:700">${fmt(p.valorTotal)}</td>
            </tr>`).join("")}
        </tbody>
      </table>

      <div class="total-box"><span class="total-label">Valor Total dos Serviços</span><span class="total-value">${fmt(o.valorTotal)}</span></div>

      <div class="section-title" style="margin-top:24px">Tributação</div>
      <div class="nfs-iss">
        <div class="field"><label>Base de Cálculo ISS</label><value>${fmt(o.valorTotal)}</value></div>
        <div class="field"><label>Alíquota ISS</label><value>${issAliq.toFixed(2).replace(".",",")}%</value></div>
        <div class="field"><label>Valor ISS</label><value>${fmt(valorIss)}</value></div>
        <div class="field"><label>Valor Líquido</label><value style="color:#00C896">${fmt(valorLiquido)}</value></div>
      </div>

      ${o.observacoes?`<div style="margin-top:16px;padding:16px 20px;background:#F8F9FB;border-radius:12px;font-size:12px;color:#6B7280;border:1px solid #EAECF0"><strong style="color:#1C1C2E">Observações:</strong> ${o.observacoes}</div>`:""}

      <div style="margin-top:24px;border:1px dashed #D6DCE4;border-radius:12px;padding:14px 16px;background:#FCFCFD;font-size:11px;color:#6B7280;line-height:1.6">
        <strong style="color:#1C1C2E">Observação:</strong> Este documento representa o comprovante de serviços prestados e pode ser usado para controle interno. Para emissão oficial da NFS-e, siga o fluxo da Prefeitura Municipal.
      </div>

      <div class="sign-row">
        <div class="sign-line">Assinatura do Cliente</div>
        <div class="sign-line">Responsável pelo Serviço</div>
      </div>`;
    setPdfView({ htmlContent: gerarPDF(html, `NFS-e ${String(o.numero).padStart(6,"0")}`), titulo: `NFS-e nº ${String(o.numero).padStart(6,"0")} — ${o.cliente}` });
  };

  const abaStyle = (id) => ({
    padding: "9px 18px", border: "none", cursor: "pointer", background: "transparent",
    color: abaRel === id ? "#C06E7A" : "#8892A4", fontWeight: abaRel === id ? 700 : 400,
    fontSize: 13, borderBottom: abaRel === id ? "2px solid #9C8FFF" : "2px solid transparent",
    fontFamily: "Georgia, serif", whiteSpace: "nowrap", transition: "all 0.15s",
  });

  return (
    <div>
      <BtnVoltar onClick={goBack} />
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: -0.5, color:"#FFF" }}>Relatórios & Documentos</h1>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Gere PDFs completos de cada módulo</p>
      </div>

      {/* Filtro de período */}
      <Card style={{ marginBottom: 20, padding: 16 }}>
        <h3 style={{ fontSize: 11, color: "#C06E7A", letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>Filtrar por Período</h3>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={{ display: "block", fontSize: 10, color: "#C06E7A", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5, fontWeight: 700 }}>De</label>
            <input type="date" value={periodo.inicio} onChange={e => setPeriodo(p => ({ ...p, inicio: e.target.value }))}
              style={{ width: "100%", background: "#F4F5F7", border: "1px solid #2a2a3e", borderRadius: 6, padding: "9px 12px", color: "#1C1C2E", fontSize: 13, outline: "none" }} />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={{ display: "block", fontSize: 10, color: "#C06E7A", textTransform: "uppercase", letterSpacing: 1, marginBottom: 5, fontWeight: 700 }}>Até</label>
            <input type="date" value={periodo.fim} onChange={e => setPeriodo(p => ({ ...p, fim: e.target.value }))}
              style={{ width: "100%", background: "#F4F5F7", border: "1px solid #2a2a3e", borderRadius: 6, padding: "9px 12px", color: "#1C1C2E", fontSize: 13, outline: "none" }} />
          </div>
          <Btn variant="ghost" onClick={() => setPeriodo({ inicio: "", fim: "" })}>Limpar</Btn>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: "#8892A4" }}>
          {ordens.length} ordens · {periodoLabel()}
        </div>
      </Card>

      {/* Abas */}
      <div style={{ borderBottom: "1px solid #1e2030", marginBottom: 20, display: "flex", overflowX: "auto" }}>
        {[["os","◎ Ordens de Serviço"],["faturamento","◉ Faturamento"],["contas","◷ Contas"],["producao","◇ Produção"],["nfs","★ Nota de Serviço"]].map(([id,l]) => (
          <button key={id} style={abaStyle(id)} onClick={() => setAbaRel(id)}>{l}</button>
        ))}
      </div>

      {/* ── ABA OS ──────────────────────────────────────────────────────────── */}
      {abaRel === "os" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: "#9CA3AF" }}>{ordens.length} ordens no período</div>
            <Btn onClick={gerarRelOS}>⎙ Gerar PDF</Btn>
          </div>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1e2030" }}>
                  {["Nº OS","Cliente","Emissão","Entrega","Peças","Valor","Status"].map(h => (
                    <th key={h} style={{ padding: "11px 14px", fontSize: 10, color: "#8892A4", textAlign: "left", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordens.length === 0 && <tr><td colSpan={7} style={{ padding: 32, textAlign: "center", color: "#8892A4" }}>Nenhuma ordem no período.</td></tr>}
                {ordens.map((o,i) => (
                  <tr key={o.id} style={{ borderBottom: "1px solid #1e203044", background: i%2===0?"transparent":"rgba(255,255,255,0.03)" }}>
                    <td style={{ padding: "10px 14px", color: "#C06E7A", fontWeight: 800, fontFamily: "monospace" }}>#{String(o.numero).padStart(4,"0")}</td>
                    <td style={{ padding: "10px 14px", fontSize: 13, fontWeight: 600 }}>{o.cliente}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "#6B7280" }}>{fmtDate(o.dataCriacao)}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "#6B7280" }}>{o.dataEntrega?fmtDate(o.dataEntrega):"—"}</td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "#9CA3AF", textAlign: "center" }}>{o.itens?.reduce((a,i)=>a+i.qtdTotal,0)||0}</td>
                    <td style={{ padding: "10px 14px", fontWeight: 700, color: "#00C896" }}>{fmt(o.valorTotal)}</td>
                    <td style={{ padding: "10px 14px" }}><Badge color={SC[o.status]||"#9CA3AF"}>{o.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
              {ordens.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: "2px solid #1e2030", background: "#F4F5F7" }}>
                    <td colSpan={4} style={{ padding: "11px 14px", fontSize: 11, color: "#8892A4", fontWeight: 700 }}>TOTAL DO PERÍODO</td>
                    <td style={{ padding: "11px 14px", textAlign: "center", fontWeight: 800, color: "#C06E7A" }}>{totalPecas}</td>
                    <td style={{ padding: "11px 14px", fontWeight: 900, fontSize: 15, color: "#00C896" }}>{fmt(totalFat)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </Card>
        </div>
      )}

      {/* ── ABA FATURAMENTO ─────────────────────────────────────────────────── */}
      {abaRel === "faturamento" && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
            <Btn onClick={gerarRelFaturamento}>⎙ Gerar PDF</Btn>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Faturamento Total", value: fmt(totalFat),  color: "#C06E7A" },
              { label: "Recebido",          value: fmt(recebido),  color: "#00C896" },
              { label: "A Receber",         value: fmt(aReceber),  color: "#4F8EF7" },
              { label: "Cancelado",         value: fmt(cancelado), color: "#FF6B6B" },
            ].map(s => (
              <Card key={s.label} style={{ textAlign: "center", padding: 18 }}>
                <div style={{ fontWeight: 900, fontSize: 18, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 10, color: "#8892A4", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>{s.label}</div>
              </Card>
            ))}
          </div>
          <Card>
            <h3 style={{ fontSize: 11, color: "#C06E7A", letterSpacing: 1, textTransform: "uppercase", marginBottom: 14 }}>Por Status</h3>
            {["Entregue","Finalizada","Em Produção","Aberta","Cancelada"].map(s => {
              const ords = ordens.filter(o=>o.status===s);
              const val  = ords.reduce((a,o)=>a+(o.valorTotal||0),0);
              if (!ords.length) return null;
              return (
                <div key={s} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: SC[s]||"#9CA3AF" }} />
                      <span style={{ fontSize: 12 }}>{s} ({ords.length} OS)</span>
                    </div>
                    <span style={{ fontWeight: 700, fontSize: 13, color: SC[s]||"#9CA3AF" }}>{fmt(val)}</span>
                  </div>
                  <div style={{ height: 4, background: "#EAECF0", borderRadius: 2 }}>
                    <div style={{ height: 4, background: SC[s]||"#9CA3AF", borderRadius: 2, width: totalFat>0?`${val/totalFat*100}%`:"0%" }} />
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
      )}

      {/* ── ABA CONTAS ──────────────────────────────────────────────────────── */}
      {abaRel === "contas" && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
            <Btn onClick={gerarRelContas}>⎙ Gerar PDF</Btn>
          </div>
          {[
            { titulo: "Recebido (Entregues)", cor: "#00C896", lista: ordens.filter(o=>o.status==="Entregue"), total: recebido },
            { titulo: "A Receber (Em Aberto)", cor: "#4F8EF7", lista: ordens.filter(o=>["Aberta","Em Produção","Finalizada"].includes(o.status)), total: aReceber },
            { titulo: "Cancelado", cor: "#FF6B6B", lista: ordens.filter(o=>o.status==="Cancelada"), total: cancelado },
          ].map(grupo => (
            <div key={grupo.titulo} style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 4, height: 20, background: grupo.cor, borderRadius: 2 }} />
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{grupo.titulo}</span>
                  <span style={{ fontSize: 12, color: "#8892A4" }}>({grupo.lista.length})</span>
                </div>
                <span style={{ fontWeight: 900, fontSize: 16, color: grupo.cor }}>{fmt(grupo.total)}</span>
              </div>
              {grupo.lista.length === 0 ? (
                <div style={{ padding: "12px 16px", background: "#FFFFFF", borderRadius: 8, fontSize: 13, color: "#8892A4" }}>Nenhuma ordem nesta categoria.</div>
              ) : (
                <Card style={{ padding: 0, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr style={{ borderBottom: "1px solid #1e2030" }}>
                      {["Nº OS","Cliente","Data","Entrega Prev.","Valor"].map(h=>(
                        <th key={h} style={{ padding:"9px 14px", fontSize:10, color:"#8892A4", textAlign:"left", fontWeight:700, textTransform:"uppercase" }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {grupo.lista.map((o,i) => (
                        <tr key={o.id} style={{ borderBottom:"1px solid #1e203033", background: i%2===0?"transparent":"rgba(255,255,255,0.03)" }}>
                          <td style={{ padding:"9px 14px", color:"#C06E7A", fontWeight:800, fontFamily:"monospace" }}>#{String(o.numero).padStart(4,"0")}</td>
                          <td style={{ padding:"9px 14px", fontSize:13 }}>{o.cliente}</td>
                          <td style={{ padding:"9px 14px", fontSize:12, color:"#6B7280" }}>{fmtDate(o.dataCriacao)}</td>
                          <td style={{ padding:"9px 14px", fontSize:12, color:"#6B7280" }}>{o.dataEntrega?fmtDate(o.dataEntrega):"—"}</td>
                          <td style={{ padding:"9px 14px", fontWeight:800, color:grupo.cor }}>{fmt(o.valorTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── ABA PRODUÇÃO ────────────────────────────────────────────────────── */}
      {abaRel === "producao" && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
            <Btn onClick={gerarRelProducao}>⎙ Gerar PDF</Btn>
          </div>
          {/* Por peça */}
          <Card style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 11, color: "#C06E7A", letterSpacing: 1, textTransform: "uppercase", marginBottom: 14 }}>Produção por Tipo de Peça</h3>
            {(() => {
              const porPeca = {};
              ordens.forEach(o=>(o.itens||[]).forEach(i=>{
                if (!porPeca[i.nomePeca]) porPeca[i.nomePeca]={qtd:0,valor:0};
                porPeca[i.nomePeca].qtd+=i.qtdTotal||0;
                porPeca[i.nomePeca].valor+=i.valorItem||0;
              }));
              const lista = Object.entries(porPeca).sort((a,b)=>b[1].qtd-a[1].qtd);
              const maxQ = lista[0]?.[1]?.qtd || 1;
              return lista.length===0?<p style={{color:"#8892A4",fontSize:13}}>Sem dados.</p>:lista.map(([nome,v])=>(
                <div key={nome} style={{ marginBottom:12 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontSize:13, fontWeight:600 }}>{nome}</span>
                    <div style={{ display:"flex", gap:16 }}>
                      <span style={{ fontSize:12, color:"#FF8C42", fontWeight:700 }}>{v.qtd} pcs</span>
                      <span style={{ fontSize:12, color:"#00C896", fontWeight:700 }}>{fmt(v.valor)}</span>
                    </div>
                  </div>
                  <div style={{ height:4, background:"#EAECF0", borderRadius:2 }}>
                    <div style={{ height:4, background:"#FF8C42", borderRadius:2, width:`${v.qtd/maxQ*100}%` }} />
                  </div>
                </div>
              ));
            })()}
          </Card>
          {/* Por status */}
          <Card>
            <h3 style={{ fontSize: 11, color: "#C06E7A", letterSpacing: 1, textTransform: "uppercase", marginBottom: 14 }}>Ordens por Status</h3>
            {["Aberta","Em Produção","Finalizada","Entregue","Cancelada"].map(s=>{
              const ords=ordens.filter(o=>o.status===s);
              const pcs=ords.reduce((a,o)=>a+(o.itens?.reduce((b,i)=>b+i.qtdTotal,0)||0),0);
              if(!ords.length) return null;
              return (
                <div key={s} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:"1px solid #1e203033" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:8, height:8, borderRadius:"50%", background:SC[s]||"#9CA3AF" }} />
                    <span style={{ fontSize:13 }}>{s}</span>
                  </div>
                  <div style={{ display:"flex", gap:20 }}>
                    <span style={{ fontSize:12, color:"#8892A4" }}>{ords.length} OS</span>
                    <span style={{ fontSize:12, color:"#FF8C42", fontWeight:700 }}>{pcs} peças</span>
                    <span style={{ fontSize:12, color:"#00C896", fontWeight:700 }}>{fmt(ords.reduce((a,o)=>a+(o.valorTotal||0),0))}</span>
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
      )}

      {/* ── ABA NOTA DE SERVIÇO ─────────────────────────────────────────────── */}
      {abaRel === "nfs" && (
        <div>
          <div style={{ marginBottom: 14, fontSize: 13, color: "#9CA3AF" }}>
            Selecione uma OS para emitir a nota de serviço individual.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ordens.length === 0 && (
              <Card style={{ textAlign:"center", padding:40 }}>
                <div style={{ color:"#8892A4" }}>Nenhuma ordem no período.</div>
              </Card>
            )}
            {ordens.map(o => (
              <Card key={o.id} style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ color:"#C06E7A", fontWeight:900, fontFamily:"monospace", fontSize:15 }}>#{String(o.numero).padStart(4,"0")}</span>
                      <Badge color={SC[o.status]||"#9CA3AF"}>{o.status}</Badge>
                    </div>
                    <div style={{ fontWeight:700, fontSize:14, marginTop:4 }}>{o.cliente}</div>
                    <div style={{ fontSize:11, color:"#8892A4", marginTop:2 }}>
                      {fmtDate(o.dataCriacao)} · {o.itens?.reduce((a,i)=>a+i.qtdTotal,0)||0} peças · {fmt(o.valorTotal)}
                    </div>
                  </div>
                  <button onClick={() => gerarNotaServico(o)}
                    style={{ padding:"9px 20px", background:"linear-gradient(135deg,#c8a96e,#a8843e)", border:"none", borderRadius:8, color:"#F4F5F7", fontWeight:800, fontSize:13, cursor:"pointer", fontFamily:"Georgia, serif" }}>
                    ◉ Emitir Nota Fiscal
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {pdfView && <PDFViewer htmlContent={pdfView.htmlContent} titulo={pdfView.titulo} onClose={() => setPdfView(null)} />}
    </div>
  );
}

// ─── Tela de Login / Cadastro / Ativação ──────────────────────────────────────
function LoginScreen({ onLogin, licenca }) {
  const [tela, setTela] = useState("login");
  const [form, setForm] = useState({ nome: "", email: "", senha: "", confirmar: "", codigo: "" });
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  const handleLogin = () => {
    setErro("");
    const lista = loadUsers();
    const user = lista.find(u => u.email === form.email && u.senha === form.senha);
    if (!user) return setErro("E-mail ou senha incorretos.");
    onLogin({ nome: user.nome, email: user.email });
  };

  const handleCadastro = () => {
    setErro("");
    if (!form.nome || !form.email || !form.senha) return setErro("Preencha todos os campos.");
    if (form.senha !== form.confirmar) return setErro("Senhas não conferem.");
    if (form.senha.length < 4) return setErro("Senha deve ter ao menos 4 caracteres.");
    const lista = loadUsers();
    if (lista.find(u => u.email === form.email)) return setErro("E-mail já cadastrado.");
    const novo = { id: genId(), nome: form.nome, email: form.email, senha: form.senha, criadoEm: new Date().toISOString() };
    saveUsers([...lista, novo]);
    setOk(`Conta criada! Você tem ${TRIAL_DIAS} dias grátis para testar.`);
    setTimeout(() => onLogin({ nome: novo.nome, email: novo.email }), 1800);
  };

  const handleAtivarCodigo = async () => {
    setErro("");
    const cod = form.codigo.trim();
    let licenca;
    try {
      licenca = await validarLicenca(cod, form.email);
    } catch (error) {
      setErro(error.message || "Não foi possível verificar o código neste dispositivo.");
      return;
    }
    if (!licenca) return setErro("Código inválido, vencido ou emitido para outro e-mail.");
    const lista = loadUsers();
    const user = lista.find(u => u.email.trim().toLowerCase() === form.email.trim().toLowerCase());
    if (!user) return setErro("Faça login primeiro para ativar.");
    const tipo = licenca.plano === "ANUAL" ? "anual" : "mensal";
    saveLicense({ tipo, ativadoEm: new Date().toISOString(), expiraEm: new Date(licenca.expiresAt).toISOString(), codigo: cod });
    setOk(`Plano ${tipo} ativado! Bem-vindo.`);
    setTimeout(() => onLogin({ nome: user.nome, email: user.email }), 1500);
  };

  const inp = (label, field, type = "text", placeholder = "") => (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display:"block", fontSize:10, letterSpacing:1, textTransform:"uppercase", color:"#C06E7A", marginBottom:6, fontWeight:700 }}>{label}</label>
      <input type={type} value={form[field]} placeholder={placeholder}
        onChange={e => { setErro(""); setForm(f => ({ ...f, [field]: e.target.value })); }}
        onKeyDown={e => { if (e.key === "Enter") { if (tela==="login") handleLogin(); else if (tela==="cadastro") handleCadastro(); else handleAtivarCodigo(); }}}
        style={{ width:"100%", background:"#F4F5F7", border:"1px solid #2a2a3e", borderRadius:8, padding:"11px 14px", color:"#1C1C2E", fontSize:14, outline:"none", boxSizing:"border-box" }} />
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"radial-gradient(circle at top, #1e293b 0%, #111827 35%, #0f172a 100%)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'Inter', 'Segoe UI', sans-serif", padding:20 }}>
      <div style={{ position:"fixed", inset:0, overflow:"hidden", pointerEvents:"none" }}>
        {[...Array(6)].map((_,i) => (
          <div key={i} style={{ position:"absolute", width:300+i*80, height:300+i*80, border:"1px solid #c8a96e0a", borderRadius:"50%", top:"50%", left:"50%", transform:"translate(-50%,-50%)" }} />
        ))}
      </div>

      <div style={{ width:"100%", maxWidth:440, position:"relative" }}>
        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontSize:36, fontWeight:900, letterSpacing:-2, color:"#1C1C2E" }}>✦ <span style={{ color:"#C06E7A" }}>Atelier</span></div>
          <div style={{ fontSize:11, color:"#8892A4", letterSpacing:3, marginTop:4 }}>COSTURA PRO</div>
        </div>

        {/* Banner trial */}
        {tela === "cadastro" && (
          <div style={{ background:"#FF8C4214", border:"1px solid #ff9f4a33", borderRadius:10, padding:"12px 16px", marginBottom:16, textAlign:"center" }}>
            <div style={{ fontWeight:800, fontSize:14, color:"#FF8C42", marginBottom:4 }}>{TRIAL_DIAS} dias grátis</div>
            <div style={{ fontSize:12, color:"#ff9f4a88" }}>Sem cartão de crédito · Cadastre-se agora e comece a usar</div>
          </div>
        )}

        <div style={{ background:"#FFFFFF", border:"1px solid #1e2030", borderRadius:16, padding:32 }}>
          <div style={{ display:"flex", borderBottom:"1px solid #1e2030", marginBottom:28 }}>
            {[["login","Entrar"],["cadastro","Teste Grátis"],["ativacao","Ativar Licença"]].map(([id,label]) => (
              <button key={id} onClick={() => { setTela(id); setErro(""); setOk(""); }}
                style={{ flex:1, padding:"10px 6px", background:"transparent", border:"none", cursor:"pointer", fontSize:11, fontWeight:tela===id?700:400, color:tela===id?"#C06E7A":"#8892A4", borderBottom:tela===id?"2px solid #c8a96e":"2px solid transparent", fontFamily:"Georgia, serif", transition:"all 0.15s" }}>
                {label}
              </button>
            ))}
          </div>

          {ok && <div style={{ background:"#00C89622", border:"1px solid #7ecb8f44", borderRadius:8, padding:"10px 14px", marginBottom:20, fontSize:13, color:"#00C896" }}>{ok}</div>}
          {erro && <div style={{ background:"#FF6B6B22", border:"1px solid #e05c5c44", borderRadius:8, padding:"10px 14px", marginBottom:20, fontSize:13, color:"#FF6B6B" }}>{erro}</div>}

          {tela === "login" && (<>
            {inp("E-mail", "email", "email", "seu@email.com")}
            {inp("Senha", "senha", "password", "••••••")}
            <button onClick={handleLogin}
              style={{ width:"100%", background:"linear-gradient(135deg,#c8a96e,#a8843e)", color:"#F4F5F7", border:"none", borderRadius:8, padding:"13px", fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"Georgia, serif", marginTop:4 }}>
              Entrar no Sistema
            </button>
            <p style={{ textAlign:"center", fontSize:12, color:"#8892A4", marginTop:16 }}>
              Novo aqui?{" "}
              <span onClick={() => { setTela("cadastro"); setErro(""); }} style={{ color:"#C06E7A", cursor:"pointer" }}>Teste grátis por {TRIAL_DIAS} dias</span>
            </p>
          </>)}

          {tela === "cadastro" && (<>
            {inp("Primeiro nome", "nome", "text", "Seu nome")}
            {inp("E-mail", "email", "email", "seu@email.com")}
            {inp("Senha", "senha", "password", "Mínimo 4 caracteres")}
            {inp("Confirmar senha", "confirmar", "password", "Repita a senha")}
            <button onClick={handleCadastro}
              style={{ width:"100%", background:"linear-gradient(135deg,#c8a96e,#a8843e)", color:"#F4F5F7", border:"none", borderRadius:8, padding:"13px", fontSize:15, fontWeight:800, cursor:"pointer", fontFamily:"Georgia, serif", marginTop:4 }}>
              Iniciar Teste Gratuito
            </button>
            <p style={{ textAlign:"center", fontSize:11, color:"#6B7280", marginTop:12, lineHeight:1.6 }}>
              Ao se cadastrar você concorda com os termos de uso.<br/>
              <a href="https://zemcost.com.br" target="_blank" rel="noopener noreferrer" style={{ color:"#C06E7A66" }}>zemcost.com.br</a>
            </p>
          </>)}

          {tela === "ativacao" && (<>
            <div style={{ textAlign:"center", marginBottom:20 }}>
              <div style={{ fontSize:32, color:"#C06E7A", marginBottom:8 }}>✦</div>
              <div style={{ fontWeight:700, fontSize:14, color:"#1C1C2E", marginBottom:6 }}>Ativação de Assinatura</div>
              <div style={{ fontSize:12, color:"#6B7280", lineHeight:1.6 }}>
                Insira o código da sua assinatura.{" "}
                <a href="https://zemcost.com.br" target="_blank" rel="noopener noreferrer" style={{ color:"#C06E7A" }}>zemcost.com.br</a>
              </div>
            </div>
            {inp("E-mail da conta", "email", "email", "seu@email.com")}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display:"block", fontSize:10, letterSpacing:1, textTransform:"uppercase", color:"#C06E7A", marginBottom:6, fontWeight:700 }}>Código de Licença</label>
              <input value={form.codigo} placeholder="Cole o código completo emitido para este e-mail"
                onChange={e => { setErro(""); setForm(f => ({ ...f, codigo: e.target.value })); }}
                onKeyDown={e => e.key === "Enter" && handleAtivarCodigo()}
                style={{ width:"100%", background:"#F4F5F7", border:"1px solid #2a2a3e", borderRadius:8, padding:"11px 14px", color:"#C06E7A", fontSize:14, outline:"none", fontFamily:"monospace", letterSpacing:2, boxSizing:"border-box", textTransform:"uppercase" }} />
            </div>
            <button onClick={handleAtivarCodigo}
              style={{ width:"100%", background:"linear-gradient(135deg,#c8a96e,#a8843e)", color:"#F4F5F7", border:"none", borderRadius:8, padding:"13px", fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"Georgia, serif", marginTop:4 }}>
              Ativar Assinatura
            </button>
            <div style={{ marginTop:16, padding:"10px 14px", background:"#F4F5F7", borderRadius:8, border:"1px solid #1e2030", textAlign:"center" }}>
              <div style={{ fontSize:11, color:"#8892A4" }}>Não tem o código ainda?</div>
              <a href="https://zemcost.com.br" target="_blank" rel="noopener noreferrer"
                style={{ color:"#C06E7A", fontWeight:700, fontSize:13, textDecoration:"none" }}>
                Comprar em zemcost.com.br →
              </a>
            </div>
          </>)}
        </div>

        <div style={{ textAlign:"center", marginTop:20 }}>
          <div style={{ fontSize:10, color:"#DDE1E9", marginBottom:4 }}>Atelier Costura Pro · Sistema de Gestão</div>
          <a href="https://zemcost.com.br" target="_blank" rel="noopener noreferrer"
            style={{ color:"#C06E7A44", fontSize:11, fontWeight:700, textDecoration:"none", letterSpacing:1 }}>
            zemcost.com.br
          </a>
        </div>
      </div>
    </div>
  );
}
// ─── Configurações ────────────────────────────────────────────────────────────
function Configuracoes({ empresa, save, goBack }) {
  const [form, setForm] = useState({ ...empresa });
  const [salvo, setSalvo] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const salvar = () => {
    save(form);
    setSalvo(true);
    setTimeout(() => setSalvo(false), 2500);
  };

  const inp = (label, key, type = "text", placeholder = "") => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#C06E7A", marginBottom: 5, fontWeight: 700 }}>{label}</label>
      <input type={type} value={form[key] || ""} placeholder={placeholder}
        onChange={e => set(key, e.target.value)}
        style={{ width: "100%", background: "#F4F5F7", border: "1px solid #2a2a3e", borderRadius: 6, padding: "9px 12px", color: "#1C1C2E", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
    </div>
  );

  return (
    <div>
      <BtnVoltar onClick={goBack} />
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: -0.5, color:"#FFF" }}>Configurações</h1>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Dados da empresa usados nos documentos e relatórios</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Dados principais */}
        <Card>
          <h3 style={{ fontSize: 11, color: "#C06E7A", letterSpacing: 1, textTransform: "uppercase", marginBottom: 18 }}>◎ Dados da Empresa</h3>
          {inp("Razão Social / Nome", "nome", "text", "Ex: Atelier Silva LTDA")}
          {inp("CNPJ", "cnpj", "text", "00.000.000/0001-00")}
          {inp("Inscrição Estadual", "ie", "text", "Isento ou número")}
          {inp("Responsável", "responsavel", "text", "Nome do proprietário")}
          {inp("Alíquota ISS (%)", "aliquota_iss", "number", "3.00")}
          {inp("Cód. Município (NFS-e)", "municipio_codigo", "text", "Ex: 4106902")}
        </Card>

        {/* Contato */}
        <Card>
          <h3 style={{ fontSize: 11, color: "#C06E7A", letterSpacing: 1, textTransform: "uppercase", marginBottom: 18 }}>◉ Contato</h3>
          {inp("Telefone / WhatsApp", "telefone", "text", "(00) 00000-0000")}
          {inp("E-mail", "email", "email", "contato@empresa.com.br")}
          {inp("Site", "site", "text", "www.empresa.com.br")}
        </Card>

        {/* Endereço */}
        <Card style={{ gridColumn: "1 / -1" }}>
          <h3 style={{ fontSize: 11, color: "#C06E7A", letterSpacing: 1, textTransform: "uppercase", marginBottom: 18 }}>◷ Endereço</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 16px" }}>
            <div style={{ gridColumn: "1 / -1" }}>{inp("Endereço completo", "endereco", "text", "Rua, número, complemento")}</div>
            {inp("Cidade", "cidade", "text", "Ex: Fazenda Rio Grande")}
            {inp("Estado", "estado", "text", "Ex: PR")}
            {inp("CEP", "cep", "text", "00000-000")}
          </div>
        </Card>
      </div>

      {/* Salvar */}
      <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={salvar}
          style={{ background: "linear-gradient(135deg,#c8a96e,#a8843e)", color: "#F4F5F7", border: "none", borderRadius: 8, padding: "12px 32px", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "Georgia, serif" }}>
          Salvar Dados da Empresa
        </button>
        {salvo && (
          <span style={{ color: "#00C896", fontSize: 13, fontWeight: 700 }}>✓ Dados salvos com sucesso!</span>
        )}
      </div>

      {/* Preview do cabeçalho nos docs */}
      {form.nome && (
        <Card style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 11, color: "#C06E7A", letterSpacing: 1, textTransform: "uppercase", marginBottom: 14 }}>Preview nos Documentos</h3>
          <div style={{ background: "#fff", borderRadius: 8, padding: 20, color: "#EEF0F5" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "3px solid #c8a96e", paddingBottom: 14, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: -1 }}>✦ <span style={{ color: "#C06E7A" }}>{form.nome || "Atelier"}</span></div>
                {form.cnpj && <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>CNPJ: {form.cnpj}</div>}
                {form.endereco && <div style={{ fontSize: 11, color: "#9CA3AF" }}>{form.endereco}{form.cidade ? `, ${form.cidade}` : ""}{form.estado ? ` - ${form.estado}` : ""}</div>}
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: "#6B7280" }}>
                {form.telefone && <div>{form.telefone}</div>}
                {form.email && <div>{form.email}</div>}
                {form.site && <div>{form.site}</div>}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "#9CA3AF" }}>← Assim aparecerá no cabeçalho dos PDFs e notas fiscais</div>
          </div>
        </Card>
      )}

      {/* Créditos */}
      <Card style={{ marginTop: 24, textAlign: "center", padding: 28 }}>
        <div style={{ fontSize: 28, color: "#C06E7A", marginBottom: 10 }}>✦</div>
        <div style={{ fontWeight: 900, fontSize: 16, color: "#1C1C2E", marginBottom: 6 }}>Atelier Costura Pro</div>
        <div style={{ fontSize: 12, color: "#8892A4", marginBottom: 14 }}>Sistema de gestão completo para oficinas de costura</div>
        <div style={{ height: 1, background: "#EAECF0", marginBottom: 14 }} />
        <div style={{ fontSize: 11, color: "#8892A4", marginBottom: 6 }}>Desenvolvido por</div>
        <a href="https://zemcost.com.br" target="_blank" rel="noopener noreferrer"
          style={{ color: "#C06E7A", fontWeight: 800, fontSize: 18, textDecoration: "none", letterSpacing: -0.5 }}>
          zemcost.com.br
        </a>
        <div style={{ fontSize: 11, color: "#6B7280", marginTop: 8 }}>
          Soluções digitais para pequenos e médios negócios
        </div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "center", gap: 20, fontSize: 10, color: "#DDE1E9", textTransform: "uppercase", letterSpacing: 1 }}>
          <span>v2.0</span>
          <span>·</span>
          <span>© 2024 Zemcost</span>
          <span>·</span>
          <span>Todos os direitos reservados</span>
        </div>
      </Card>
    </div>
  );
}



// ─── Tela Trial Expirado ──────────────────────────────────────────────────────
function TelaExpirado({ onAtivar, onLogout, motivo, email }) {
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  const mensalVencida = motivo === "mensal_vencida";
  const anualVencida = motivo === "anual_vencida";

  const ativar = async () => {
    setErro(""); setOk("");
    const cod = codigo.trim();
    let licenca;
    try {
      licenca = await validarLicenca(cod, email);
    } catch (error) {
      setErro(error.message || "Não foi possível verificar o código neste dispositivo.");
      return;
    }
    if (!licenca) { setErro("Código inválido, vencido ou emitido para outro e-mail."); return; }
    const tipo = licenca.plano === "ANUAL" ? "anual" : "mensal";
    const expiraEm = new Date(licenca.expiresAt).toISOString();
    saveLicense({ tipo, ativadoEm: new Date().toISOString(), expiraEm, codigo: cod });
    setOk(`Assinatura ${tipo} ativada por ${tipo === "anual" ? "365 dias" : "30 dias"}!`);
    setTimeout(() => onAtivar(tipo, licenca.expiresAt, cod), 1500);
  };

  const PLANOS = [
    {
      tipo: "mensal",
      icon: "M",
      titulo: "Assinatura Mensal",
      preco: "R$ 9,90",
      periodo: "por mês",
      cor: "#4F8EF7",
      bg: "linear-gradient(135deg,#4F8EF7,#2563EB)",
      itens: ["Acesso completo por 30 dias","Renove todo mês","Atualizações incluídas"],
    },
    {
      tipo: "anual",
      icon: "A",
      titulo: "Assinatura Anual",
      preco: "R$ 89,90",
      periodo: "por ano",
      cor: "#00C896",
      bg: "linear-gradient(135deg,#00A879,#008A68)",
      destaque: true,
      itens: ["Acesso completo por 365 dias","Renove uma vez por ano","Atualizações incluídas"],
    },
  ];

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(145deg,#2a2d30,#3a3d40)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:"'Inter',system-ui,sans-serif", padding:20 }}>

      {/* Logo */}
      <div style={{ textAlign:"center", marginBottom:28 }}>
        <img src="/splash.png" alt="Ateliê Costura Pro"
          style={{ width:90, height:90, objectFit:"cover", objectPosition:"top", borderRadius:"50%", border:"3px solid rgba(192,110,122,0.4)", marginBottom:12 }} />
        <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", letterSpacing:3, fontWeight:700 }}>COSTURA PRO</div>
      </div>

      {/* Título */}
      <div style={{ textAlign:"center", marginBottom:32 }}>
        <div style={{ fontSize:28, fontWeight:900, color:"#FFF", marginBottom:8 }}>
          {mensalVencida || anualVencida ? "⏰ Assinatura vencida" : "⏳ Período de teste encerrado"}
        </div>
        <div style={{ fontSize:14, color:"rgba(255,255,255,0.5)", lineHeight:1.7 }}>
          {mensalVencida || anualVencida
            ? `Sua assinatura ${anualVencida ? "anual" : "mensal"} venceu. Renove para continuar usando.`
            : <>Seus <strong style={{ color:"#FF8C42" }}>{TRIAL_DIAS} dias</strong> gratuitos chegaram ao fim.<br/>Escolha um plano para continuar.</>}
        </div>
      </div>

      {/* Cards de planos */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))", gap:16, width:"100%", maxWidth:560, marginBottom:32 }}>
        {PLANOS.map(p => (
          <div key={p.tipo} style={{ background:"rgba(255,255,255,0.06)", border:`1px solid ${p.cor}44`, borderRadius:20, padding:24, position:"relative", overflow:"hidden" }}>
            {p.destaque && (
              <div style={{ position:"absolute", top:14, right:-22, background:p.bg, color:"#FFF", fontSize:10, fontWeight:800, padding:"3px 32px", transform:"rotate(45deg)", letterSpacing:1 }}>POPULAR</div>
            )}
            <div style={{ fontSize:28, marginBottom:10 }}>{p.icon}</div>
            <div style={{ fontWeight:800, fontSize:16, color:"#FFF", marginBottom:4 }}>{p.titulo}</div>
            <div style={{ marginBottom:16 }}>
              <span style={{ fontSize:26, fontWeight:900, color:p.cor }}>{p.preco}</span>
              <span style={{ fontSize:12, color:"rgba(255,255,255,0.35)", marginLeft:4 }}>{p.periodo}</span>
            </div>
            <ul style={{ listStyle:"none", marginBottom:20 }}>
              {p.itens.map((item,i) => (
                <li key={i} style={{ fontSize:12, color:"rgba(255,255,255,0.65)", marginBottom:6, display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ color:p.cor, fontSize:14 }}>✓</span> {item}
                </li>
              ))}
            </ul>
            <a href="https://zemcost.com.br" target="_blank" rel="noopener noreferrer"
              style={{ display:"block", background:p.bg, color:"#FFF", borderRadius:10, padding:"11px 16px", fontSize:13, fontWeight:700, textDecoration:"none", textAlign:"center", boxShadow:`0 4px 18px ${p.cor}44` }}>
               Comprar em zemcost.com.br
            </a>
          </div>
        ))}
      </div>

      {/* Ativação de código */}
      <div style={{ width:"100%", maxWidth:420, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:18, padding:24 }}>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", textAlign:"center", marginBottom:14 }}>
          Já tem o código? Cole abaixo para ativar
        </div>
        <input
          value={codigo}
          onChange={e => { setCodigo(e.target.value); setErro(""); setOk(""); }}
          onKeyDown={e => e.key === "Enter" && ativar()}
          placeholder="Cole o código completo emitido para este e-mail"
          style={{ width:"100%", background:"rgba(255,255,255,0.08)", border:`1.5px solid ${erro?"#FF6B6B":"rgba(255,255,255,0.15)"}`, borderRadius:10, padding:"12px 14px", color:"#FFF", fontSize:12, outline:"none", textAlign:"center", fontFamily:"monospace", letterSpacing:1, boxSizing:"border-box", marginBottom:10 }}
        />
        {erro && <div style={{ background:"rgba(255,107,107,0.15)", border:"1px solid rgba(255,107,107,0.3)", borderRadius:8, padding:"9px 14px", marginBottom:10, fontSize:13, color:"#FF6B6B", textAlign:"center" }}>{erro}</div>}
        {ok && <div style={{ background:"rgba(0,200,150,0.15)", border:"1px solid rgba(0,200,150,0.3)", borderRadius:8, padding:"9px 14px", marginBottom:10, fontSize:13, color:"#00C896", textAlign:"center" }}>{ok}</div>}
        <button onClick={ativar}
          style={{ width:"100%", background:"linear-gradient(135deg,#C06E7A,#E8A0AA)", color:"#FFF", border:"none", borderRadius:10, padding:"12px", fontSize:14, fontWeight:800, cursor:"pointer", fontFamily:"inherit", boxShadow:"0 4px 18px #6C63FF44" }}>
          ✦ Ativar Licença
        </button>
        <button onClick={onLogout}
          style={{ width:"100%", marginTop:10, background:"transparent", border:"none", color:"rgba(255,255,255,0.3)", fontSize:12, cursor:"pointer", fontFamily:"inherit", padding:"8px" }}>
          ← Sair da conta
        </button>
      </div>

      <div style={{ marginTop:24, fontSize:10, color:"rgba(255,255,255,0.2)" }}>
        <a href="https://zemcost.com.br" target="_blank" rel="noopener noreferrer" style={{ color:"rgba(255,255,255,0.2)", textDecoration:"none" }}>zemcost.com.br</a>
      </div>
    </div>
  );
}
