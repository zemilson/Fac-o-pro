import { ScrollView, Text, View, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { PedidoCard } from "@/components/pedido-card";
import { usePedidosServer } from "@/hooks/use-pedidos-server";
import { PedidoStatus } from "@/lib/types";
import { useState } from "react";

const FILTROS: { label: string; status?: PedidoStatus }[] = [
  { label: "Todos" },
  { label: "Em Produção", status: "em_producao" },
  { label: "Concluídos", status: "concluido" },
  { label: "Atrasados", status: "atrasado" },
];

export default function ProducaoScreen() {
  const router = useRouter();
  const { pedidos, loading } = usePedidosServer();
  const [filtroAtivo, setFiltroAtivo] = useState<PedidoStatus | undefined>(undefined);

  const pedidosFiltrados = filtroAtivo
    ? pedidos.filter((p) => p.status === filtroAtivo)
    : pedidos;

  if (loading) {
    return (
      <ScreenContainer className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B35" />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="p-4">
      <View className="flex-1 gap-4">
        {/* Cabeçalho */}
        <View className="gap-1">
          <Text className="text-3xl font-bold text-foreground">Produção</Text>
          <Text className="text-sm text-muted">{pedidosFiltrados.length} pedidos</Text>
        </View>

        {/* Filtros */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {FILTROS.map((filtro) => (
            <Pressable
              key={filtro.label}
              onPress={() => setFiltroAtivo(filtro.status)}
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
            >
              <View
                className={`px-4 py-2 rounded-full ${
                  filtroAtivo === filtro.status
                    ? "bg-primary"
                    : "bg-surface border border-border"
                }`}
              >
                <Text
                  className={`font-semibold ${
                    filtroAtivo === filtro.status ? "text-background" : "text-foreground"
                  }`}
                >
                  {filtro.label}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        {/* Lista de Pedidos */}
        {pedidosFiltrados.length > 0 ? (
          <FlatList
            data={pedidosFiltrados}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <PedidoCard
                pedido={item}
                onPress={() => router.push(`../pedido/${item.id}`)}
              />
            )}
            scrollEnabled={false}
            contentContainerStyle={{ gap: 0 }}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Text className="text-muted">Nenhum pedido encontrado</Text>
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}
