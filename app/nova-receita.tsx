import { ScrollView, Text, View, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useFinanceiroServer } from "@/hooks/use-financeiro-server";
import { ReceitaCategoria } from "@/lib/types";
import { useState } from "react";

const CATEGORIAS: { label: string; value: ReceitaCategoria }[] = [
  { label: "Pedido", value: "pedido" },
  { label: "Outro", value: "outro" },
];

export default function NovaReceitaScreen() {
  const router = useRouter();
  const { criarReceita } = useFinanceiroServer();
  const [isLoading, setIsLoading] = useState(false);

  const [form, setForm] = useState({
    data: new Date().toISOString().split("T")[0],
    descricao: "",
    valor: "",
    categoria: "pedido" as ReceitaCategoria,
    observacoes: "",
  });

  const handleSalvar = async () => {
    if (!form.descricao.trim() || !form.valor.trim()) {
      Alert.alert("Erro", "Preencha todos os campos obrigatórios");
      return;
    }

    setIsLoading(true);
    try {
      await criarReceita({
        data: form.data,
        descricao: form.descricao,
        valor: parseFloat(form.valor),
        categoria: form.categoria,
        observacoes: form.observacoes || undefined,
      });
      Alert.alert("Sucesso", "Receita registrada com sucesso");
      router.back();
    } catch (error) {
      Alert.alert("Erro", "Não foi possível registrar a receita");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScreenContainer className="p-4">
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <View className="gap-6 pb-8">
          {/* Cabeçalho */}
          <View className="gap-1">
            <Text className="text-2xl font-bold text-foreground">Nova Receita</Text>
            <Text className="text-sm text-muted">Registre uma receita</Text>
          </View>

          {/* Formulário */}
          <View className="gap-4">
            {/* Data */}
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">Data</Text>
              <TextInput
                value={form.data}
                onChangeText={(text) => setForm({ ...form, data: text })}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#687076"
                className="bg-surface border border-border rounded-lg p-3 text-foreground"
              />
            </View>

            {/* Descrição */}
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">Descrição *</Text>
              <TextInput
                value={form.descricao}
                onChangeText={(text) => setForm({ ...form, descricao: text })}
                placeholder="Ex: Venda de pedido #001"
                placeholderTextColor="#687076"
                className="bg-surface border border-border rounded-lg p-3 text-foreground"
              />
            </View>

            {/* Valor */}
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">Valor (R$) *</Text>
              <TextInput
                value={form.valor}
                onChangeText={(text) => setForm({ ...form, valor: text })}
                placeholder="0.00"
                placeholderTextColor="#687076"
                keyboardType="decimal-pad"
                className="bg-surface border border-border rounded-lg p-3 text-foreground"
              />
            </View>

            {/* Categoria */}
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">Categoria</Text>
              <View className="flex-row gap-2">
                {CATEGORIAS.map((cat) => (
                  <Pressable
                    key={cat.value}
                    onPress={() => setForm({ ...form, categoria: cat.value })}
                    style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
                  >
                    <View
                      className={`px-4 py-2 rounded-lg ${
                        form.categoria === cat.value
                          ? "bg-success"
                          : "bg-surface border border-border"
                      }`}
                    >
                      <Text
                        className={`font-semibold ${
                          form.categoria === cat.value ? "text-background" : "text-foreground"
                        }`}
                      >
                        {cat.label}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Observações */}
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">Observações</Text>
              <TextInput
                value={form.observacoes}
                onChangeText={(text) => setForm({ ...form, observacoes: text })}
                placeholder="Adicione observações (opcional)"
                placeholderTextColor="#687076"
                multiline
                numberOfLines={4}
                className="bg-surface border border-border rounded-lg p-3 text-foreground"
              />
            </View>
          </View>

          {/* Botões */}
          <View className="gap-3">
            <Pressable
              onPress={handleSalvar}
              disabled={isLoading}
              style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
            >
              <View className="bg-success rounded-lg p-4 items-center">
                {isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-base font-semibold text-background">Salvar Receita</Text>
                )}
              </View>
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              disabled={isLoading}
              style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
            >
              <View className="bg-surface border border-border rounded-lg p-4 items-center">
                <Text className="text-base font-semibold text-foreground">Cancelar</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}
