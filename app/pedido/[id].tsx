import { ScrollView, Text, View, Pressable, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { StatusBadge } from "@/components/status-badge";
import { usePedidosServer } from "@/hooks/use-pedidos-server";
import { useState } from "react";

export default function PedidoDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { obterPedido, atualizarPedido, excluirPedido, loading } = usePedidosServer();
  const [isUpdating, setIsUpdating] = useState(false);

  const pedido = obterPedido(id || "");

  if (loading) {
    return (
      <ScreenContainer className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B35" />
      </ScreenContainer>
    );
  }

  if (!pedido) {
    return (
      <ScreenContainer className="flex-1 items-center justify-center">
        <Text className="text-muted">Pedido não encontrado</Text>
      </ScreenContainer>
    );
  }

  const formatarData = (data: string | Date) => {
    const date = typeof data === "string" ? new Date(data) : data;
    return date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const handleMarcarConcluido = async () => {
    setIsUpdating(true);
    try {
      await atualizarPedido(pedido.id, {
        status: "concluido",
        data_conclusao: new Date().toISOString(),
      });
      router.back();
    } catch (error) {
      Alert.alert("Erro", "Não foi possível atualizar o pedido");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleExcluir = () => {
    Alert.alert("Excluir Pedido", "Tem certeza que deseja excluir este pedido?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: async () => {
          setIsUpdating(true);
          try {
            await excluirPedido(pedido.id);
            router.back();
          } catch (error) {
            Alert.alert("Erro", "Não foi possível excluir o pedido");
          } finally {
            setIsUpdating(false);
          }
        },
      },
    ]);
  };

  return (
    <ScreenContainer className="p-4">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View className="gap-6 pb-8">
          {/* Cabeçalho */}
          <View className="flex-row items-center justify-between">
            <View className="flex-1">
              <Text className="text-sm text-muted">Pedido #{String(pedido.id).slice(-4)}</Text>
              <Text className="text-2xl font-bold text-foreground">{pedido.cliente}</Text>
            </View>
            <StatusBadge status={pedido.status} />
          </View>

          {/* Informações Principais */}
          <View className="bg-surface rounded-2xl p-4 gap-4 border border-border">
            <View>
              <Text className="text-xs text-muted mb-1">Telefone</Text>
              <Text className="text-base font-semibold text-foreground">{pedido.telefone}</Text>
            </View>
            <View>
              <Text className="text-xs text-muted mb-1">Quantidade de Peças</Text>
              <Text className="text-base font-semibold text-foreground">{pedido.quantidade}</Text>
            </View>
            <View>
              <Text className="text-xs text-muted mb-1">Tipo de Serviço</Text>
              <Text className="text-base font-semibold text-foreground">{pedido.tipo_servico}</Text>
            </View>
            <View>
              <Text className="text-xs text-muted mb-1">Valor</Text>
              <Text className="text-base font-semibold text-foreground">
                R$ {pedido.valor.toFixed(2)}
              </Text>
            </View>
          </View>

          {/* Descrição */}
          <View className="gap-2">
            <Text className="text-sm font-semibold text-foreground">Descrição do Trabalho</Text>
            <View className="bg-surface rounded-xl p-4 border border-border">
              <Text className="text-sm text-foreground leading-relaxed">{pedido.descricao}</Text>
            </View>
          </View>

          {/* Datas */}
          <View className="gap-3">
            <View className="bg-surface rounded-xl p-4 border border-border">
              <Text className="text-xs text-muted mb-1">Data de Criação</Text>
              <Text className="text-base font-semibold text-foreground">
                {formatarData(pedido.data_criacao)}
              </Text>
            </View>
            <View className="bg-surface rounded-xl p-4 border border-border">
              <Text className="text-xs text-muted mb-1">Data de Entrega</Text>
              <Text className="text-base font-semibold text-foreground">
                {formatarData(pedido.data_entrega)}
              </Text>
            </View>
            {pedido.data_conclusao && (
              <View className="bg-surface rounded-xl p-4 border border-border">
                <Text className="text-xs text-muted mb-1">Data de Conclusão</Text>
                <Text className="text-base font-semibold text-foreground">
                  {formatarData(pedido.data_conclusao)}
                </Text>
              </View>
            )}
          </View>

          {/* Observações */}
          {pedido.observacoes && (
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">Observações</Text>
              <View className="bg-surface rounded-xl p-4 border border-border">
                <Text className="text-sm text-foreground leading-relaxed">
                  {pedido.observacoes}
                </Text>
              </View>
            </View>
          )}

          {/* Botões de Ação */}
          <View className="gap-3">
            {pedido.status !== "concluido" && (
              <Pressable
                onPress={handleMarcarConcluido}
                disabled={isUpdating}
                style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
              >
                <View className="bg-success rounded-xl p-4 items-center">
                  {isUpdating ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className="text-base font-semibold text-background">
                      Marcar como Concluído
                    </Text>
                  )}
                </View>
              </Pressable>
            )}
            <Pressable
              onPress={handleExcluir}
              disabled={isUpdating}
              style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
            >
              <View className="bg-error rounded-xl p-4 items-center">
                <Text className="text-base font-semibold text-background">Excluir Pedido</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
            >
              <View className="bg-surface border border-border rounded-xl p-4 items-center">
                <Text className="text-base font-semibold text-foreground">Voltar</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
