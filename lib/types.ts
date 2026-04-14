/**
 * Tipos compartilhados para o app de facção de costura
 */

// Pedidos
export type PedidoStatus = "novo" | "em_producao" | "concluido" | "atrasado";

export interface Pedido {
  id: string;
  cliente: string;
  telefone: string;
  quantidade: number;
  tipo_servico: string;
  descricao: string;
  data_entrega: string; // ISO date
  valor: number;
  status: PedidoStatus;
  observacoes?: string;
  data_criacao: string; // ISO date
  data_conclusao?: string; // ISO date
}

// Receitas
export type ReceitaCategoria = "pedido" | "outro";

export interface Receita {
  id: string;
  data: string; // ISO date
  descricao: string;
  valor: number;
  categoria: ReceitaCategoria;
  cliente?: string;
  observacoes?: string;
}

// Despesas
export type DespesaCategoria = "tecido" | "insumos" | "aluguel" | "outro";

export interface Despesa {
  id: string;
  data: string; // ISO date
  descricao: string;
  valor: number;
  categoria: DespesaCategoria;
  observacoes?: string;
}

// Resumo Financeiro
export interface ResumoFinanceiro {
  periodo: "hoje" | "semana" | "mes";
  total_receitas: number;
  total_despesas: number;
  lucro_liquido: number;
  receitas: Receita[];
  despesas: Despesa[];
}

// Resumo de Produção
export interface ResumoProdução {
  total_pedidos: number;
  em_producao: number;
  concluidos_hoje: number;
  atrasados: number;
}
