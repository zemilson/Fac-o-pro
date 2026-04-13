import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { Pedido, PedidoStatus } from "@/lib/types";

const PEDIDOS_KEY = "@faccao_pedidos";

export function usePedidos() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);

  // Carregar pedidos do AsyncStorage
  const loadPedidos = useCallback(async () => {
    try {
      setLoading(true);
      const data = await AsyncStorage.getItem(PEDIDOS_KEY);
      if (data) {
        setPedidos(JSON.parse(data));
      }
    } catch (error) {
      console.error("Erro ao carregar pedidos:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Salvar pedidos no AsyncStorage
  const savePedidos = useCallback(async (data: Pedido[]) => {
    try {
      await AsyncStorage.setItem(PEDIDOS_KEY, JSON.stringify(data));
      setPedidos(data);
    } catch (error) {
      console.error("Erro ao salvar pedidos:", error);
    }
  }, []);

  // Criar novo pedido
  const criarPedido = useCallback(
    async (pedido: Omit<Pedido, "id" | "data_criacao">) => {
      const novoPedido: Pedido = {
        ...pedido,
        id: Date.now().toString(),
        data_criacao: new Date().toISOString(),
      };
      const novosPedidos = [...pedidos, novoPedido];
      await savePedidos(novosPedidos);
      return novoPedido;
    },
    [pedidos, savePedidos]
  );

  // Atualizar pedido
  const atualizarPedido = useCallback(
    async (id: string, updates: Partial<Pedido>) => {
      const novosPedidos = pedidos.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      );
      await savePedidos(novosPedidos);
    },
    [pedidos, savePedidos]
  );

  // Excluir pedido
  const excluirPedido = useCallback(
    async (id: string) => {
      const novosPedidos = pedidos.filter((p) => p.id !== id);
      await savePedidos(novosPedidos);
    },
    [pedidos, savePedidos]
  );

  // Obter pedido por ID
  const obterPedido = useCallback(
    (id: string) => {
      return pedidos.find((p) => p.id === id);
    },
    [pedidos]
  );

  // Filtrar pedidos por status
  const filtrarPorStatus = useCallback(
    (status: PedidoStatus) => {
      return pedidos.filter((p) => p.status === status);
    },
    [pedidos]
  );

  // Obter resumo de produção
  const obterResumo = useCallback(() => {
    const hoje = new Date().toISOString().split("T")[0];
    return {
      total_pedidos: pedidos.length,
      em_producao: pedidos.filter((p) => p.status === "em_producao").length,
      concluidos_hoje: pedidos.filter(
        (p) => {
          if (p.status !== "concluido" || !p.data_conclusao) return false;
          const dataStr = typeof p.data_conclusao === "string" ? p.data_conclusao : p.data_conclusao.toISOString();
          return dataStr.startsWith(hoje);
        }
      ).length,
      atrasados: pedidos.filter((p) => p.status === "atrasado").length,
    };
  }, [pedidos]);

  // Carregar pedidos ao montar o componente
  useEffect(() => {
    loadPedidos();
  }, [loadPedidos]);

  return {
    pedidos,
    loading,
    criarPedido,
    atualizarPedido,
    excluirPedido,
    obterPedido,
    filtrarPorStatus,
    obterResumo,
    recarregar: loadPedidos,
  };
}
