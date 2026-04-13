import { eq, and, gte, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, pedidos, receitas, despesas, InsertPedido, InsertReceita, InsertDespesa } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Pedidos queries
export async function getPedidosByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pedidos).where(eq(pedidos.userId, userId));
}

export async function getPedidoById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(pedidos).where(eq(pedidos.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createPedido(data: InsertPedido) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(pedidos).values(data);
  return (result as any).insertId || 0;
}

export async function updatePedido(id: number, data: Partial<InsertPedido>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(pedidos).set(data).where(eq(pedidos.id, id));
}

export async function deletePedido(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(pedidos).where(eq(pedidos.id, id));
}

// Receitas queries
export async function getReceitasByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(receitas).where(eq(receitas.userId, userId));
}

export async function createReceita(data: InsertReceita) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(receitas).values(data);
  return (result as any).insertId || 0;
}

export async function updateReceita(id: number, data: Partial<InsertReceita>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(receitas).set(data).where(eq(receitas.id, id));
}

export async function deleteReceita(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(receitas).where(eq(receitas.id, id));
}

// Despesas queries
export async function getDespesasByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(despesas).where(eq(despesas.userId, userId));
}

export async function createDespesa(data: InsertDespesa) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(despesas).values(data);
  return (result as any).insertId || 0;
}

export async function updateDespesa(id: number, data: Partial<InsertDespesa>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(despesas).set(data).where(eq(despesas.id, id));
}

export async function deleteDespesa(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(despesas).where(eq(despesas.id, id));
}
