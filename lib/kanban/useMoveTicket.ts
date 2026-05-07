"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TicketStatus } from "@prisma/client";
import { moveTicketAction } from "@/app/actions/kanban";
import type { KanbanTicket } from "@/lib/tickets/types";

interface MoveArgs {
  ticketId: string;
  toStatus: TicketStatus;
  newOrder: number;
}

/**
 * Hook de mutation "déplacer ticket" avec optimistic update.
 * En cas d'erreur serveur (FORBIDDEN, NOT_FOUND), on rollback proprement.
 */
export function useMoveTicket(projectId: string) {
  const qc = useQueryClient();
  const queryKey = ["kanban", projectId] as const;

  return useMutation({
    mutationFn: async (args: MoveArgs) => {
      const res = await moveTicketAction(args);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<KanbanTicket[]>(queryKey);
      qc.setQueryData<KanbanTicket[]>(queryKey, (old) =>
        (old ?? []).map((t) =>
          t.id === args.ticketId
            ? { ...t, status: args.toStatus, boardOrder: args.newOrder }
            : t
        )
      );
      return { previous };
    },
    onError: (_err, _args, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey });
    },
  });
}
