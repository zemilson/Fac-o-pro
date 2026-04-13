# Facção Pro: Design de Interface

## Visão Geral

Aplicativo móvel para gestão de facção de costura, focado em **controle de produção** e **módulo financeiro**. O app permite acompanhar pedidos em tempo real, gerenciar o status de produção e controlar receitas e despesas.

---

## Orientação de Design

- **Orientação**: Portrait (9:16)
- **Interação**: One-handed usage
- **Estilo**: Apple Human Interface Guidelines (HIG) — feel like a first-party iOS app
- **Paleta**: Cores profissionais com destaque para status de produção

---

## Paleta de Cores

| Cor | Uso | Hex |
|-----|-----|-----|
| **Primary** | Botões principais, destaques | #FF6B35 |
| **Success** | Status completo, receitas | #22C55E |
| **Warning** | Em produção, pendente | #F59E0B |
| **Error** | Atrasado, problemas | #EF4444 |
| **Background** | Fundo da tela | #FFFFFF (light) / #151718 (dark) |
| **Surface** | Cards, superfícies elevadas | #F5F5F5 (light) / #1E2022 (dark) |
| **Foreground** | Texto principal | #11181C (light) / #ECEDEE (dark) |
| **Muted** | Texto secundário | #687076 (light) / #9BA1A6 (dark) |

---

## Telas Principais

### 1. **Home / Dashboard**
**Objetivo**: Visão geral rápida da produção e financeiro

**Conteúdo**:
- Resumo do dia (pedidos em produção, concluídos, atrasados)
- Cards com métricas:
  - Pedidos em produção (contador)
  - Pedidos concluídos hoje (contador)
  - Receita do dia (valor)
  - Despesa do dia (valor)
- Botão flutuante para criar novo pedido
- Atalhos para Produção e Financeiro

**Funcionalidade**:
- Tap em card de métrica → vai para a tela correspondente
- Tap no botão flutuante → abre modal para novo pedido

---

### 2. **Produção / Pedidos**
**Objetivo**: Gerenciar todos os pedidos e seu status

**Conteúdo**:
- Lista de pedidos com filtros (Todos, Em Produção, Concluídos, Atrasados)
- Card de pedido exibindo:
  - Número do pedido
  - Cliente
  - Quantidade de peças
  - Status (badge com cor)
  - Data de entrega
  - Progresso visual (barra)
- Botão para adicionar novo pedido

**Funcionalidade**:
- Tap em pedido → abre detalhe do pedido
- Swipe left → opções de editar/excluir
- Filtros por status
- Busca por número de pedido ou cliente

---

### 3. **Detalhe do Pedido**
**Objetivo**: Visualizar e editar informações completas do pedido

**Conteúdo**:
- Cabeçalho com número do pedido e status
- Informações do cliente (nome, telefone)
- Detalhes da produção:
  - Quantidade de peças
  - Tipo de peça/serviço
  - Descrição do trabalho
  - Tecido/insumos utilizados
- Timeline de status (criado → em produção → concluído)
- Botões de ação:
  - Editar pedido
  - Marcar como concluído
  - Excluir pedido

**Funcionalidade**:
- Atualizar status do pedido
- Editar informações
- Registrar data de conclusão

---

### 4. **Novo/Editar Pedido**
**Objetivo**: Criar ou editar um pedido

**Conteúdo**:
- Formulário com campos:
  - Nome do cliente
  - Telefone do cliente
  - Quantidade de peças
  - Tipo de serviço (dropdown)
  - Descrição do trabalho
  - Data de entrega
  - Valor do pedido
  - Observações
- Botão Salvar/Atualizar
- Botão Cancelar

**Funcionalidade**:
- Validação de campos obrigatórios
- Salvar pedido localmente
- Retornar à lista de pedidos após salvar

---

### 5. **Financeiro / Resumo**
**Objetivo**: Visão geral de receitas e despesas

**Conteúdo**:
- Período selecionável (Hoje, Esta Semana, Este Mês)
- Cards com resumo:
  - Total de receitas (valor)
  - Total de despesas (valor)
  - Lucro líquido (valor)
- Gráfico de barras (receitas vs despesas)
- Botões para:
  - Registrar receita
  - Registrar despesa

**Funcionalidade**:
- Mudar período de visualização
- Tap em card → detalhe de receitas/despesas
- Tap em botão → abre modal para registrar

---

### 6. **Receitas**
**Objetivo**: Listar e gerenciar receitas

**Conteúdo**:
- Lista de receitas com filtro por período
- Card de receita exibindo:
  - Data
  - Descrição/Cliente
  - Valor
  - Categoria (Pedido, Outro)
- Botão para adicionar receita

**Funcionalidade**:
- Tap em receita → editar/excluir
- Buscar por cliente ou descrição
- Filtrar por período

---

### 7. **Despesas**
**Objetivo**: Listar e gerenciar despesas

**Conteúdo**:
- Lista de despesas com filtro por período
- Card de despesa exibindo:
  - Data
  - Descrição
  - Valor
  - Categoria (Tecido, Insumos, Aluguel, Outro)
- Botão para adicionar despesa

**Funcionalidade**:
- Tap em despesa → editar/excluir
- Buscar por descrição
- Filtrar por período e categoria

---

### 8. **Nova Receita / Nova Despesa**
**Objetivo**: Registrar receita ou despesa

**Conteúdo**:
- Formulário com campos:
  - Data
  - Descrição
  - Valor
  - Categoria (dropdown)
  - Observações (opcional)
- Botão Salvar
- Botão Cancelar

**Funcionalidade**:
- Validação de campos
- Salvar localmente
- Retornar à lista após salvar

---

## Fluxos Principais

### Fluxo 1: Criar Novo Pedido
1. Usuário toca botão flutuante na Home
2. Abre modal "Novo Pedido"
3. Preenche informações (cliente, quantidade, data entrega, valor)
4. Toca "Salvar"
5. Pedido aparece na lista de Produção com status "Novo"
6. Retorna à Home

### Fluxo 2: Acompanhar Produção
1. Usuário vai para aba Produção
2. Vê lista de pedidos filtrados por status
3. Toca em um pedido
4. Abre detalhe do pedido
5. Toca "Marcar como Concluído"
6. Status muda para "Concluído"
7. Retorna à lista

### Fluxo 3: Registrar Receita
1. Usuário vai para aba Financeiro
2. Toca "Registrar Receita"
3. Abre modal com formulário
4. Preenche cliente, valor, data
5. Toca "Salvar"
6. Receita aparece na lista e atualiza resumo
7. Retorna ao Financeiro

### Fluxo 4: Visualizar Relatório Financeiro
1. Usuário vai para aba Financeiro
2. Seleciona período (Hoje, Semana, Mês)
3. Vê resumo com totais e gráfico
4. Pode tocar em "Receitas" ou "Despesas" para ver detalhes
5. Retorna ao resumo

---

## Navegação

**Tab Bar (Bottom Navigation)**:
- Home (ícone: house.fill)
- Produção (ícone: wrench.fill)
- Financeiro (ícone: chart.bar.fill)

**Dentro de cada aba**:
- Uso de stack navigation para detalhe/edição
- Modal para criar novo item

---

## Componentes Reutilizáveis

| Componente | Uso |
|-----------|-----|
| **StatusBadge** | Exibir status do pedido com cor |
| **MetricCard** | Cards de resumo (receita, despesa, pedidos) |
| **PedidoCard** | Card de pedido na lista |
| **FinanceCard** | Card de receita/despesa na lista |
| **FormInput** | Campo de entrada de texto |
| **FormSelect** | Dropdown de categorias |
| **ConfirmDialog** | Confirmação de exclusão |

---

## Padrões de Interação

| Ação | Feedback |
|------|----------|
| Tap em botão | Scale 0.97 + haptic light |
| Tap em card | Opacity 0.7 |
| Swipe para excluir | Confirmação com undo |
| Sucesso ao salvar | Toast "Salvo com sucesso" |
| Erro ao salvar | Toast "Erro ao salvar" |

---

## Armazenamento de Dados

- **Local**: AsyncStorage para pedidos, receitas e despesas
- **Estrutura**:
  - `pedidos`: Array de objetos com id, cliente, quantidade, status, data, valor
  - `receitas`: Array de objetos com id, data, descrição, valor, categoria
  - `despesas`: Array de objetos com id, data, descrição, valor, categoria
