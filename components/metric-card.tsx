import { Text, View, Pressable } from "react-native";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  color?: "primary" | "success" | "warning" | "error";
  onPress?: () => void;
}

const colorClasses = {
  primary: "bg-primary/10",
  success: "bg-success/10",
  warning: "bg-warning/10",
  error: "bg-error/10",
};

const textColorClasses = {
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
};

export function MetricCard({
  title,
  value,
  subtitle,
  icon,
  color = "primary",
  onPress,
}: MetricCardProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View className={cn("rounded-2xl p-4 gap-2", colorClasses[color])}>
        <View className="flex-row items-center justify-between">
          <Text className="text-muted text-sm font-medium">{title}</Text>
          {icon && <View>{icon}</View>}
        </View>
        <Text className={cn("text-3xl font-bold", textColorClasses[color])}>
          {value}
        </Text>
        {subtitle && <Text className="text-muted text-xs">{subtitle}</Text>}
      </View>
    </Pressable>
  );
}
