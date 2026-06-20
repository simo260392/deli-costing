import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppLayout } from "@/components/AppLayout";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Ingredients from "@/pages/Ingredients";
import Suppliers from "@/pages/Suppliers";
import SubRecipes from "@/pages/SubRecipes";
import Recipes from "@/pages/Recipes";
import Products from "@/pages/Products";
import XeroImports from "@/pages/XeroImports";
import Settings from "@/pages/Settings";
import CustomPricing from "@/pages/CustomPricing";
import RecipeBook from "@/pages/RecipeBook";
import Prep from "@/pages/Prep";
import PrepReports from "@/pages/PrepReports";
import WholesalePackaging from "@/pages/WholesalePackaging";
import WagesDashboard from "@/pages/WagesDashboard";
import SafetyDashboard from "@/pages/SafetyDashboard";
import Deliveries from "@/pages/Deliveries";
import DeliveryLog from "@/pages/DeliveryLog";
import StockOrder from "@/pages/StockOrder";
import Compliance from "@/pages/Compliance";
import ComplianceLogEntry from "@/pages/ComplianceLogEntry";
import ComplianceAllergenMatrix from "@/pages/ComplianceAllergenMatrix";
import AllergenStatement from "@/pages/AllergenStatement";
import ChemicalsRegister from "@/pages/ChemicalsRegister";
import FridgeLogs from "@/pages/FridgeLogs";
import FridgeSettings from "@/pages/FridgeSettings";
import PrestartCheck from "@/pages/PrestartCheck";
import BatchManager from "@/pages/BatchManager";
import NotFound from "@/pages/not-found";

// Slug → path mapping for access control redirects
const PAGE_SLUGS: Array<{ slug: string; path: string }> = [
  { slug: "dashboard", path: "/" },
  { slug: "prep", path: "/prep" },
  { slug: "prep-reports", path: "/prep-reports" },
  { slug: "products", path: "/products" },
  { slug: "recipe-book", path: "/recipe-book" },
  { slug: "ingredients", path: "/ingredients" },
  { slug: "suppliers", path: "/suppliers" },
  { slug: "sub-recipes", path: "/sub-recipes" },
  { slug: "recipes", path: "/recipes" },
  { slug: "xero-imports", path: "/xero-imports" },
  { slug: "custom-pricing", path: "/custom-pricing" },
  { slug: "settings", path: "/settings" },
  { slug: "wholesale", path: "/wholesale" },
  { slug: "deliveries",     path: "/deliveries" },
  { slug: "delivery-log",   path: "/delivery-log" },
  { slug: "prestart-check", path: "/prestart-check" },
  { slug: "wages", path: "/wages" },
  { slug: "safety", path: "/safety" },
  { slug: "compliance",    path: "/compliance" },
  { slug: "fridge-logs",      path: "/compliance/fridge-logs" },
  { slug: "fridge-settings",  path: "/compliance/fridge-settings" },
];

function pathToSlug(path: string): string {
  if (path === "/" || path === "") return "dashboard";
  const stripped = path.replace(/^\//, "").replace(/\/.*$/, "");
  return stripped;
}

function AuthenticatedApp() {
  const { staff, isLoading } = useAuth();
  const [location, navigate] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#256984" }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          <span className="text-white/70 text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  if (!staff) {
    return <Login />;
  }

  // Access control: if on a page the user can't access, redirect to first allowed page
  const currentSlug = pathToSlug(location);
  const allowedPages = staff.accessLevel.pagesJson;
  const isAdmin = staff.accessLevel.name === "Admin";

  if (!isAdmin && !allowedPages.includes(currentSlug) && currentSlug !== "") {
    // Redirect to first allowed page, respecting the order defined in the user's pagesJson
    const firstSlug = allowedPages.find((slug: string) => PAGE_SLUGS.some(p => p.slug === slug));
    const firstAllowed = PAGE_SLUGS.find(p => p.slug === firstSlug);
    if (firstAllowed) {
      navigate(firstAllowed.path);
    }
  }

  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/ingredients" component={Ingredients} />
        <Route path="/suppliers" component={Suppliers} />
        <Route path="/sub-recipes" component={SubRecipes} />
        <Route path="/recipes" component={Recipes} />
        <Route path="/products" component={Products} />
        <Route path="/xero-imports" component={XeroImports} />
        <Route path="/settings" component={Settings} />
        <Route path="/custom-pricing" component={CustomPricing} />
        <Route path="/prep" component={Prep} />
        <Route path="/prep-reports" component={PrepReports} />
        <Route path="/recipe-book" component={RecipeBook} />
        <Route path="/wholesale" component={WholesalePackaging} />
        <Route path="/wages" component={WagesDashboard} />
        <Route path="/safety" component={SafetyDashboard} />
        <Route path="/deliveries" component={Deliveries} />
        <Route path="/delivery-log" component={DeliveryLog} />
        <Route path="/prestart-check" component={PrestartCheck} />
        <Route path="/stock-order" component={StockOrder} />
        <Route path="/compliance" component={Compliance} />
        <Route path="/compliance/allergens-matrix" component={ComplianceAllergenMatrix} />
        <Route path="/compliance/allergen-statement" component={AllergenStatement} />
        <Route path="/compliance/fridge-logs" component={FridgeLogs} />
        <Route path="/compliance/fridge-settings" component={FridgeSettings} />
        <Route path="/compliance/chemicals" component={ChemicalsRegister} />
        <Route path="/compliance/:logType/:logId" component={ComplianceLogEntry} />
        <Route path="/compliance/batch-manager" component={BatchManager} />

        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <Router hook={useHashLocation}>
            <AuthenticatedApp />
          </Router>
          <Toaster />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
