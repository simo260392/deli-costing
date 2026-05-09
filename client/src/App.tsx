import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppLayout } from "@/components/AppLayout";
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
import NotFound from "@/pages/not-found";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Router hook={useHashLocation}>
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
              <Route component={NotFound} />
            </Switch>
          </AppLayout>
        </Router>
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
