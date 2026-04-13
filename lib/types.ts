/**
 * Tipos compartilhados para o app de facção de costura
 */

// Pedidos
export type PedidoStatus = "pendente" | "em_producao" | "concluido" | "atrasado";

export interface Pedido {
  id: number | string;
  userId: number;
  cliente: string;
  telefone: string;
  quantidade: number;
  tipo_servico: string;
  descricao: string | null;
  data_entrega: Date | string; // ISO date
  valor: number; // em centavos
  status: PedidoStatus;
  observacoes?: string | null;
  data_criacao: Date | string; // ISO date
  data_conclusao?: Date | string | null; // ISO date
  createdAt?: Date;
  updatedAt?: Date;
}

// Receitas
export type ReceitaCategoria = "pedido" | "outro";

export interface Receita {
  id: number | string;
  userId: number;
  data: Date | string; // ISO date
  descricao: string;
  valor: number; // em centavos
  categoria: ReceitaCategoria;
  observacoes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

// Despesas
export type DespesaCategoria = "tecido" | "insumos" | "aluguel" | "outro";

export interface Despesa {
  id: number | string;
  userId: number;
  data: Date | string; // ISO date
  descricao: string;
  valor: number; // em centavos
  categoria: DespesaCategoria;
  observacoes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
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
