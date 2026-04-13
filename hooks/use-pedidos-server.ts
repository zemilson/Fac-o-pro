import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Pedido } from "@/lib/types";

export function usePedidosServer() {
  const [loading, setLoading] = useState(false);

  // Queries
  const listQuery = trpc.pedidos.list.useQuery();
  const pedidos = listQuery.data || [];

  // Mutations
  const createMutation = trpc.pedidos.create.useMutation({
    onSuccess: () => {
      listQuery.refetch();
    },
  });

  const updateMutation = trpc.pedidos.update.useMutation({
    onSuccess: () => {
      listQuery.refetch();
    },
  });

  const deleteMutation = trpc.pedidos.delete.useMutation({
    onSuccess: () => {
      listQuery.refetch();
    },
  });

  const criarPedido = useCallback(
    async (data: {
      cliente: string;
      telefone: string;
      quantidade: number;
      tipo_servico: string;
      valor: number;
      descricao?: string;
      observacoes?: string;
      data_entrega: string;
    }) => {
      setLoading(true);
      try {
        await createMutation.mutateAsync(data);
      } finally {
        setLoading(false);
      }
    },
    [createMutation]
  );

  const atualizarPedido = useCallback(
    async (id: number, data: { status?: string; data_conclusao?: string }) => {
      setLoading(true);
      try {
        await updateMutation.mutateAsync({ id, ...data } as any);
      } finally {
        setLoading(false);
      }
    },
    [updateMutation]
  );

  const excluirPedido = useCallback(
    async (id: number) => {
      setLoading(true);
      try {
        await deleteMutation.mutateAsync({ id });
      } finally {
        setLoading(false);
      }
    },
    [deleteMutation]
  );

  const obterPedido = useCallback(
    (id: string | number) => {
      const numId = typeof id === "string" ? parseInt(id) : id;
      return pedidos.find((p) => p.id === numId);
    },
    [pedidos]
  );

  return {
    pedidos,
    loading: loading || listQuery.isLoading,
    criarPedido,
    atualizarPedido,
    excluirPedido,
    obterPedido,
  };
}
