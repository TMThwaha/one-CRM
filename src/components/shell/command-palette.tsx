"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Building2, CheckSquare, CornerDownLeft, Handshake, KeyRound, LayoutDashboard, Search, ScrollText, Target, UserPlus, Users, UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCan } from "@/components/session";
import { Kbd, Modal, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useQuickCreate, type CreateKind } from "./quick-create";

interface Item {
  key: string;
  label: string;
  hint?: string | null;
  group: string;
  icon: LucideIcon;
  run: () => void;
}

const TYPE_ICON: Record<string, LucideIcon> = { contact: Users, company: Building2, lead: Target, deal: Handshake, task: CheckSquare };

/** Cmd/Ctrl+K: search every record you may see, jump anywhere, or create something. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Command palette" width={600} bare>
      {/* Mounted only while open, so every opening starts with fresh state. */}
      <PaletteBody onClose={onClose} />
    </Modal>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const can = useCan();
  const { open: openCreate } = useQuickCreate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeRaw, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const search = useQuery({
    queryKey: ["search", debounced],
    enabled: debounced.length >= 2,
    queryFn: () => api<{ type: string; id: string; title: string; subtitle: string | null; href: string }[]>("/search", { query: { q: debounced } }),
    staleTime: 10_000,
  });

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => { onClose(); router.push(href); };
    const create = (k: CreateKind) => () => { onClose(); openCreate(k); };
    const nav: Item[] = [
      { key: "n-dash", label: "Go to Dashboard", group: "Navigate", icon: LayoutDashboard, run: go("/dashboard") },
      can("task.read") && { key: "n-tasks", label: "Go to Tasks", group: "Navigate", icon: CheckSquare, run: go("/tasks") },
      can("lead.read") && { key: "n-leads", label: "Go to Leads", group: "Navigate", icon: Target, run: go("/leads") },
      can("contact.read") && { key: "n-contacts", label: "Go to Contacts", group: "Navigate", icon: Users, run: go("/contacts") },
      can("company.read") && { key: "n-companies", label: "Go to Companies", group: "Navigate", icon: Building2, run: go("/companies") },
      can("deal.read") && { key: "n-deals", label: "Go to Deals", group: "Navigate", icon: Handshake, run: go("/deals") },
      can("member.read") && { key: "n-team", label: "Go to Team", group: "Navigate", icon: UsersRound, run: go("/settings/team") },
      can("role.read") && { key: "n-roles", label: "Go to Roles and permissions", group: "Navigate", icon: KeyRound, run: go("/settings/roles") },
      can("audit.read") && { key: "n-audit", label: "Go to Audit log", group: "Navigate", icon: ScrollText, run: go("/settings/audit") },
    ].filter(Boolean) as Item[];
    const make: Item[] = [
      can("task.write") && { key: "c-task", label: "Create task", group: "Create", icon: CheckSquare, run: create("task") },
      can("contact.write") && { key: "c-contact", label: "Create contact", group: "Create", icon: UserPlus, run: create("contact") },
      can("company.write") && { key: "c-company", label: "Create company", group: "Create", icon: Building2, run: create("company") },
      can("lead.write") && { key: "c-lead", label: "Create lead", group: "Create", icon: Target, run: create("lead") },
      can("deal.write") && { key: "c-deal", label: "Create deal", group: "Create", icon: Handshake, run: create("deal") },
    ].filter(Boolean) as Item[];

    const needle = q.trim().toLowerCase();
    const results: Item[] = (search.data ?? []).map((r) => ({
      key: `r-${r.type}-${r.id}`,
      label: r.title,
      hint: r.subtitle,
      group: r.type[0].toUpperCase() + r.type.slice(1) + "s",
      icon: TYPE_ICON[r.type] ?? Search,
      run: go(r.href),
    }));
    const cmds = [...nav, ...make].filter((i) => !needle || i.label.toLowerCase().includes(needle));
    return [...results, ...cmds];
  }, [q, search.data, can, router, onClose, openCreate]);

  const active = Math.min(activeRaw, Math.max(items.length - 1, 0));

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); items[active]?.run(); }
  };

  let lastGroup = "";
  return (
    <>
      <div onKeyDown={onKey}>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-faint" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            placeholder="Search contacts, deals, tasks… or type a command"
            aria-label="Search or run a command"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-list"
            className="w-full bg-transparent text-[15px] outline-none placeholder:text-faint"
          />
          {search.isFetching && <Spinner />}
        </div>
        <ul id="cmd-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted">
              {debounced.length >= 2 && !search.isFetching ? `No results for “${debounced}”` : "Nothing matches"}
            </li>
          )}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null;
            lastGroup = it.group;
            const Icon = it.icon;
            return (
              <li key={it.key} role="presentation">
                {header && <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">{header}</p>}
                <button
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={it.run}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === active ? "bg-accent-soft text-fg" : "text-fg"}`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                  <span className="truncate">{it.label}</span>
                  {it.hint && <span className="truncate text-xs text-faint">{it.hint}</span>}
                  {i === active && <CornerDownLeft className="ml-auto h-3.5 w-3.5 text-faint" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-xs text-faint">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate</span>
          <span><Kbd>↵</Kbd> select</span>
          <span><Kbd>Esc</Kbd> close</span>
        </div>
      </div>
    </>
  );
}
