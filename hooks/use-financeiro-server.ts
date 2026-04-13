import { useState, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Receita, Despesa } from "@/lib/types";

type Periodo = "hoje" | "semana" | "mes";

export function useFinanceiroServer() {
  const [loading, setLoading] = useState(false);

  // Queries
  const receitasQuery = trpc.receitas.list.useQuery();
  const despesasQuery = trpc.despesas.list.useQuery();

  const receitas = receitasQuery.data || [];
  const despesas = despesasQuery.data || [];

  // Mutations
  const createReceitaMutation = trpc.receitas.create.useMutation({
    onSuccess: () => {
      receitasQuery.refetch();
    },
  });

  const deleteReceitaMutation = trpc.receitas.delete.useMutation({
    onSuccess: () => {
      receitasQuery.refetch();
    },
  });

  const createDespesaMutation = trpc.despesas.create.useMutation({
    onSuccess: () => {
      despesasQuery.refetch();
    },
  });

  const deleteDespesaMutation = trpc.despesas.delete.useMutation({
    onSuccess: () => {
      despesasQuery.refetch();
    },
  });

  const criarReceita = useCallback(
    async (data: {
      data: string;
      descricao: string;
      valor: number;
      categoria?: string;
      observacoes?: string;
    }) => {
      setLoading(true);
      try {
        await createReceitaMutation.mutateAsync(data as any);
      } finally {
        setLoading(false);
      }
    },
    [createReceitaMutation]
  );

  const excluirReceita = useCallback(
    async (id: number) => {
      setLoading(true);
      try {
        await deleteReceitaMutation.mutateAsync({ id });
      } finally {
        setLoading(false);
      }
    },
    [deleteReceitaMutation]
  );

  const criarDespesa = useCallback(
    async (data: {
      data: string;
      descricao: string;
      valor: number;
      categoria?: string;
      observacoes?: string;
    }) => {
      setLoading(true);
      try {
        await createDespesaMutation.mutateAsync(data as any);
      } finally {
        setLoading(false);
      }
    },
    [createDespesaMutation]
  );

  const excluirDespesa = useCallback(
    async (id: number) => {
      setLoading(true);
      try {
        await deleteDespesaMutation.mutateAsync({ id });
      } finally {
        setLoading(false);
      }
    },
    [deleteDespesaMutation]
  );

  const obterResumo = useCallback(
    (periodo: Periodo) => {
      const agora = new Date();
      const dataFiltro = new Date();

      if (periodo === "hoje") {
        dataFiltro.setHours(0, 0, 0, 0);
      } else if (periodo === "semana") {
        dataFiltro.setDate(agora.getDate() - 7);
      } else if (periodo === "mes") {
        dataFiltro.setMonth(agora.getMonth() - 1);
      }

      const receitasFiltradas = receitas.filter(
        (r) => new Date(r.data) >= dataFiltro
      );
      const despesasFiltradas = despesas.filter(
        (d) => new Date(d.data) >= dataFiltro
      );

      const total_receitas = receitasFiltradas.reduce((sum, r) => sum + r.valor / 100, 0);
      const total_despesas = despesasFiltradas.reduce((sum, d) => sum + d.valor / 100, 0);

      return {
        receitas: receitasFiltradas,
        despesas: despesasFiltradas,
        total_receitas,
        total_despesas,
        lucro_liquido: total_receitas - total_despesas,
      };
    },
    [receitas, despesas]
  );

  return {
    receitas,
    despesas,
    loading: loading || receitasQuery.isLoading || despesasQuery.isLoading,
    criarReceita,
    excluirReceita,
    criarDespesa,
    excluirDespesa,
    obterResumo,
  };
}
