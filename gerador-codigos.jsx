import { useState } from "react";

const PREFIXO = "COSTURA";
const CHAVE_SECRETA = "ZEMCOST2024"; // chave usada no hash

// Hash simples para tornar o código único e verificável
function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h).toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
}

function gerarCodigo(cliente, plano) {
  const seq = Date.now().toString(36).toUpperCase().slice(-4);
  const check = hashCode(`-${plano}-${seq}` + CHAVE_SECRETA);
  return `${PREFIXO}-${plano}-${seq}-${check}`;
}

function validarCodigo(codigo) {
  try {
    const partes = codigo.trim().toUpperCase().split("-");
    if (partes.length !== 4) return false;
    const [prefixo, plano, seq, check] = partes;
    if (prefixo !== PREFIXO) return false;
    const base = `-${plano}-${seq}`;
    const checkEsperado = hashCode(base + CHAVE_SECRETA);
    return check === checkEsperado;
  } catch { return false; }
}

const PLANOS = [
  { id: "MENSAL", label: "Mensal · R$ 9,90", cor: "#4F8EF7", desc: "30 dias · Renovável" },
  { id: "ANUAL",  label: "Anual · R$ 89,90", cor: "#00C896", desc: "365 dias · Renovável" },
];

export default function GeradorCodigos() {
  const [cliente, setCliente] = useState("");
  const [plano, setPlano] = useState("MENSAL");
  const [codigosGerados, setCodigosGerados] = useState([]);
  const [validarInput, setValidarInput] = useState("");
  const [resultadoValidacao, setResultadoValidacao] = useState(null);
  const [aba, setAba] = useState("gerar");
  const [copiado, setCopiado] = useState(null);

  const gerar = () => {
    if (!cliente.trim()) return alert("Informe o nome do cliente.");
    const cod = gerarCodigo(cliente, plano);
    const novo = {
      id: Date.now(),
      codigo: cod,
      cliente: cliente.trim(),
      plano,
      geradoEm: new Date().toLocaleString("pt-BR"),
    };
    setCodigosGerados(prev => [novo, ...prev]);
    setCliente("");
  };

  const copiar = (cod, id) => {
    navigator.clipboard.writeText(cod);
    setCopiado(id);
    setTimeout(() => setCopiado(null), 2000);
  };

  const validar = () => {
    const valido = validarCodigo(validarInput);
    setResultadoValidacao(valido);
  };

  const excluir = (id) => setCodigosGerados(prev => prev.filter(c => c.id !== id));

  const exportarTxt = () => {
    const txt = codigosGerados.map(c =>
      `${c.geradoEm} | ${c.cliente} | ${c.plano} | ${c.codigo}`
    ).join("\n");
    const blob = new Blob([txt], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `codigos-atelier-${Date.now()}.txt`;
    a.click();
  };

  const planoInfo = PLANOS.find(p => p.id === plano);

  const abaStyle = (id) => ({
    padding: "10px 24px", border: "none", cursor: "pointer", background: "transparent",
    color: aba === id ? "#c8a96e" : "#555",
    fontWeight: aba === id ? 700 : 400,
    fontSize: 13,
    borderBottom: aba === id ? "2px solid #c8a96e" : "2px solid transparent",
    fontFamily: "Georgia, serif", transition: "all 0.15s",
  });

  return (
    <div style={{ minHeight: "100vh", background: "#0a0b14", color: "#e8e6e0", fontFamily: "Georgia, serif", padding: 0 }}>

      {/* Header */}
      <div style={{ background: "#0d1117", borderBottom: "1px solid #1e2030", padding: "18px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: -1 }}>✦ <span style={{ color: "#c8a96e" }}>Atelier</span> Costura Pro</div>
          <div style={{ fontSize: 10, color: "#444", letterSpacing: 2, marginTop: 2 }}>PAINEL DO DESENVOLVEDOR · ZEMCOST.COM.BR</div>
        </div>
        <div style={{ background: "#c8a96e22", border: "1px solid #c8a96e44", borderRadius: 8, padding: "6px 14px", fontSize: 11, color: "#c8a96e", fontWeight: 700 }}>
          🔐 ACESSO RESTRITO
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>

        {/* Abas */}
        <div style={{ borderBottom: "1px solid #1e2030", marginBottom: 28, display: "flex" }}>
          {[["gerar","◈ Gerar Código"],["validar","✓ Validar Código"],["lista","◎ Histórico"]].map(([id, l]) => (
            <button key={id} style={abaStyle(id)} onClick={() => setAba(id)}>{l}</button>
          ))}
        </div>

        {/* ── GERAR ──────────────────────────────────────────────────────────── */}
        {aba === "gerar" && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 900, letterSpacing: -0.5, marginBottom: 6 }}>Gerar Código de Ativação</h2>
              <p style={{ color: "#555", fontSize: 13 }}>Gere um código único por cliente após a compra.</p>
            </div>

            <div style={{ background: "#13151f", border: "1px solid #1e2030", borderRadius: 14, padding: 28, marginBottom: 24 }}>
              {/* Nome do cliente */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: "block", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#c8a96e", marginBottom: 7, fontWeight: 700 }}>
                  Nome do Cliente *
                </label>
                <input value={cliente} onChange={e => setCliente(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && gerar()}
                  placeholder="Ex: Oficina da Maria"
                  style={{ width: "100%", background: "#0d1117", border: "1px solid #2a2a3e", borderRadius: 8, padding: "11px 14px", color: "#e8e6e0", fontSize: 14, outline: "none", boxSizing: "border-box" }} />
              </div>

              {/* Plano */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: "block", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#c8a96e", marginBottom: 10, fontWeight: 700 }}>
                  Tipo de Licença
                </label>
                <div style={{ display: "flex", gap: 10 }}>
                  {PLANOS.map(p => (
                    <button key={p.id} onClick={() => setPlano(p.id)}
                      style={{
                        flex: 1, padding: "12px 10px", borderRadius: 10, cursor: "pointer",
                        border: `1px solid ${plano === p.id ? p.cor : "#2a2a3e"}`,
                        background: plano === p.id ? p.cor + "18" : "#0d1117",
                        color: plano === p.id ? p.cor : "#555",
                        fontFamily: "Georgia, serif", transition: "all 0.15s", textAlign: "center",
                      }}>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>{p.label}</div>
                      <div style={{ fontSize: 10, marginTop: 3, opacity: 0.7 }}>{p.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              {cliente.trim() && (
                <div style={{ background: "#0d1117", borderRadius: 10, padding: 16, marginBottom: 20, border: `1px solid ${planoInfo.cor}33` }}>
                  <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Preview do código</div>
                  <div style={{ fontFamily: "monospace", fontSize: 16, color: planoInfo.cor, letterSpacing: 2, fontWeight: 700 }}>
                    {PREFIXO}-{plano}-XXXX-XXXXXX
                  </div>
                  <div style={{ fontSize: 11, color: "#444", marginTop: 6 }}>
                    Para: <strong style={{ color: "#888" }}>{cliente}</strong> · Plano: <strong style={{ color: planoInfo.cor }}>{planoInfo.label}</strong>
                  </div>
                </div>
              )}

              <button onClick={gerar}
                style={{ width: "100%", background: "linear-gradient(135deg,#c8a96e,#a8843e)", color: "#0d1117", border: "none", borderRadius: 8, padding: "14px", fontSize: 15, fontWeight: 900, cursor: "pointer", fontFamily: "Georgia, serif", letterSpacing: 0.5 }}>
                ◈ Gerar Código de Ativação
              </button>
            </div>

            {/* Último código gerado */}
            {codigosGerados.length > 0 && (
              <div style={{ background: "#13151f", border: `1px solid ${PLANOS.find(p=>p.id===codigosGerados[0].plano)?.cor}44`, borderRadius: 14, padding: 24 }}>
                <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Último código gerado</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 900, color: "#c8a96e", letterSpacing: 2, marginBottom: 6 }}>
                      {codigosGerados[0].codigo}
                    </div>
                    <div style={{ fontSize: 12, color: "#555" }}>
                      {codigosGerados[0].cliente} · {codigosGerados[0].plano} · {codigosGerados[0].geradoEm}
                    </div>
                  </div>
                  <button onClick={() => copiar(codigosGerados[0].codigo, codigosGerados[0].id)}
                    style={{ padding: "10px 20px", background: copiado === codigosGerados[0].id ? "#7ecb8f22" : "#c8a96e22", border: `1px solid ${copiado === codigosGerados[0].id ? "#7ecb8f" : "#c8a96e"}`, borderRadius: 8, color: copiado === codigosGerados[0].id ? "#7ecb8f" : "#c8a96e", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "Georgia, serif", minWidth: 120, transition: "all 0.2s" }}>
                    {copiado === codigosGerados[0].id ? "✓ Copiado!" : "⎘ Copiar"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── VALIDAR ────────────────────────────────────────────────────────── */}
        {aba === "validar" && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 900, letterSpacing: -0.5, marginBottom: 6 }}>Validar Código</h2>
              <p style={{ color: "#555", fontSize: 13 }}>Verifique se um código é autêntico antes de liberar o acesso.</p>
            </div>
            <div style={{ background: "#13151f", border: "1px solid #1e2030", borderRadius: 14, padding: 28 }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#c8a96e", marginBottom: 7, fontWeight: 700 }}>
                  Código a validar
                </label>
                <input value={validarInput} onChange={e => { setValidarInput(e.target.value); setResultadoValidacao(null); }}
                  onKeyDown={e => e.key === "Enter" && validar()}
                  placeholder="COSTURA-MENSAL-XXXX-XXXXXX ou COSTURA-ANUAL-XXXX-XXXXXX"
                  style={{ width: "100%", background: "#0d1117", border: "1px solid #2a2a3e", borderRadius: 8, padding: "12px 14px", color: "#c8a96e", fontSize: 15, outline: "none", fontFamily: "monospace", letterSpacing: 2, textTransform: "uppercase", boxSizing: "border-box" }} />
              </div>
              <button onClick={validar}
                style={{ width: "100%", background: "#1a1a2e", border: "1px solid #2a2a3e", borderRadius: 8, padding: "13px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "Georgia, serif", color: "#c8a96e" }}>
                ✓ Verificar Código
              </button>

              {resultadoValidacao !== null && (
                <div style={{ marginTop: 20, padding: 20, borderRadius: 10, textAlign: "center", background: resultadoValidacao ? "#7ecb8f18" : "#e05c5c18", border: `1px solid ${resultadoValidacao ? "#7ecb8f44" : "#e05c5c44"}` }}>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>{resultadoValidacao ? "✓" : "✕"}</div>
                  <div style={{ fontWeight: 900, fontSize: 18, color: resultadoValidacao ? "#7ecb8f" : "#e05c5c", marginBottom: 6 }}>
                    {resultadoValidacao ? "Código Válido!" : "Código Inválido"}
                  </div>
                  <div style={{ fontSize: 13, color: "#666" }}>
                    {resultadoValidacao ? "Este código é autêntico e pode ser usado para ativar o sistema." : "Este código não foi gerado pelo sistema ou está incorreto."}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── HISTÓRICO ─────────────────────────────────────────────────────── */}
        {aba === "lista" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 900, letterSpacing: -0.5, marginBottom: 4 }}>Histórico de Códigos</h2>
                <p style={{ color: "#555", fontSize: 13 }}>{codigosGerados.length} código{codigosGerados.length !== 1 ? "s" : ""} gerado{codigosGerados.length !== 1 ? "s" : ""} nesta sessão</p>
              </div>
              {codigosGerados.length > 0 && (
                <button onClick={exportarTxt}
                  style={{ padding: "8px 18px", background: "#1a1a2e", border: "1px solid #c8a96e44", borderRadius: 8, color: "#c8a96e", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Georgia, serif" }}>
                  ⬇ Exportar .txt
                </button>
              )}
            </div>

            {codigosGerados.length === 0 ? (
              <div style={{ background: "#13151f", border: "1px solid #1e2030", borderRadius: 14, padding: 48, textAlign: "center" }}>
                <div style={{ fontSize: 36, color: "#1e2030", marginBottom: 12 }}>◈</div>
                <div style={{ color: "#444", fontSize: 14 }}>Nenhum código gerado ainda nesta sessão.</div>
                <div style={{ color: "#333", fontSize: 12, marginTop: 6 }}>Os códigos ficam aqui enquanto a aba estiver aberta.</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {codigosGerados.map(c => {
                  const pl = PLANOS.find(p => p.id === c.plano);
                  return (
                    <div key={c.id} style={{ background: "#13151f", border: `1px solid ${pl?.cor}33`, borderRadius: 12, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                          <span style={{ background: pl?.cor + "22", color: pl?.cor, padding: "2px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700 }}>{c.plano}</span>
                          <span style={{ fontSize: 12, color: "#666" }}>{c.cliente}</span>
                          <span style={{ fontSize: 10, color: "#333" }}>{c.geradoEm}</span>
                        </div>
                        <div style={{ fontFamily: "monospace", fontSize: 16, color: "#c8a96e", fontWeight: 700, letterSpacing: 2 }}>
                          {c.codigo}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => copiar(c.codigo, c.id)}
                          style={{ padding: "7px 14px", background: copiado === c.id ? "#7ecb8f22" : "#c8a96e22", border: `1px solid ${copiado === c.id ? "#7ecb8f" : "#c8a96e"}44`, borderRadius: 7, color: copiado === c.id ? "#7ecb8f" : "#c8a96e", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Georgia, serif", transition: "all 0.2s" }}>
                          {copiado === c.id ? "✓" : "⎘ Copiar"}
                        </button>
                        <button onClick={() => excluir(c.id)}
                          style={{ padding: "7px 12px", background: "#2e1a1a", border: "1px solid #e05c5c33", borderRadius: 7, color: "#e05c5c", fontSize: 12, cursor: "pointer", fontFamily: "Georgia, serif" }}>
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Rodapé */}
        <div style={{ marginTop: 48, textAlign: "center", fontSize: 11, color: "#2a2a3e" }}>
          Atelier Costura Pro · Painel do Desenvolvedor · <a href="https://zemcost.com.br" style={{ color: "#c8a96e44", textDecoration: "none" }}>zemcost.com.br</a>
        </div>
      </div>
    </div>
  );
}
