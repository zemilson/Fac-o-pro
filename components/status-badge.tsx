import { Text, View } from "react-native";
import { PedidoStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: PedidoStatus;
  size?: "sm" | "md" | "lg";
}

const statusConfig: Record<PedidoStatus, { label: string; bgColor: string; textColor: string }> = {
  pendente: { label: "Pendente", bgColor: "bg-blue-100", textColor: "text-blue-700" },
  em_producao: { label: "Em Produção", bgColor: "bg-warning/20", textColor: "text-warning" },
  concluido: { label: "Concluído", bgColor: "bg-success/20", textColor: "text-success" },
  atrasado: { label: "Atrasado", bgColor: "bg-error/20", textColor: "text-error" },
};

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const config = statusConfig[status];

  const sizeClasses = {
    sm: "px-2 py-1",
    md: "px-3 py-1.5",
    lg: "px-4 py-2",
  };

  const textSizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  return (
    <View className={cn("rounded-full", sizeClasses[size], config.bgColor)}>
      <Text className={cn("font-semibold", textSizeClasses[size], config.textColor)}>
        {config.label}
      </Text>
    </View>
  );
}
