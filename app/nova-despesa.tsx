import { ScrollView, Text, View, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useFinanceiro } from "@/hooks/use-financeiro";
import { DespesaCategoria } from "@/lib/types";
import { useState } from "react";

const CATEGORIAS: { label: string; value: DespesaCategoria }[] = [
  { label: "Tecido", value: "tecido" },
  { label: "Insumos", value: "insumos" },
  { label: "Aluguel", value: "aluguel" },
  { label: "Outro", value: "outro" },
];

export default function NovaDespesaScreen() {
  const router = useRouter();
  const { criarDespesa } = useFinanceiro();
  const [isLoading, setIsLoading] = useState(false);

  const [form, setForm] = useState({
    data: new Date().toISOString().split("T")[0],
    descricao: "",
    valor: "",
    categoria: "insumos" as DespesaCategoria,
    observacoes: "",
  });

  const handleSalvar = async () => {
    if (!form.descricao.trim() || !form.valor.trim()) {
      Alert.alert("Erro", "Preencha todos os campos obrigatórios");
      return;
    }

    setIsLoading(true);
    try {
      await criarDespesa({
        data: form.data,
        descricao: form.descricao,
        valor: parseFloat(form.valor),
        categoria: form.categoria,
        observacoes: form.observacoes || undefined,
      });
      Alert.alert("Sucesso", "Despesa registrada com sucesso");
      router.back();
    } catch (error) {
      Alert.alert("Erro", "Não foi possível registrar a despesa");
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
            <Text className="text-2xl font-bold text-foreground">Nova Despesa</Text>
            <Text className="text-sm text-muted">Registre uma despesa</Text>
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
                placeholder="Ex: Compra de tecido"
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
              <View className="gap-2">
                {CATEGORIAS.map((cat) => (
                  <Pressable
                    key={cat.value}
                    onPress={() => setForm({ ...form, categoria: cat.value })}
                    style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
                  >
                    <View
                      className={`px-4 py-3 rounded-lg ${
                        form.categoria === cat.value
                          ? "bg-error"
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
              <View className="bg-error rounded-lg p-4 items-center">
                {isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-base font-semibold text-background">Salvar Despesa</Text>
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
