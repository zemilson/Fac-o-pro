import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { Receita, Despesa, ResumoFinanceiro } from "@/lib/types";

const RECEITAS_KEY = "@faccao_receitas";
const DESPESAS_KEY = "@faccao_despesas";

export function useFinanceiro() {
  const [receitas, setReceitas] = useState<Receita[]>([]);
  const [despesas, setDespesas] = useState<Despesa[]>([]);
  const [loading, setLoading] = useState(true);

  // Carregar dados do AsyncStorage
  const loadFinanceiro = useCallback(async () => {
    try {
      setLoading(true);
      const [receitasData, despesasData] = await Promise.all([
        AsyncStorage.getItem(RECEITAS_KEY),
        AsyncStorage.getItem(DESPESAS_KEY),
      ]);
      if (receitasData) setReceitas(JSON.parse(receitasData));
      if (despesasData) setDespesas(JSON.parse(despesasData));
    } catch (error) {
      console.error("Erro ao carregar dados financeiros:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Salvar receitas
  const saveReceitas = useCallback(async (data: Receita[]) => {
    try {
      await AsyncStorage.setItem(RECEITAS_KEY, JSON.stringify(data));
      setReceitas(data);
    } catch (error) {
      console.error("Erro ao salvar receitas:", error);
    }
  }, []);

  // Salvar despesas
  const saveDespesas = useCallback(async (data: Despesa[]) => {
    try {
      await AsyncStorage.setItem(DESPESAS_KEY, JSON.stringify(data));
      setDespesas(data);
    } catch (error) {
      console.error("Erro ao salvar despesas:", error);
    }
  }, []);

  // Criar receita
  const criarReceita = useCallback(
    async (receita: Omit<Receita, "id">) => {
      const novaReceita: Receita = {
        ...receita,
        id: Date.now().toString(),
      };
      const novasReceitas = [...receitas, novaReceita];
      await saveReceitas(novasReceitas);
      return novaReceita;
    },
    [receitas, saveReceitas]
  );

  // Criar despesa
  const criarDespesa = useCallback(
    async (despesa: Omit<Despesa, "id">) => {
      const novaDespesa: Despesa = {
        ...despesa,
        id: Date.now().toString(),
      };
      const novasDespesas = [...despesas, novaDespesa];
      await saveDespesas(novasDespesas);
      return novaDespesa;
    },
    [despesas, saveDespesas]
  );

  // Atualizar receita
  const atualizarReceita = useCallback(
    async (id: string, updates: Partial<Receita>) => {
      const novasReceitas = receitas.map((r) =>
        r.id === id ? { ...r, ...updates } : r
      );
      await saveReceitas(novasReceitas);
    },
    [receitas, saveReceitas]
  );

  // Atualizar despesa
  const atualizarDespesa = useCallback(
    async (id: string, updates: Partial<Despesa>) => {
      const novasDespesas = despesas.map((d) =>
        d.id === id ? { ...d, ...updates } : d
      );
      await saveDespesas(novasDespesas);
    },
    [despesas, saveDespesas]
  );

  // Excluir receita
  const excluirReceita = useCallback(
    async (id: string) => {
      const novasReceitas = receitas.filter((r) => r.id !== id);
      await saveReceitas(novasReceitas);
    },
    [receitas, saveReceitas]
  );

  // Excluir despesa
  const excluirDespesa = useCallback(
    async (id: string) => {
      const novasDespesas = despesas.filter((d) => d.id !== id);
      await saveDespesas(novasDespesas);
    },
    [despesas, saveDespesas]
  );

  // Obter resumo por período
  const obterResumo = useCallback(
    (periodo: "hoje" | "semana" | "mes"): ResumoFinanceiro => {
      const agora = new Date();
      let dataInicio = new Date();

      if (periodo === "hoje") {
        dataInicio.setHours(0, 0, 0, 0);
      } else if (periodo === "semana") {
        dataInicio.setDate(agora.getDate() - agora.getDay());
        dataInicio.setHours(0, 0, 0, 0);
      } else if (periodo === "mes") {
        dataInicio.setDate(1);
        dataInicio.setHours(0, 0, 0, 0);
      }

      const receitasFiltradas = receitas.filter(
        (r) => new Date(r.data) >= dataInicio
      );
      const despesasFiltradas = despesas.filter(
        (d) => new Date(d.data) >= dataInicio
      );

      const totalReceitas = receitasFiltradas.reduce((sum, r) => sum + r.valor, 0);
      const totalDespesas = despesasFiltradas.reduce((sum, d) => sum + d.valor, 0);

      return {
        periodo,
        total_receitas: totalReceitas,
        total_despesas: totalDespesas,
        lucro_liquido: totalReceitas - totalDespesas,
        receitas: receitasFiltradas,
        despesas: despesasFiltradas,
      };
    },
    [receitas, despesas]
  );

  // Carregar dados ao montar
  useEffect(() => {
    loadFinanceiro();
  }, [loadFinanceiro]);

  return {
    receitas,
    despesas,
    loading,
    criarReceita,
    criarDespesa,
    atualizarReceita,
    atualizarDespesa,
    excluirReceita,
    excluirDespesa,
    obterResumo,
    recarregar: loadFinanceiro,
  };
}
