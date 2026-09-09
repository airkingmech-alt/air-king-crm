import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  FileText,
  BookOpen,
  Calendar,
  Crown,
  Receipt,
  Menu,
  X,
  Sun,
  Moon,
  LogOut,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth, type AppRole } from "@/context/auth-context";

const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Owner",
  admin: "Admin",
  technician: "Technician",
  dispatcher: "Office / Dispatcher",
  member: "Member",
};

const navItems: { path: string; label: string; icon: any; ownerOnly?: boolean }[] = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/customers", label: "Customers", icon: Users },
  { path: "/quotes", label: "Quotes", icon: FileText },
  { path: "/pricebook", label: "Pricebook", icon: BookOpen },
  { path: "/schedule", label: "Schedule", icon: Calendar },
  { path: "/crown-care", label: "Crown Care", icon: Crown },
  { path: "/invoices", label: "Invoices", icon: Receipt },
  { path: "/team", label: "Team", icon: UserCog, ownerOnly: true },
];

export function AirKingLogo({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <svg width="32" height="32" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Air King logo">
        {/* Crown */}
        <path d="M6 16L10 8L14 14L20 6L26 14L30 8L34 16L34 20L6 20L6 16Z" fill="#D4A53A" />
        <circle cx="10" cy="7" r="2" fill="#D4A53A" />
        <circle cx="20" cy="5" r="2" fill="#D4A53A" />
        <circle cx="30" cy="7" r="2" fill="#D4A53A" />
        {/* Text "AK" */}
        <text x="20" y="33" textAnchor="middle" fontSize="12" fontWeight="800" fill="#DC2626" fontFamily="system-ui, sans-serif">AK</text>
        {/* Base oval */}
        <ellipse cx="20" cy="37" rx="12" ry="1.5" fill="#D4A53A" opacity="0.6" />
      </svg>
      <div className="flex flex-col leading-none">
        <span className="text-sm font-extrabold tracking-tight text-white">AIR KING</span>
        <span className="text-[10px] font-medium text-sky-300/80 tracking-wide">MECHANICAL SERVICES</span>
      </div>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const { profile, signOut } = useAuth();

  const name = profile?.full_name || "User";
  const initials =
    name
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U";
  const roleLabel = ROLE_LABELS[profile?.role ?? "member"];

  return (
    <aside className="flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-5 py-4 border-b border-sidebar-border">
        <AirKingLogo />
        <button
          className="lg:hidden text-sidebar-foreground/60 hover:text-sidebar-foreground"
          onClick={onNavigate}
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems
          .filter((item) => !item.ownerOnly || profile?.role === "owner")
          .map((item) => {
          const Icon = item.icon;
          const active = location === item.path || (item.path !== "/" && location.startsWith(item.path));
          return (
            <Link
              key={item.path}
              href={item.path}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              )}
            >
              <Icon size={18} strokeWidth={2} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500 text-white text-sm font-bold">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{name}</p>
            <p className="text-xs text-sidebar-foreground/60">{roleLabel}</p>
          </div>
          <button
            onClick={() => signOut()}
            className="text-sidebar-foreground/50 hover:text-white transition-colors"
            aria-label="Sign out"
            data-testid="button-logout"
            title="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
    document.documentElement.classList.toggle("dark");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {/* Mobile sidebar */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileNavOpen(false)} />
          <div className="absolute left-0 top-0 h-full">
            <Sidebar onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/50 backdrop-blur-sm z-10">
          <button
            className="lg:hidden text-foreground"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <div className="flex-1 lg:flex hidden">
            <p className="text-sm text-muted-foreground">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleDarkMode}
              aria-label="Toggle theme"
              data-testid="button-theme-toggle"
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </Button>
            <Link href="/quotes">
              <Button
                size="sm"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                data-testid="button-new-quote"
              >
                <FileText size={16} className="mr-1.5" />
                New Quote
              </Button>
            </Link>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
