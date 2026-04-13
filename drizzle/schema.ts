import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Pedidos table
export const pedidos = mysqlTable("pedidos", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  cliente: varchar("cliente", { length: 255 }).notNull(),
  telefone: varchar("telefone", { length: 20 }).notNull(),
  quantidade: int("quantidade").notNull(),
  tipo_servico: varchar("tipo_servico", { length: 255 }).notNull(),
  valor: int("valor").notNull(), // Armazenar em centavos (ex: 10050 = R$ 100.50)
  descricao: text("descricao"),
  observacoes: text("observacoes"),
  status: mysqlEnum("status", ["pendente", "em_producao", "concluido", "atrasado"]).default("pendente").notNull(),
  data_criacao: timestamp("data_criacao").defaultNow().notNull(),
  data_entrega: timestamp("data_entrega").notNull(),
  data_conclusao: timestamp("data_conclusao"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Pedido = typeof pedidos.$inferSelect;
export type InsertPedido = typeof pedidos.$inferInsert;

// Receitas table
export const receitas = mysqlTable("receitas", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  data: timestamp("data").notNull(),
  descricao: varchar("descricao", { length: 255 }).notNull(),
  valor: int("valor").notNull(), // Armazenar em centavos
  categoria: mysqlEnum("categoria", ["pedido", "outro"]).default("pedido").notNull(),
  observacoes: text("observacoes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Receita = typeof receitas.$inferSelect;
export type InsertReceita = typeof receitas.$inferInsert;

// Despesas table
export const despesas = mysqlTable("despesas", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  data: timestamp("data").notNull(),
  descricao: varchar("descricao", { length: 255 }).notNull(),
  valor: int("valor").notNull(), // Armazenar em centavos
  categoria: mysqlEnum("categoria", ["tecido", "insumos", "aluguel", "outro"]).default("outro").notNull(),
  observacoes: text("observacoes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Despesa = typeof despesas.$inferSelect;
export type InsertDespesa = typeof despesas.$inferInsert;
