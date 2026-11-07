"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Permission, PermissionMap } from "@/shared/permissions";

export interface SessionInfo {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; baseCurrency: string };
  role: { key: string; name: string };
  permissions: PermissionMap;
  organizations: { id: string; name: string; roleName: string }[];
}

const Ctx = createContext<SessionInfo | null>(null);

export function SessionProvider({ value, children }: { value: SessionInfo; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionInfo {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside SessionProvider");
  return v;
}

/** UI convenience only (hiding controls). The server enforces every permission independently. */
export function useCan() {
  const { permissions } = useSession();
  return (p: Permission) => permissions[p] !== undefined;
}
