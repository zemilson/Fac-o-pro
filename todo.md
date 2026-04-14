# Facção Pro - TODO

## Fase 1: Estrutura Base e Branding

- [x] Gerar logo do app
- [x] Atualizar branding (app.config.ts, cores no theme.config.js)
- [x] Configurar paleta de cores (primary: #FF6B35, success: #22C55E, warning: #F59E0B, error: #EF4444)
- [x] Criar componentes base (StatusBadge, MetricCard, PedidoCard, FinanceCard)

## Fase 2: Controle de Produção

- [x] Implementar tela Home com dashboard (resumo de pedidos e financeiro)
- [x] Implementar tela Produção com lista de pedidos
- [x] Implementar filtros de status (Todos, Em Produção, Concluídos, Atrasados)
- [x] Implementar tela Detalhe do Pedido
- [ ] Implementar tela Novo/Editar Pedido com formulário
- [x] Implementar funcionalidade de marcar pedido como concluído
- [ ] Implementar busca por número de pedido ou cliente
- [ ] Implementar swipe para editar/excluir pedido
- [x] Integrar AsyncStorage para persistência de pedidos

## Fase 3: Módulo Financeiro

- [x] Implementar tela Financeiro com resumo (receitas, despesas, lucro)
- [x] Implementar seletor de período (Hoje, Esta Semana, Este Mês)
- [ ] Implementar gráfico de barras (receitas vs despesas)
- [ ] Implementar tela Receitas com lista
- [ ] Implementar tela Despesas com lista
- [x] Implementar tela Nova Receita com formulário
- [x] Implementar tela Nova Despesa com formulário
- [x] Implementar categorias de despesa (Tecido, Insumos, Aluguel, Outro)
- [x] Integrar AsyncStorage para persistência de receitas e despesas
- [x] Implementar cálculo de lucro líquido

## Fase 4: Refinamentos e Testes

- [x] Validação de formulários
- [x] Feedback visual (toasts, loading states)
- [ ] Testes de fluxos principais
- [ ] Otimização de performance
- [x] Tratamento de erros

## Fase 5: Entrega

- [x] Revisão final de UX/UI
- [ ] Criar checkpoint
- [ ] Documentação de uso
