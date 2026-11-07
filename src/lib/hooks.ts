"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useCan } from "@/components/session";

export interface MemberLite {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  status: string;
  roleKey: string;
  roleName: string;
}

export function useMembers() {
  return useQuery({
    queryKey: ["members"],
    queryFn: () => api<MemberLite[]>("/members"),
    staleTime: 60_000,
  });
}

export function useCompanyOptions() {
  const can = useCan();
  return useQuery({
    queryKey: ["company-options"],
    enabled: can("company.read"),
    queryFn: () => api<{ items: { id: string; name: string }[] }>("/companies", { query: { pageSize: 100 } }).then((r) => r.items),
    staleTime: 30_000,
  });
}

export function useContactOptions() {
  const can = useCan();
  return useQuery({
    queryKey: ["contact-options"],
    enabled: can("contact.read"),
    queryFn: () =>
      api<{ items: { id: string; firstName: string; lastName: string | null }[] }>("/contacts", { query: { pageSize: 100 } }).then((r) => r.items),
    staleTime: 30_000,
  });
}

export interface PipelineLite {
  id: string;
  name: string;
  isDefault: boolean;
  stages: { id: string; name: string; kind: "open" | "won" | "lost"; probability: number; position: number }[];
}

export function usePipelines() {
  const can = useCan();
  return useQuery({
    queryKey: ["pipelines"],
    enabled: can("deal.read"),
    queryFn: () => api<PipelineLite[]>("/pipelines"),
    staleTime: 60_000,
  });
}
