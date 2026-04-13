import { Text, View, Pressable } from "react-native";
import { Receita, Despesa } from "@/lib/types";
import { cn } from "@/lib/utils";

interface FinanceCardProps {
  item: Receita | Despesa;
  type: "receita" | "despesa";
  onPress?: () => void;
}

const categoryLabels = {
  // Receitas
  pedido: "Pedido",
  outro: "Outro",
  // Despesas
  tecido: "Tecido",
  insumos: "Insumos",
  aluguel: "Aluguel",
};

export function FinanceCard({ item, type, onPress }: FinanceCardProps) {
  const formatarData = (data: string | Date) => {
    const date = typeof data === "string" ? new Date(data) : data;
    return date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    });
  };

  const isReceita = type === "receita";
  const bgColor = isReceita ? "bg-success/10" : "bg-error/10";
  const textColor = isReceita ? "text-success" : "text-error";
  const sinal = isReceita ? "+" : "-";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View className={cn("rounded-xl p-4 mb-3 border border-border", bgColor)}>
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-1">
            <Text className="text-xs text-muted mb-1">
              {categoryLabels[(item as any).categoria as keyof typeof categoryLabels]}
            </Text>
            <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
              {item.descricao}
            </Text>
          </View>
          <Text className={cn("text-lg font-bold", textColor)}>
            {sinal} R$ {item.valor.toFixed(2)}
          </Text>
        </View>
        <Text className="text-xs text-muted">{formatarData(item.data)}</Text>
      </View>
    </Pressable>
  );
}
