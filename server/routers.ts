import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import * as db from "./db";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  pedidos: router({
    list: protectedProcedure.query(({ ctx }) => db.getPedidosByUserId(ctx.user.id)),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(({ input }) => db.getPedidoById(input.id)),

    create: protectedProcedure
      .input(
        z.object({
          cliente: z.string().min(1),
          telefone: z.string().min(1),
          quantidade: z.number().min(1),
          tipo_servico: z.string().min(1),
          valor: z.number().min(0),
          descricao: z.string().optional(),
          observacoes: z.string().optional(),
          data_entrega: z.string(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createPedido({
          userId: ctx.user.id,
          cliente: input.cliente,
          telefone: input.telefone,
          quantidade: input.quantidade,
          tipo_servico: input.tipo_servico,
          valor: Math.round(input.valor * 100),
          descricao: input.descricao,
          observacoes: input.observacoes,
          data_entrega: new Date(input.data_entrega),
        })
      ),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["pendente", "em_producao", "concluido", "atrasado"]).optional(),
          data_conclusao: z.string().optional(),
        })
      )
      .mutation(({ input }) => {
        const updateData: any = {};
        if (input.status) updateData.status = input.status;
        if (input.data_conclusao) updateData.data_conclusao = new Date(input.data_conclusao);
        return db.updatePedido(input.id, updateData);
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => db.deletePedido(input.id)),
  }),

  receitas: router({
    list: protectedProcedure.query(({ ctx }) => db.getReceitasByUserId(ctx.user.id)),

    create: protectedProcedure
      .input(
        z.object({
          data: z.string(),
          descricao: z.string().min(1),
          valor: z.number().min(0),
          categoria: z.enum(["pedido", "outro"]).default("pedido"),
          observacoes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createReceita({
          userId: ctx.user.id,
          data: new Date(input.data),
          descricao: input.descricao,
          valor: Math.round(input.valor * 100),
          categoria: input.categoria,
          observacoes: input.observacoes,
        })
      ),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => db.deleteReceita(input.id)),
  }),

  despesas: router({
    list: protectedProcedure.query(({ ctx }) => db.getDespesasByUserId(ctx.user.id)),

    create: protectedProcedure
      .input(
        z.object({
          data: z.string(),
          descricao: z.string().min(1),
          valor: z.number().min(0),
          categoria: z.enum(["tecido", "insumos", "aluguel", "outro"]).default("outro"),
          observacoes: z.string().optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        db.createDespesa({
          userId: ctx.user.id,
          data: new Date(input.data),
          descricao: input.descricao,
          valor: Math.round(input.valor * 100),
          categoria: input.categoria,
          observacoes: input.observacoes,
        })
      ),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => db.deleteDespesa(input.id)),
  }),
});

export type AppRouter = typeof appRouter;
