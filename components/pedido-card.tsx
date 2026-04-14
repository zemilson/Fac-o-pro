import { Text, View, Pressable } from "react-native";
import { Pedido } from "@/lib/types";
import { StatusBadge } from "./status-badge";
import { cn } from "@/lib/utils";

interface PedidoCardProps {
  pedido: Pedido;
  onPress?: () => void;
}

export function PedidoCard({ pedido, onPress }: PedidoCardProps) {
  const dataEntrega = new Date(pedido.data_entrega);
  const hoje = new Date();
  const diasRestantes = Math.ceil(
    (dataEntrega.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24)
  );

  const formatarData = (data: string) => {
    return new Date(data).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    });
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View className="bg-surface rounded-xl p-4 mb-3 border border-border">
        {/* Cabeçalho */}
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-1">
            <Text className="text-sm text-muted">Pedido #{pedido.id.slice(-4)}</Text>
            <Text className="text-lg font-bold text-foreground">{pedido.cliente}</Text>
          </View>
          <StatusBadge status={pedido.status} size="sm" />
        </View>

        {/* Informações */}
        <View className="gap-2 mb-3">
          <View className="flex-row justify-between">
            <Text className="text-sm text-muted">Quantidade:</Text>
            <Text className="text-sm font-semibold text-foreground">{pedido.quantidade} peças</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-muted">Valor:</Text>
            <Text className="text-sm font-semibold text-foreground">
              R$ {pedido.valor.toFixed(2)}
            </Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-muted">Entrega:</Text>
            <Text className={cn("text-sm font-semibold", diasRestantes < 0 ? "text-error" : "text-foreground")}>
              {formatarData(pedido.data_entrega)} ({diasRestantes}d)
            </Text>
          </View>
        </View>

        {/* Descrição */}
        <View className="bg-background rounded-lg p-2">
          <Text className="text-xs text-muted" numberOfLines={2}>
            {pedido.descricao}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
