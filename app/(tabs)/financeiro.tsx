import { ScrollView, Text, View, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { MetricCard } from "@/components/metric-card";
import { useFinanceiro } from "@/hooks/use-financeiro";
import { useState } from "react";

type Periodo = "hoje" | "semana" | "mes";

const PERIODOS: { label: string; value: Periodo }[] = [
  { label: "Hoje", value: "hoje" },
  { label: "Semana", value: "semana" },
  { label: "Mês", value: "mes" },
];

export default function FinanceiroScreen() {
  const router = useRouter();
  const { receitas, despesas, loading, obterResumo } = useFinanceiro();
  const [periodoAtivo, setPeriodoAtivo] = useState<Periodo>("hoje");

  if (loading) {
    return (
      <ScreenContainer className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B35" />
      </ScreenContainer>
    );
  }

  const resumo = obterResumo(periodoAtivo);

  return (
    <ScreenContainer className="p-4">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View className="gap-6 pb-8">
          {/* Cabeçalho */}
          <View className="gap-1">
            <Text className="text-3xl font-bold text-foreground">Financeiro</Text>
            <Text className="text-sm text-muted">Controle de receitas e despesas</Text>
          </View>

          {/* Seletor de Período */}
          <View className="flex-row gap-2">
            {PERIODOS.map((periodo) => (
              <Pressable
                key={periodo.value}
                onPress={() => setPeriodoAtivo(periodo.value)}
                style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
              >
                <View
                  className={`px-4 py-2 rounded-full ${
                    periodoAtivo === periodo.value
                      ? "bg-primary"
                      : "bg-surface border border-border"
                  }`}
                >
                  <Text
                    className={`font-semibold ${
                      periodoAtivo === periodo.value ? "text-background" : "text-foreground"
                    }`}
                  >
                    {periodo.label}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>

          {/* Resumo */}
          <View className="gap-3">
            <MetricCard
              title="Receitas"
              value={`R$ ${resumo.total_receitas.toFixed(2)}`}
              color="success"
            />
            <MetricCard
              title="Despesas"
              value={`R$ ${resumo.total_despesas.toFixed(2)}`}
              color="error"
            />
            <MetricCard
              title="Lucro Líquido"
              value={`R$ ${resumo.lucro_liquido.toFixed(2)}`}
              color="primary"
            />
          </View>

          {/* Seção de Receitas */}
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-lg font-semibold text-foreground">Receitas</Text>
              <Pressable
                onPress={() => router.push("../nova-receita")}
                style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
              >
                <Text className="text-primary font-semibold">+ Adicionar</Text>
              </Pressable>
            </View>
            {resumo.receitas.length > 0 ? (
              <View className="gap-2">
                {resumo.receitas.slice(0, 3).map((receita) => (
                  <View key={receita.id} className="bg-surface rounded-lg p-3 border border-border">
                    <View className="flex-row justify-between">
                      <Text
                        className="text-sm font-semibold text-foreground flex-1"
                        numberOfLines={1}
                      >
                        {receita.descricao}
                      </Text>
                      <Text className="text-sm font-bold text-success">
                        + R$ {receita.valor.toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-muted text-sm">Nenhuma receita registrada</Text>
            )}
          </View>

          {/* Seção de Despesas */}
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-lg font-semibold text-foreground">Despesas</Text>
              <Pressable
                onPress={() => router.push("../nova-despesa")}
                style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
              >
                <Text className="text-primary font-semibold">+ Adicionar</Text>
              </Pressable>
            </View>
            {resumo.despesas.length > 0 ? (
              <View className="gap-2">
                {resumo.despesas.slice(0, 3).map((despesa) => (
                  <View key={despesa.id} className="bg-surface rounded-lg p-3 border border-border">
                    <View className="flex-row justify-between">
                      <Text
                        className="text-sm font-semibold text-foreground flex-1"
                        numberOfLines={1}
                      >
                        {despesa.descricao}
                      </Text>
                      <Text className="text-sm font-bold text-error">
                        - R$ {despesa.valor.toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-muted text-sm">Nenhuma despesa registrada</Text>
            )}
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
