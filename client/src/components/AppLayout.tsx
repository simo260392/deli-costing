import { Link, useLocation } from "wouter";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/context/AuthContext";
import logoWhite from "/logo-white.png";
import {
  LayoutDashboard, Package, Truck, BookOpen, BookMarked, UtensilsCrossed,
  Store, Settings, Moon, Sun, Menu, RefreshCw, Calculator, ChefHat,
  BarChart3, LogOut, User, Archive, TrendingUp, Utensils, ChevronDown, ShieldCheck, ShoppingBag, ClipboardCheck, FileText, Leaf, FlaskConical, Car, Thermometer, AlertTriangle
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

// Top-level nav items (in display order)
const topNavItems = [
  { href: "/",            label: "Dashboard",          icon: LayoutDashboard, slug: "dashboard" },
];

// Production group sub-items
const productionSubItems = [
  { href: "/prep-reports",       label: "Production Reports", icon: BarChart3,     slug: "prep-reports" },
  { href: "/missing-items-report", label: "Missing Items",    icon: AlertTriangle, slug: "prep-reports" },
];

// Items after the Production group
const midNavItems = [
  { href: "/stock-order",  label: "Stock Ordering",     icon: ShoppingBag, slug: "stock-order" },
  { href: "/wages",        label: "Wages",              icon: TrendingUp,  slug: "wages" },
  { href: "/safety",       label: "Safety",             icon: ShieldCheck, slug: "safety" },
  { href: "/xero-imports", label: "Invoice Imports",    icon: RefreshCw,   slug: "xero-imports" },
];

// Deliveries sub-items
const deliveriesSubItems = [
  { href: "/deliveries",      label: "Grey Box Tracker",   icon: Package, slug: "deliveries" },
  { href: "/prestart-check",  label: "Pre-Start Check",    icon: Car,     slug: "prestart-check" },
];

// Wholesale group sub-items
const wholesaleSubItems = [
  { href: "/wholesale",    label: "Wholesale Packaging", icon: Archive,  slug: "wholesale" },
];

// Food group sub-items
const foodSubItems = [
  { href: "/products",      label: "Products",       icon: Store,          slug: "products" },
  { href: "/ingredients",   label: "Ingredients",    icon: Package,        slug: "ingredients" },
  { href: "/recipes",       label: "Recipes",        icon: UtensilsCrossed,slug: "recipes" },
  { href: "/sub-recipes",   label: "Sub-Recipes",    icon: BookOpen,       slug: "sub-recipes" },
  { href: "/suppliers",     label: "Suppliers",      icon: Truck,          slug: "suppliers" },
  { href: "/recipe-book",   label: "Product Info PDF",icon: BookMarked,     slug: "recipe-book" },
  { href: "/custom-pricing",label: "Custom Pricing", icon: Calculator,     slug: "custom-pricing" },
];

const foodSlugs = new Set(foodSubItems.map(i => i.slug));
const foodHrefs = new Set(foodSubItems.map(i => i.href));

// Compliance group sub-items
const complianceSubItems = [
  { href: "/compliance",                    label: "Records Hub",        icon: ClipboardCheck, slug: "compliance" },
  { href: "/compliance/fridge-logs",        label: "Fridge Logs",        icon: Thermometer,    slug: "compliance" },
  { href: "/compliance/batch-manager",      label: "Batch Manager",      icon: Package,        slug: "compliance" },
  { href: "/compliance/allergens-matrix",   label: "Allergens Matrix",   icon: Leaf,           slug: "compliance" },
  { href: "/compliance/chemicals",          label: "Chemicals Register", icon: FlaskConical,   slug: "compliance" },
  { href: "/compliance/allergen-statement", label: "Allergen Statement", icon: FileText,       slug: "compliance" },
];

// Bottom-pinned items
const bottomNavItems = [
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

  // Auto-expand Food group if currently on a food sub-page
  const onFoodPage = foodSubItems.some(i => location === i.href || location.startsWith(i.href + "/"));
  const [foodOpen, setFoodOpen] = useState(onFoodPage);

  // Auto-expand Production group if currently on a production sub-page
  const onProductionSubPage = productionSubItems.some(i => location === i.href || location.startsWith(i.href + "/"));
  const onProductionPage = location === "/prep" || location.startsWith("/prep/") || onProductionSubPage;
  const [productionOpen, setProductionOpen] = useState(onProductionSubPage);

  // Auto-expand Deliveries group if currently on a deliveries sub-page
  const onDeliveriesSubPage = deliveriesSubItems.some(i => location === i.href || location.startsWith(i.href + "/"));
  const onDeliveriesPage = location === "/delivery-log" || location.startsWith("/delivery-log/") || onDeliveriesSubPage;
  const [deliveriesOpen, setDeliveriesOpen] = useState(onDeliveriesSubPage);

  // Auto-expand Wholesale group if currently on a wholesale sub-page
  const onWholesalePage = wholesaleSubItems.some(i => location === i.href || location.startsWith(i.href + "/"));
  const [wholesaleOpen, setWholesaleOpen] = useState(onWholesalePage);

  // Auto-expand Compliance group if currently on a compliance sub-page
  const onCompliancePage = location === "/compliance" || location.startsWith("/compliance/");
  const [complianceOpen, setComplianceOpen] = useState(onCompliancePage);

  const { data: xeroCountData } = useQuery({
    queryKey: ["/api/xero/imports/pending-count"],
    queryFn: () => apiRequest("GET", "/api/xero/imports/pending-count").then((r) => r.json()),
    refetchInterval: 60000,
  });
  const xeroCount: number = xeroCountData?.count ?? 0;

  const isActive = (href: string) =>
    href === "/" ? location === "/" || location === "" : location === href || location.startsWith(href + "/");

  const navLink = (href: string, label: string, Icon: any, slug: string, indent = false) => (
    <li key={href}>
      <Link
        href={href}
        onClick={() => setMobileOpen(false)}
        className={cn(
          "flex items-center gap-3 rounded-md text-sm font-medium transition-colors",
          indent ? "px-3 py-2 pl-8" : "px-3 py-2.5",
          isActive(href)
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        )}
        data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <Icon size={15} strokeWidth={isActive(href) ? 2.5 : 2} />
        <span className="flex-1">{label}</span>
        {label === "Invoice Imports" && xeroCount > 0 && (
          <span className={cn(
            "ml-auto text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[20px] text-center leading-none",
            isActive(href) ? "bg-white/20 text-white" : "bg-amber-500 text-white"
          )}>
            {xeroCount}
          </span>
        )}
      </Link>
    </li>
  );

  const sidebar = (
    <nav className="flex flex-col h-full">
      <Logo />
      <div className="flex-1 overflow-y-auto py-3 px-3">
        <ul className="space-y-0.5">

          {/* 1. Dashboard */}
          {topNavItems.filter(({ slug }) => hasAccess(slug)).map(({ href, label, icon: Icon, slug }) =>
            navLink(href, label, Icon, slug)
          )}

          {/* 2. Food group */}
          {foodSubItems.some(({ slug }) => hasAccess(slug)) && (
            <li>
              <button
                onClick={() => setFoodOpen(o => !o)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  onFoodPage
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                data-testid="nav-food-group"
              >
                <Utensils size={15} strokeWidth={onFoodPage ? 2.5 : 2} />
                <span className="flex-1 text-left">Food</span>
                <ChevronDown
                  size={14}
                  className={cn("transition-transform duration-200", foodOpen ? "rotate-0" : "-rotate-90")}
                />
              </button>
              {foodOpen && (
                <ul className="mt-0.5 space-y-0.5">
                  {foodSubItems.filter(({ slug }) => hasAccess(slug)).map(({ href, label, icon: Icon, slug }) =>
                    navLink(href, label, Icon, slug, true)
                  )}
                </ul>
              )}
            </li>
          )}

          {/* 3. Production (with Production Reports sub-item for authorised users) */}
          {hasAccess("prep") && (
            <li>
              {/* Row: link to /prep + chevron toggle (only shown if user has access to sub-items) */}
              <div className="flex items-center">
                <Link
                  href="/prep"
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex flex-1 items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                    onProductionPage
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  data-testid="nav-production"
                >
                  <ChefHat size={15} strokeWidth={onProductionPage ? 2.5 : 2} />
                  <span className="flex-1">Production</span>
                </Link>
                {/* Only show chevron if user has access to at least one sub-item */}
                {productionSubItems.some(({ slug }) => hasAccess(slug)) && (
                  <button
                    onClick={() => setProductionOpen(o => !o)}
                    className={cn(
                      "px-2 py-2.5 rounded-md transition-colors",
                      onProductionPage
                        ? "text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                    data-testid="nav-production-toggle"
                    aria-label="Toggle production sub-menu"
                  >
                    <ChevronDown
                      size={14}
                      className={cn("transition-transform duration-200", productionOpen ? "rotate-0" : "-rotate-90")}
                    />
                  </button>
                )}
              </div>
              {/* Sub-items — only visible when expanded AND user has access */}
              {productionOpen && productionSubItems.some(({ slug }) => hasAccess(slug)) && (
                <ul className="mt-0.5 space-y-0.5">
                  {productionSubItems.filter(({ slug }) => hasAccess(slug)).map(({ href, label, icon: Icon, slug }) =>
                    navLink(href, label, Icon, slug, true)
                  )}
                </ul>
              )}
            </li>
          )}

          {/* 4. Deliveries (with Grey Box Tracker sub-item) */}
          {(hasAccess("delivery-log") || deliveriesSubItems.some(({ slug }) => hasAccess(slug))) && (
            <li>
              <div className="flex items-center">
                <Link
                  href="/delivery-log"
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex flex-1 items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                    onDeliveriesPage
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  data-testid="nav-deliveries"
                >
                  <Truck size={15} strokeWidth={onDeliveriesPage ? 2.5 : 2} />
                  <span className="flex-1">Deliveries</span>
                </Link>
                {deliveriesSubItems.some(({ slug }) => hasAccess(slug)) && (
                  <button
                    onClick={() => setDeliveriesOpen(o => !o)}
                    className={cn(
                      "px-2 py-2.5 rounded-md transition-colors",
                      onDeliveriesPage
                        ? "text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                    data-testid="nav-deliveries-toggle"
                    aria-label="Toggle deliveries sub-menu"
                  >
                    <ChevronDown
                      size={14}
                      className={cn("transition-transform duration-200", deliveriesOpen ? "rotate-0" : "-rotate-90")}
                    />
                  </button>
                )}
              </div>
              {deliveriesOpen && deliveriesSubItems.some(({ slug }) => hasAccess(slug)) && (
                <ul className="mt-0.5 space-y-0.5">
                  {deliveriesSubItems.filter(({ slug }) => hasAccess(slug)).map(({ href, label, icon: Icon, slug }) =>
                    navLink(href, label, Icon, slug, true)
                  )}
                </ul>
              )}
            </li>
          )}

          {/* 5. Wholesale group */}
          {wholesaleSubItems.some(({ slug }) => hasAccess(slug)) && (
            <li>
              <button
                onClick={() => setWholesaleOpen(o => !o)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                  onWholesalePage
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
                data-testid="nav-wholesale-group"
              >
                <ShoppingBag size={15} strokeWidth={onWholesalePage ? 2.5 : 2} />
                <span className="flex-1 text-left">Wholesale</span>
                <ChevronDown
                  size={14}
                  className={cn("transition-transform duration-200", wholesaleOpen ? "rotate-0" : "-rotate-90")}
                />
              </button>
              {wholesaleOpen && (
                <ul className="mt-0.5 space-y-0.5">
                  {wholesaleSubItems.filter(({ slug }) => hasAccess(slug)).map(({ href, label, icon: Icon, slug }) =>
                    navLink(href, label, Icon, slug, true)
                  )}
                </ul>
              )}
            </li>
          )}

          {/* 6. Wages + Safety + Invoice Imports */}
          {midNavItems.filter(({ slug }) => hasAccess(slug)).map(({ href, label, icon: Icon, slug }) =>
            navLink(href, label, Icon, slug)
          )}

          {/* 7. Compliance (always visible to logged-in users — shared kitchen tool) */}
          <li>
            <button
              onClick={() => setComplianceOpen(o => !o)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                onCompliancePage
                  ? "text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
              data-testid="nav-compliance-group"
            >
              <ClipboardCheck size={15} strokeWidth={onCompliancePage ? 2.5 : 2} />
              <span className="flex-1 text-left">Compliance</span>
              <ChevronDown
                size={14}
                className={cn("transition-transform duration-200", complianceOpen ? "rotate-0" : "-rotate-90")}
              />
            </button>
            {complianceOpen && (
              <ul className="mt-0.5 space-y-0.5">
                {complianceSubItems.map(({ href, label, icon: Icon, slug }) =>
                  navLink(href, label, Icon, slug, true)
                )}
              </ul>
            )}
          </li>

          {/* 8. Settings (bottom-pinned) */}
          {bottomNavItems.filter(({ slug }) => hasAccess(slug)).map(({ href, label, icon: Icon, slug }) =>
            navLink(href, label, Icon, slug)
          )}

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
