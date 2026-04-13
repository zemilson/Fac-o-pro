import { ScrollView, Text, View, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { MetricCard } from "@/components/metric-card";
import { usePedidos } from "@/hooks/use-pedidos";
import { useFinanceiro } from "@/hooks/use-financeiro";

export default function HomeScreen() {
  const router = useRouter();
  const { pedidos, loading: pedidosLoading } = usePedidos();
  const { receitas, despesas, loading: financeiroLoading } = useFinanceiro();

  if (pedidosLoading || financeiroLoading) {
    return (
      <ScreenContainer className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B35" />
      </ScreenContainer>
    );
  }

  // Calcular resumo de produção
  const hoje = new Date().toISOString().split("T")[0];
  const emProducao = pedidos.filter((p) => p.status === "em_producao").length;
  const concluidos = pedidos.filter(
    (p) => p.status === "concluido" && p.data_conclusao?.startsWith(hoje)
  ).length;
  const atrasados = pedidos.filter((p) => p.status === "atrasado").length;

  // Calcular resumo financeiro do dia
  const receitasHoje = receitas.filter((r) => r.data.startsWith(hoje));
  const despesasHoje = despesas.filter((d) => d.data.startsWith(hoje));
  const totalReceitas = receitasHoje.reduce((sum, r) => sum + r.valor, 0);
  const totalDespesas = despesasHoje.reduce((sum, d) => sum + d.valor, 0);

  return (
    <ScreenContainer className="p-4">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View className="gap-6 pb-8">
          {/* Título */}
          <View className="gap-1">
            <Text className="text-3xl font-bold text-foreground">Facção Pro</Text>
            <Text className="text-sm text-muted">Bem-vindo de volta!</Text>
          </View>

          {/* Seção de Produção */}
          <View className="gap-3">
            <Text className="text-lg font-semibold text-foreground">Produção</Text>
            <View className="gap-3">
              <MetricCard
                title="Em Produção"
                value={emProducao}
                color="warning"
                onPress={() => router.push("./producao")}
              />
              <MetricCard
                title="Concluídos Hoje"
                value={concluidos}
                color="success"
                onPress={() => router.push("./producao")}
              />
              <MetricCard
                title="Atrasados"
                value={atrasados}
                color="error"
                onPress={() => router.push("./producao")}
              />
            </View>
          </View>

          {/* Seção Financeira */}
          <View className="gap-3">
            <Text className="text-lg font-semibold text-foreground">Financeiro</Text>
            <View className="gap-3">
              <MetricCard
                title="Receita do Dia"
                value={`R$ ${totalReceitas.toFixed(2)}`}
                color="success"
                onPress={() => router.push("./financeiro")}
              />
              <MetricCard
                title="Despesa do Dia"
                value={`R$ ${totalDespesas.toFixed(2)}`}
                color="error"
                onPress={() => router.push("./financeiro")}
              />
              <MetricCard
                title="Lucro do Dia"
                value={`R$ ${(totalReceitas - totalDespesas).toFixed(2)}`}
                color="primary"
                onPress={() => router.push("./financeiro")}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
