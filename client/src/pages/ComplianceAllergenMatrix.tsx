/**
 * ComplianceAllergenMatrix
 *
 * A full allergen matrix showing which FSANZ allergens are present in each
 * active product. Data sourced from recipe costing (computed_allergens_json)
 * for products that have been costed, or Flex Catering allergen data otherwise.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, CheckCircle2, Search, FileDown } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: number;
  name: string;
  sku: string;
  categories: string[];
  allergens: string[];
  hasCosting: boolean;
}

interface MatrixData {
  allergens: string[];
  products: Product[];
}

// ─── Allergen colour mapping (FSANZ badge colours) ────────────────────────────

const ALLERGEN_COLOURS: Record<string, { bg: string; text: string }> = {
  Gluten:      { bg: "#FEF2C7", text: "#92400E" },
  "Tree Nuts": { bg: "#FCE7F3", text: "#9D174D" },
  Dairy:       { bg: "#DBEAFE", text: "#1E40AF" },
  Eggs:        { bg: "#FEF9C3", text: "#713F12" },
  Peanuts:     { bg: "#FEE2E2", text: "#991B1B" },
  Sesame:      { bg: "#FEF3C7", text: "#78350F" },
  Soy:         { bg: "#DCFCE7", text: "#14532D" },
  Fish:        { bg: "#E0F2FE", text: "#075985" },
  Sulphites:   { bg: "#F3E8FF", text: "#6B21A8" },
  Crustacea:   { bg: "#FFEDD5", text: "#9A3412" },
  Molluscs:    { bg: "#E0E7FF", text: "#3730A3" },
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function ComplianceAllergenMatrix() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [allergenFilter, setAllergenFilter] = useState("all");
  const [pdfLoading, setPdfLoading] = useState(false);

  const { data, isLoading, isError } = useQuery<MatrixData>({
    queryKey: ["/api/compliance/allergen-matrix"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/compliance/allergen-matrix");
      return res.json();
    },
  });

  const allergens = data?.allergens ?? [];
  const products = data?.products ?? [];

  // All unique categories across products
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const p of products) {
      for (const c of p.categories) cats.add(c);
    }
    return Array.from(cats).sort();
  }, [products]);

  // Filtered product list
  const filtered = useMemo(() => {
    return products.filter((p) => {
      const matchSearch = !search.trim() || p.name.toLowerCase().includes(search.toLowerCase());
      const matchCat =
        categoryFilter === "all" ||
        p.categories.includes(categoryFilter);
      const matchAllergen =
        allergenFilter === "all" ||
        (allergenFilter === "none"
          ? p.allergens.length === 0
          : p.allergens.includes(allergenFilter));
      return matchSearch && matchCat && matchAllergen;
    });
  }, [products, search, categoryFilter, allergenFilter]);

  // Count products containing each allergen
  const allergenCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of allergens) {
      counts[a] = products.filter((p) => p.allergens.includes(a)).length;
    }
    return counts;
  }, [products, allergens]);

  // ── PDF download ────────────────────────────────────────────────────────────
  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      // Build a simple PDF via the browser print dialog (matrix is too wide for ReportLab without a custom script)
      window.print();
    } catch {
      // silently ignore
    } finally {
      setPdfLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading allergen matrix...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 p-4 text-red-600">
        <AlertCircle size={16} />
        Failed to load allergen data.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1
            className="text-xl font-bold"
            style={{ color: "#256984" }}
          >
            Allergen Matrix
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            FSANZ allergen presence across all active products. Allergens are computed
            from recipe costing where available.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleDownloadPdf}
          disabled={pdfLoading}
          className="h-10 px-4 gap-2 border-[#256984] text-[#256984] hover:bg-[#256984]/10 print:hidden"
        >
          <FileDown size={16} />
          Print / Export
        </Button>
      </div>

      {/* Allergen summary chips */}
      <div className="flex flex-wrap gap-2 mb-6 print:hidden">
        {allergens.map((a) => {
          const col = ALLERGEN_COLOURS[a] ?? { bg: "#F3F4F6", text: "#374151" };
          return (
            <button
              key={a}
              onClick={() =>
                setAllergenFilter((prev) => (prev === a ? "all" : a))
              }
              className="px-3 py-1 rounded-full text-xs font-semibold transition-opacity"
              style={{
                backgroundColor: col.bg,
                color: col.text,
                opacity: allergenFilter === "all" || allergenFilter === a ? 1 : 0.4,
                border: `1.5px solid ${allergenFilter === a ? col.text : "transparent"}`,
              }}
            >
              {a} ({allergenCounts[a] ?? 0})
            </button>
          );
        })}
        {allergenFilter !== "all" && (
          <button
            onClick={() => setAllergenFilter("all")}
            className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200"
          >
            Clear filter ×
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4 print:hidden">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {allCategories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Count */}
      <p className="text-xs text-muted-foreground mb-4 print:hidden">
        Showing {filtered.length} of {products.length} products
      </p>

      {/* Matrix table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#256984] text-white">
              <th className="text-left px-4 py-3 font-semibold min-w-[200px] sticky left-0 bg-[#256984] z-10">
                Product
              </th>
              {allergens.map((a) => {
                const col = ALLERGEN_COLOURS[a] ?? { bg: "#F3F4F6", text: "#374151" };
                return (
                  <th
                    key={a}
                    className="px-2 py-3 font-semibold text-center min-w-[80px] whitespace-nowrap"
                    title={a}
                  >
                    <span
                      className="inline-block px-1.5 py-0.5 rounded text-xs"
                      style={{ backgroundColor: col.bg, color: col.text }}
                    >
                      {a}
                    </span>
                  </th>
                );
              })}
              <th className="px-3 py-3 font-semibold text-center text-xs min-w-[80px]">
                Source
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={allergens.length + 2}
                  className="text-center py-10 text-muted-foreground"
                >
                  No products match your filters.
                </td>
              </tr>
            ) : (
              filtered.map((product, idx) => (
                <tr
                  key={product.id}
                  className={
                    idx % 2 === 0
                      ? "bg-white hover:bg-[#256984]/5"
                      : "bg-gray-50 hover:bg-[#256984]/5"
                  }
                >
                  {/* Product name — sticky */}
                  <td className={`px-4 py-2.5 font-medium sticky left-0 z-10 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                    <div className="flex flex-col gap-0.5">
                      <span>{product.name}</span>
                      {product.sku && (
                        <span className="text-xs text-muted-foreground">{product.sku}</span>
                      )}
                    </div>
                  </td>

                  {/* Allergen cells */}
                  {allergens.map((a) => {
                    const present = product.allergens.includes(a);
                    const col = ALLERGEN_COLOURS[a] ?? { bg: "#FEE2E2", text: "#991B1B" };
                    return (
                      <td key={a} className="px-2 py-2.5 text-center">
                        {present ? (
                          <span
                            className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold"
                            style={{ backgroundColor: col.bg, color: col.text }}
                            title={`Contains ${a}`}
                          >
                            ✓
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">–</span>
                        )}
                      </td>
                    );
                  })}

                  {/* Source badge */}
                  <td className="px-3 py-2.5 text-center">
                    {product.hasCosting ? (
                      <span
                        title="Allergens computed from recipe costing"
                        className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-1.5 py-0.5 rounded"
                      >
                        <CheckCircle2 size={11} />
                        Recipe
                      </span>
                    ) : (
                      <span
                        title="Allergens sourced from Flex Catering sync — may not reflect actual recipe"
                        className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded"
                      >
                        Flex
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer note */}
      <p className="text-xs text-muted-foreground mt-4">
        ✓ = allergen present &nbsp;|&nbsp; – = not detected &nbsp;|&nbsp;
        <strong>Recipe</strong> = computed from ingredient-level costing &nbsp;|&nbsp;
        <strong>Flex</strong> = sourced from Flex Catering sync only (add a recipe costing for higher accuracy).
        Always verify allergen information before use. This matrix is for internal reference only.
      </p>
    </div>
  );
}
