"use client";

import {
  Building2, Check, CheckSquare, ChevronsUpDown, Handshake, LayoutDashboard, LogOut, Menu as MenuIcon, Monitor, Moon, Plus,
  ScrollText, Search, ShieldCheck, Sun, Target, Users, UsersRound, type LucideIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Logo } from "@/components/logo";
import { SessionProvider, useCan, useSession, type SessionInfo } from "@/components/session";
import { Avatar, Button, Kbd, cn, useToast } from "@/components/ui";
import { ApiError, post } from "@/lib/api";
import { CommandPalette } from "./command-palette";
import { QuickCreateProvider, useQuickCreate, type CreateKind } from "./quick-create";

interface NavItem { href: string; label: string; icon: LucideIcon; show: boolean }

function useNav(): { main: NavItem[]; admin: NavItem[] } {
  const can = useCan();
  return {
    main: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, show: true },
      { href: "/tasks", label: "Tasks", icon: CheckSquare, show: can("task.read") },
      { href: "/leads", label: "Leads", icon: Target, show: can("lead.read") },
      { href: "/contacts", label: "Contacts", icon: Users, show: can("contact.read") },
      { href: "/companies", label: "Companies", icon: Building2, show: can("company.read") },
      { href: "/deals", label: "Deals", icon: Handshake, show: can("deal.read") },
    ].filter((i) => i.show),
    admin: [
      { href: "/settings/company", label: "Company", icon: Building2, show: can("org.manage") },
      { href: "/settings/team", label: "Team", icon: UsersRound, show: can("member.read") },
      { href: "/settings/audit", label: "Audit log", icon: ScrollText, show: can("audit.read") },
    ].filter((i) => i.show),
  };
}

/** Minimal accessible popover menu. */
export function Popover({ trigger, children, align = "right", label }: { trigger: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={label} className="rounded-lg">
        {trigger}
      </button>
      {open && (
        <div role="menu" className={cn("absolute top-full z-50 mt-2 min-w-56 rounded-xl border border-border bg-surface p-1.5 shadow-pop", align === "right" ? "right-0" : "left-0")}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, icon: Icon, active }: { children: ReactNode; onClick: () => void; icon?: LucideIcon; active?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-hover">
      {Icon && <Icon className="h-4 w-4 text-muted" aria-hidden />}
      <span className="flex-1 truncate">{children}</span>
      {active && <Check className="h-4 w-4 text-accent" aria-hidden />}
    </button>
  );
}

type ThemeMode = "light" | "dark" | "system";
const themeListeners = new Set<() => void>();

function readTheme(): ThemeMode {
  try {
    const t = localStorage.getItem("onecrm-theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function applyTheme(m: ThemeMode) {
  try {
    if (m === "system") {
      localStorage.removeItem("onecrm-theme");
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem("onecrm-theme", m);
      document.documentElement.dataset.theme = m;
    }
  } catch {}
  themeListeners.forEach((l) => l());
}

function subscribeTheme(cb: () => void) {
  themeListeners.add(cb);
  return () => { themeListeners.delete(cb); };
}

export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as ThemeMode);
  const Icon = mode === "dark" ? Moon : mode === "light" ? Sun : Monitor;
  return (
    <Popover label="Theme" trigger={<span className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-fg"><Icon className="h-4 w-4" /></span>}>
      {(close) => (
        <>
          <MenuItem icon={Sun} active={mode === "light"} onClick={() => { applyTheme("light"); close(); }}>Light</MenuItem>
          <MenuItem icon={Moon} active={mode === "dark"} onClick={() => { applyTheme("dark"); close(); }}>Dark</MenuItem>
          <MenuItem icon={Monitor} active={mode === "system"} onClick={() => { applyTheme("system"); close(); }}>System</MenuItem>
        </>
      )}
    </Popover>
  );
}

function CreateMenu() {
  const can = useCan();
  const { open } = useQuickCreate();
  const items: { kind: CreateKind; label: string; icon: LucideIcon; show: boolean }[] = [
    { kind: "task", label: "Task", icon: CheckSquare, show: can("task.write") },
    { kind: "contact", label: "Contact", icon: Users, show: can("contact.write") },
    { kind: "company", label: "Company", icon: Building2, show: can("company.write") },
    { kind: "lead", label: "Lead", icon: Target, show: can("lead.write") },
    { kind: "deal", label: "Deal", icon: Handshake, show: can("deal.write") },
  ];
  const visible = items.filter((i) => i.show);
  if (visible.length === 0) return null;
  return (
    <Popover label="Create new" trigger={<span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg hover:bg-accent-hover"><Plus className="h-4 w-4" />New</span>}>
      {(close) => visible.map((i) => <MenuItem key={i.kind} icon={i.icon} onClick={() => { close(); open(i.kind); }}>{i.label}</MenuItem>)}
    </Popover>
  );
}

function OrgSwitcher() {
  const { organization, organizations, role } = useSession();
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const switchTo = async (id: string) => {
    try {
      await post("/me/organization", { organizationId: id });
      qc.clear(); // never show another organization's cached data
      router.push("/dashboard");
      router.refresh();
    }
    catch (e) { toast(e instanceof ApiError ? e.message : "Could not switch organization", "danger"); }
  };
  return (
    <Popover align="left" trigger={
      <span className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover">
        {organization.logoUrl ? (
          // Admin-supplied https address, decorative (the company name sits beside it); no referrer is sent.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={organization.logoUrl} alt="" width={28} height={28} referrerPolicy="no-referrer" className="h-7 w-7 shrink-0 rounded-md object-contain" />
        ) : (
          <Avatar name={organization.name} size={28} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{organization.name}</span>
          <span className="block truncate text-xs text-faint">{role.name}</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-faint" aria-hidden />
      </span>
    }>
      {(close) => (
        <>
          <p className="px-2.5 py-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">Organizations</p>
          {organizations.map((o) => (
            <MenuItem key={o.id} active={o.id === organization.id} onClick={() => { close(); if (o.id !== organization.id) void switchTo(o.id); }}>
              {o.name} <span className="text-xs text-faint">· {o.roleName}</span>
            </MenuItem>
          ))}
        </>
      )}
    </Popover>
  );
}

function UserMenu() {
  const { user } = useSession();
  const router = useRouter();
  const signOut = async () => {
    await post("/auth/logout").catch(() => {});
    router.replace("/login");
    router.refresh();
  };
  return (
    <Popover label="Account" trigger={<Avatar name={user.name} size={32} labelled />}>
      {(close) => (
        <>
          <div className="px-2.5 py-2">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted">{user.email}</p>
          </div>
          <div className="my-1 border-t border-border" />
          <MenuItem icon={ShieldCheck} onClick={() => { close(); router.push("/settings/security"); }}>Security</MenuItem>
          <MenuItem icon={LogOut} onClick={() => { close(); void signOut(); }}>Sign out</MenuItem>
        </>
      )}
    </Popover>
  );
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(item.href + "/");
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-fg",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {item.label}
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const nav = useNav();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const sidebar = (
    <nav aria-label="Primary" className="flex h-full flex-col gap-1 p-3">
      <div className="px-2 pt-1 pb-3"><Logo /></div>
      <OrgSwitcher />
      <div className="mt-3 space-y-0.5">
        {nav.main.map((i) => <NavLink key={i.href} item={i} onNavigate={() => setNavOpen(false)} />)}
      </div>
      {nav.admin.length > 0 && (
        <>
          <p className="mt-5 px-2.5 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">Administration</p>
          <div className="space-y-0.5">
            {nav.admin.map((i) => <NavLink key={i.href} item={i} onNavigate={() => setNavOpen(false)} />)}
          </div>
        </>
      )}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-border bg-surface lg:block">{sidebar}</aside>
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setNavOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-surface shadow-pop">{sidebar}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur">
          <Button size="icon" variant="ghost" className="lg:hidden" aria-label="Open menu" onClick={() => setNavOpen(true)}><MenuIcon className="h-4 w-4" /></Button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full max-w-md items-center gap-2.5 rounded-lg border border-border bg-surface px-3 text-sm text-faint hover:border-border-strong"
          >
            <Search className="h-4 w-4" aria-hidden />
            <span className="flex-1 text-left">Search or jump to…</span>
            <span className="hidden gap-1 sm:flex"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <CreateMenu />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export function AppShell({ session, children }: { session: SessionInfo; children: ReactNode }) {
  return (
    <SessionProvider value={session}>
      <QuickCreateProvider>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        <Shell>{children}</Shell>
      </QuickCreateProvider>
    </SessionProvider>
  );
}
