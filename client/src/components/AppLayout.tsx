import { Link, useLocation } from "wouter";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/context/AuthContext";
import logoWhite from "/logo-white.png";
import {
  LayoutDashboard, Package, Truck, BookOpen, BookMarked, UtensilsCrossed,
  Store, Settings, Moon, Sun, Menu, RefreshCw, Calculator, ChefHat,
  ClipboardList, BarChart3, LogOut, User
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, slug: "dashboard" },
  { href: "/prep", label: "Production", icon: ChefHat, slug: "prep" },
  { href: "/prep-reports", label: "Production Reports", icon: BarChart3, slug: "prep-reports" },
  { href: "/products", label: "Products", icon: Store, slug: "products" },
  { href: "/wholesale", label: "Wholesale Packaging", icon: Package, slug: "wholesale" },
  { href: "/recipe-book", label: "Product Info PDF", icon: BookMarked, slug: "recipe-book" },
  { href: "/ingredients", label: "Ingredients", icon: Package, slug: "ingredients" },
  { href: "/suppliers", label: "Suppliers", icon: Truck, slug: "suppliers" },
  { href: "/sub-recipes", label: "Sub-Recipes", icon: BookOpen, slug: "sub-recipes" },
  { href: "/recipes", label: "Recipes", icon: UtensilsCrossed, slug: "recipes" },
  { href: "/xero-imports", label: "Invoice Imports", icon: RefreshCw, slug: "xero-imports" },
  { href: "/custom-pricing", label: "Custom Pricing", icon: Calculator, slug: "custom-pricing" },
  { href: "/settings", label: "Settings", icon: Settings, slug: "settings" },
];

function Logo() {
  return (
    <div className="flex items-center justify-center px-4 py-4 border-b border-white/20" style={{ backgroundColor: "#256984" }}>
      <img
        src={logoWhite}
        alt="The Deli by Greenhorns"
        className="w-full max-w-[160px] h-auto object-contain"
        style={{ imageRendering: "-webkit-optimize-contrast" }}
      />
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();
  const { staff, logout, hasAccess } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: xeroCountData } = useQuery({
    queryKey: ["/api/xero/imports/pending-count"],
    queryFn: () => apiRequest("GET", "/api/xero/imports/pending-count").then((r) => r.json()),
    refetchInterval: 60000,
  });
  const xeroCount: number = xeroCountData?.count ?? 0;

  const isActive = (href: string) =>
    href === "/" ? location === "/" || location === "" : location === href || location.startsWith(href + "/");

  // Filter nav items by access
  const visibleNavItems = navItems.filter(({ slug }) => hasAccess(slug));

  const sidebar = (
    <nav className="flex flex-col h-full">
      <Logo />
      <div className="flex-1 overflow-y-auto py-3 px-3">
        <ul className="space-y-0.5">
          {visibleNavItems.map(({ href, label, icon: Icon, slug }) => (
            <li key={href}>
              <Link
                href={href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  isActive(href)
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <Icon size={16} strokeWidth={isActive(href) ? 2.5 : 2} />
                <span className="flex-1">{label}</span>
                {label === "Invoice Imports" && xeroCount > 0 && (
                  <span className={cn(
                    "ml-auto text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center leading-none",
                    isActive(href)
                      ? "bg-white/20 text-white"
                      : "bg-amber-500 text-white"
                  )}>
                    {xeroCount}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom bar: staff name + logout + theme toggle */}
      <div className="border-t border-border px-3 py-3 space-y-1">
        {staff && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded-md">
            <User size={14} className="text-muted-foreground shrink-0" />
            <span className="text-xs text-foreground font-medium truncate flex-1" data-testid="text-staff-name">
              {staff.name}
            </span>
            <button
              onClick={logout}
              title="Log out"
              data-testid="button-logout"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
        <button
          onClick={toggle}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
          data-testid="button-theme-toggle"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-border bg-card">
        {sidebar}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-56 bg-card border-r border-border flex flex-col">
            {sidebar}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Mobile header */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-white/20" style={{ backgroundColor: "#256984" }}>
          <button
            onClick={() => setMobileOpen(true)}
            className="text-white/80 hover:text-white"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <img
            src={logoWhite}
            alt="The Deli by Greenhorns"
            className="h-7 w-auto object-contain"
            style={{ imageRendering: "-webkit-optimize-contrast" }}
          />
        </header>

        <main className="flex-1 overflow-y-auto overscroll-contain">
          {children}
        </main>
      </div>
    </div>
  );
}
