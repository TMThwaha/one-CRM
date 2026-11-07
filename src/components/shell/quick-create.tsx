"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CompanyModal, ContactModal, DealModal, LeadModal, TaskModal, type TaskLinks } from "@/components/forms";

export type CreateKind = "contact" | "company" | "lead" | "deal" | "task";

interface Opener {
  open: (kind: CreateKind, opts?: { taskLinks?: TaskLinks }) => void;
}
const Ctx = createContext<Opener>({ open: () => {} });
export const useQuickCreate = () => useContext(Ctx);

export function QuickCreateProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<CreateKind | null>(null);
  const [links, setLinks] = useState<TaskLinks | undefined>();
  const open = useCallback<Opener["open"]>((k, opts) => {
    setLinks(opts?.taskLinks);
    setKind(k);
  }, []);
  const close = () => setKind(null);
  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <ContactModal open={kind === "contact"} onClose={close} />
      <CompanyModal open={kind === "company"} onClose={close} />
      <LeadModal open={kind === "lead"} onClose={close} />
      <DealModal open={kind === "deal"} onClose={close} />
      <TaskModal open={kind === "task"} onClose={close} links={links} />
    </Ctx.Provider>
  );
}
