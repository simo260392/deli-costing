import supabase from "./supabase";
import type {
  Supplier, InsertSupplier,
  Ingredient, InsertIngredient,
  SupplierIngredient, InsertSupplierIngredient,
  SubRecipe, InsertSubRecipe,
  Recipe, InsertRecipe,
  Platter, InsertPlatter,
  Setting, InsertSetting,
  Invoice, InsertInvoice,
  XeroImport,
  XeroLineItem, InsertXeroLineItem,
  InvoiceMemory,
  FlexProduct, FlexProductCosting,
} from "@shared/schema";

// ── Helper: camelCase <-> snake_case conversion ─────────────────────────────
// Supabase returns snake_case columns; our app uses camelCase types.
function toCamel(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toCamel);
  if (typeof obj !== "object") return obj;
  const result: any = {};
  for (const key of Object.keys(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = toCamel(obj[key]);
  }
  return result;
}

function toSnake(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(toSnake);
  if (typeof obj !== "object") return obj;
  const result: any = {};
  for (const key of Object.keys(obj)) {
    const snakeKey = key.replace(/([A-Z])/g, (c) => "_" + c.toLowerCase());
    result[snakeKey] = obj[key];
  }
  return result;
}

// ── Sync wrappers ────────────────────────────────────────────────────────────
// The app expects synchronous storage methods. We run async calls via
// a synchronous-ish pattern using a global event loop trick.
// However, since Express routes can be async, we expose async versions
// and the routes will need to be converted to async.
// For now, we expose both sync-compatible (throwing on error) and async methods.

// NOTE: Since all Express routes will be converted to async/await,
// we expose async functions that the routes will await directly.
// The IStorage interface will be updated to return Promises.

export interface IStorage {
  // Suppliers
  getSuppliers(): Promise<Supplier[]>;
  getSupplier(id: number): Promise<Supplier | undefined>;
  createSupplier(data: InsertSupplier): Promise<Supplier>;
  updateSupplier(id: number, data: Partial<InsertSupplier>): Promise<Supplier | undefined>;
  deleteSupplier(id: number): Promise<void>;

  // Ingredients
  getIngredients(): Promise<Ingredient[]>;
  getIngredient(id: number): Promise<Ingredient | undefined>;
  createIngredient(data: InsertIngredient): Promise<Ingredient>;
  updateIngredient(id: number, data: Partial<InsertIngredient>): Promise<Ingredient | undefined>;
  deleteIngredient(id: number): Promise<void>;
  refreshIngredientBestPrice(ingredientId: number): Promise<void>;

  // Supplier Ingredients
  getSupplierIngredients(ingredientId?: number, supplierId?: number): Promise<SupplierIngredient[]>;
  createSupplierIngredient(data: InsertSupplierIngredient): Promise<SupplierIngredient>;
  updateSupplierIngredient(id: number, data: Partial<InsertSupplierIngredient>): Promise<SupplierIngredient | undefined>;
  deleteSupplierIngredient(id: number): Promise<void>;

  // Sub-Recipes
  getSubRecipes(): Promise<SubRecipe[]>;
  getSubRecipe(id: number): Promise<SubRecipe | undefined>;
  createSubRecipe(data: InsertSubRecipe): Promise<SubRecipe>;
  updateSubRecipe(id: number, data: Partial<InsertSubRecipe>): Promise<SubRecipe | undefined>;
  deleteSubRecipe(id: number): Promise<void>;

  // Recipes
  getRecipes(): Promise<Recipe[]>;
  getRecipe(id: number): Promise<Recipe | undefined>;
  createRecipe(data: InsertRecipe): Promise<Recipe>;
  updateRecipe(id: number, data: Partial<InsertRecipe>): Promise<Recipe | undefined>;
  deleteRecipe(id: number): Promise<void>;

  // Platters
  getPlatters(): Promise<Platter[]>;
  getPlatter(id: number): Promise<Platter | undefined>;
  createPlatter(data: InsertPlatter): Promise<Platter>;
  updatePlatter(id: number, data: Partial<InsertPlatter>): Promise<Platter | undefined>;
  deletePlatter(id: number): Promise<void>;

  // Flex Products
  getFlexProducts(): Promise<FlexProduct[]>;
  getFlexProduct(id: number): Promise<FlexProduct | undefined>;
  upsertFlexProduct(data: Omit<FlexProduct, 'id'>): Promise<FlexProduct>;
  getFlexProductCosting(flexProductId: number): Promise<FlexProductCosting | undefined>;
  getAllFlexProductCostings(): Promise<FlexProductCosting[]>;
  upsertFlexProductCosting(data: Omit<FlexProductCosting, 'id'>): Promise<FlexProductCosting>;
  deleteFlexProductCosting(flexProductId: number): Promise<void>;

  // Settings
  getSettings(): Promise<Setting[]>;
  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;

  // Invoices
  getInvoices(): Promise<Invoice[]>;
  getInvoice(id: number): Promise<Invoice | undefined>;
  createInvoice(data: InsertInvoice): Promise<Invoice>;
  deleteInvoice(id: number): Promise<void>;

  // Xero Imports
  getXeroImports(): Promise<XeroImport[]>;
  getXeroImport(id: number): Promise<XeroImport | undefined>;
  getXeroPendingCount(): Promise<number>;
  upsertXeroImport(data: Omit<XeroImport, 'id'>): Promise<XeroImport>;
  resolveXeroImport(id: number, resolution: {
    status: 'matched' | 'added' | 'ignored';
    ingredientId?: number;
    costPerUnit?: number;
    quantity?: number;
    unit?: string;
    notes?: string;
  }): Promise<XeroImport | undefined>;
  updateXeroImportStatus(id: number): Promise<void>;
  patchXeroImportSupplier(id: number, supplierId: number | null, supplierName: string | null): Promise<XeroImport | undefined>;

  // Invoice Memory
  learnSupplierMapping(detectedName: string, supplierId: number): Promise<void>;
  learnLineItemMapping(description: string, ingredientId: number): Promise<void>;
  suggestSupplierForName(detectedName: string): Promise<number | null>;
  suggestIngredientForLine(description: string): Promise<number | null>;
  getLineItemSuggestions(): Promise<InvoiceMemory[]>;

  // Xero Line Items
  getXeroLineItems(xeroImportId: number): Promise<XeroLineItem[]>;
  getXeroLineItem(id: number): Promise<XeroLineItem | undefined>;
  createXeroLineItem(data: InsertXeroLineItem): Promise<XeroLineItem>;
  updateXeroLineItem(id: number, data: Partial<InsertXeroLineItem>): Promise<XeroLineItem | undefined>;
  deleteXeroLineItem(id: number): Promise<void>;
  resolveXeroLineItem(id: number, resolution: {
    status: 'matched' | 'added' | 'ignored';
    ingredientId?: number;
    ingredientName?: string;
    costPerUnit?: number;
    quantity?: number;
    unit?: string;
    lineTotal?: number;
    notes?: string;
  }): Promise<XeroLineItem | undefined>;
}

export const storage: IStorage = {
  // ── Suppliers ──────────────────────────────────────────────────────────────
  getSuppliers: async () => {
    const { data, error } = await supabase.from("suppliers").select("*").order("name");
    if (error) throw error;
    return toCamel(data) as Supplier[];
  },
  getSupplier: async (id) => {
    const { data, error } = await supabase.from("suppliers").select("*").eq("id", id).single();
    if (error) return undefined;
    return toCamel(data) as Supplier;
  },
  createSupplier: async (data) => {
    const { data: row, error } = await supabase.from("suppliers").insert(toSnake(data)).select().single();
    if (error) throw error;
    return toCamel(row) as Supplier;
  },
  updateSupplier: async (id, data) => {
    const { data: row, error } = await supabase.from("suppliers").update(toSnake(data)).eq("id", id).select().single();
    if (error) return undefined;
    return toCamel(row) as Supplier;
  },
  deleteSupplier: async (id) => {
    await supabase.from("suppliers").delete().eq("id", id);
  },

  // ── Ingredients ────────────────────────────────────────────────────────────
  getIngredients: async () => {
    const { data, error } = await supabase.from("ingredients").select("*").order("name");
    if (error) throw error;
    return toCamel(data) as Ingredient[];
  },
  getIngredient: async (id) => {
    const { data, error } = await supabase.from("ingredients").select("*").eq("id", id).single();
    if (error) return undefined;
    return toCamel(data) as Ingredient;
  },
  createIngredient: async (data) => {
    const { data: row, error } = await supabase.from("ingredients").insert(toSnake(data)).select().single();
    if (error) throw error;
    return toCamel(row) as Ingredient;
  },
  updateIngredient: async (id, data) => {
    const { data: row, error } = await supabase.from("ingredients").update(toSnake(data)).eq("id", id).select().single();
    if (error) return undefined;
    return toCamel(row) as Ingredient;
  },
  deleteIngredient: async (id) => {
    await supabase.from("ingredients").delete().eq("id", id);
  },
  refreshIngredientBestPrice: async (ingredientId) => {
    const { data: prices } = await supabase.from("supplier_ingredients").select("*").eq("ingredient_id", ingredientId);
    if (!prices || prices.length === 0) return;
    const best = prices.reduce((a: any, b: any) => a.cost_per_unit < b.cost_per_unit ? a : b);
    await supabase.from("ingredients").update({
      best_cost_per_unit: best.cost_per_unit,
      best_supplier_id: best.supplier_id,
    }).eq("id", ingredientId);
  },

  // ── Supplier Ingredients ───────────────────────────────────────────────────
  getSupplierIngredients: async (ingredientId, supplierId) => {
    let query = supabase.from("supplier_ingredients").select("*");
    if (ingredientId !== undefined) query = query.eq("ingredient_id", ingredientId);
    if (supplierId !== undefined) query = query.eq("supplier_id", supplierId);
    const { data, error } = await query;
    if (error) throw error;
    return toCamel(data) as SupplierIngredient[];
  },
  createSupplierIngredient: async (data) => {
    const { data: row, error } = await supabase.from("supplier_ingredients").insert(toSnake(data)).select().single();
    if (error) throw error;
    const result = toCamel(row) as SupplierIngredient;
    await storage.refreshIngredientBestPrice(data.ingredientId);
    return result;
  },
  updateSupplierIngredient: async (id, data) => {
    const { data: row, error } = await supabase.from("supplier_ingredients").update(toSnake(data)).eq("id", id).select().single();
    if (error) return undefined;
    const result = toCamel(row) as SupplierIngredient;
    await storage.refreshIngredientBestPrice(result.ingredientId);
    return result;
  },
  deleteSupplierIngredient: async (id) => {
    const { data: row } = await supabase.from("supplier_ingredients").select("ingredient_id").eq("id", id).single();
    await supabase.from("supplier_ingredients").delete().eq("id", id);
    if (row) await storage.refreshIngredientBestPrice(row.ingredient_id);
  },

  // ── Sub-Recipes ────────────────────────────────────────────────────────────
  getSubRecipes: async () => {
    const { data, error } = await supabase.from("sub_recipes").select("*").order("name");
    if (error) throw error;
    return toCamel(data) as SubRecipe[];
  },
  getSubRecipe: async (id) => {
    const { data, error } = await supabase.from("sub_recipes").select("*").eq("id", id).single();
    if (error) return undefined;
    return toCamel(data) as SubRecipe;
  },
  createSubRecipe: async (data) => {
    const { data: row, error } = await supabase.from("sub_recipes").insert(toSnake(data)).select().single();
    if (error) throw error;
    return toCamel(row) as SubRecipe;
  },
  updateSubRecipe: async (id, data) => {
    const { data: row, error } = await supabase.from("sub_recipes").update(toSnake(data)).eq("id", id).select().single();
    if (error) return undefined;
    return toCamel(row) as SubRecipe;
  },
  deleteSubRecipe: async (id) => {
    await supabase.from("sub_recipes").delete().eq("id", id);
  },

  // ── Recipes ────────────────────────────────────────────────────────────────
  getRecipes: async () => {
    const { data, error } = await supabase.from("recipes").select("*").order("name");
    if (error) throw error;
    return toCamel(data) as Recipe[];
  },
  getRecipe: async (id) => {
    const { data, error } = await supabase.from("recipes").select("*").eq("id", id).single();
    if (error) return undefined;
    return toCamel(data) as Recipe;
  },
  createRecipe: async (data) => {
    const { data: row, error } = await supabase.from("recipes").insert(toSnake(data)).select().single();
    if (error) throw error;
    return toCamel(row) as Recipe;
  },
  updateRecipe: async (id, data) => {
    const { data: row, error } = await supabase.from("recipes").update(toSnake(data)).eq("id", id).select().single();
    if (error) return undefined;
    return toCamel(row) as Recipe;
  },
  deleteRecipe: async (id) => {
    await supabase.from("recipes").delete().eq("id", id);
  },

  // ── Platters ───────────────────────────────────────────────────────────────
  getPlatters: async () => {
    const { data, error } = await supabase.from("platters").select("*").order("name");
    if (error) throw error;
    return toCamel(data) as Platter[];
  },
  getPlatter: async (id) => {
    const { data, error } = await supabase.from("platters").select("*").eq("id", id).single();
    if (error) return undefined;
    return toCamel(data) as Platter;
  },
  createPlatter: async (data) => {
    const { data: row, error } = await supabase.from("platters").insert(toSnake(data)).select().single();
    if (error) throw error;
    return toCamel(row) as Platter;
  },
  updatePlatter: async (id, data) => {
    const { data: row, error } = await supabase.from("platters").update(toSnake(data)).eq("id", id).select().single();
    if (error) return undefined;
    return toCamel(row) as Platter;
  },
  deletePlatter: async (id) => {
    await supabase.from("platters").delete().eq("id", id);
  },

  // ── Flex Products ──────────────────────────────────────────────────────────
  getFlexProducts: async () => {
    const { data, error } = await supabase.from("flex_products").select("*").order("name");
    if (error) throw error;
    return toCamel(data) as FlexProduct[];
  },
  getFlexProduct: async (id) => {
    const { data, error } = await supabase.from("flex_products").select("*").eq("id", id).single();
    if (error) return undefined;
    return toCamel(data) as FlexProduct;
  },
  upsertFlexProduct: async (data) => {
    const snakeData = toSnake(data);
    const { data: row, error } = await supabase
      .from("flex_products")
      .upsert(snakeData, { onConflict: "flex_uuid" })
      .select()
      .single();
    if (error) throw error;
    return toCamel(row) as FlexProduct;
  },
  getFlexProductCosting: async (flexProductId) => {
    const { data, error } = await supabase.from("flex_product_costings").select("*").eq("flex_product_id", flexProductId).single();
    if (error) return undefined;
    return toCamel(data) as FlexProductCosting;
  },
  getAllFlexProductCostings: async () => {
    const { data, error } = await supabase.from("flex_product_costings").select("*");
    if (error) throw error;
    return toCamel(data) as FlexProductCosting[];
  },
  upsertFlexProductCosting: async (data) => {
    const snakeData = toSnake(data);
    const { data: row, error } = await supabase
      .from("flex_product_costings")
      .upsert(snakeData, { onConflict: "flex_product_id" })
      .select()
      .single();
    if (error) throw error;
    return toCamel(row) as FlexProductCosting;
  },
  deleteFlexProductCosting: async (flexProductId) => {
    await supabase.from("flex_product_costings").delete().eq("flex_product_id", flexProductId);
  },

  // ── Settings ───────────────────────────────────────────────────────────────
  getSettings: async () => {
    const { data, error } = await supabase.from("settings").select("*").order("key");
    if (error) throw error;
    return toCamel(data) as Setting[];
  },
  getSetting: async (key) => {
    const { data } = await supabase.from("settings").select("value").eq("key", key).single();
    return data?.value ?? undefined;
  },
  setSetting: async (key, value) => {
    await supabase.from("settings").upsert({ key, value }, { onConflict: "key" });
  },

  // ── Invoices ───────────────────────────────────────────────────────────────
  getInvoices: async () => {
    const { data, error } = await supabase.from("invoices").select("*").order("uploaded_at", { ascending: false });
    if (error) throw error;
    return toCamel(data) as Invoice[];
  },
  getInvoice: async (id) => {
    const { data, error } = await supabase.from("invoices").select("*").eq("id", id).single();
    if (error) return undefined;
    return toCamel(data) as Invoice;
  },
  createInvoice: async (data) => {
    const { data: row, error } = await supabase.from("invoices").insert(toSnake(data)).select().single();
    if (error) throw error;
    return toCamel(row) as Invoice;
  },
  deleteInvoice: async (id) => {
    await supabase.from("invoices").delete().eq("id", id);
  },

  // ── Xero Imports ──────────────────────────────────────────────────────────
  getXeroImports: async () => {
    const { data, error } = await supabase.from("xero_imports").select("*").order("synced_at", { ascending: false });
    if (error) throw error;
    return toCamel(data) as XeroImport[];
  },
  getXeroImport: async (id) => {
    const { data, error } = await supabase.from("xero_imports").select("*").eq("id", id).single();
    if (error) return undefined;
    return toCamel(data) as XeroImport;
  },
  getXeroPendingCount: async () => {
    const { count } = await supabase.from("xero_imports").select("*", { count: "exact", head: true }).eq("status", "pending");
    return count ?? 0;
  },
  upsertXeroImport: async (data) => {
    const snakeData = toSnake(data);
    // Check if exists first
    const { data: existing } = await supabase.from("xero_imports").select("id").eq("xero_invoice_id", snakeData.xero_invoice_id).single();
    if (existing) {
      const { data: row, error } = await supabase.from("xero_imports")
        .update({
          synced_at: snakeData.synced_at,
          line_description: snakeData.line_description,
          supplier_name: snakeData.supplier_name,
          total_amount: snakeData.total_amount,
        })
        .eq("xero_invoice_id", snakeData.xero_invoice_id)
        .select().single();
      if (error) throw error;
      return toCamel(row) as XeroImport;
    }
    const { data: row, error } = await supabase.from("xero_imports").insert(snakeData).select().single();
    if (error) throw error;
    return toCamel(row) as XeroImport;
  },
  resolveXeroImport: async (id, resolution) => {
    const { data: row, error } = await supabase.from("xero_imports")
      .update({ ...toSnake(resolution), resolved_at: new Date().toISOString() })
      .eq("id", id).select().single();
    if (error) return undefined;
    return toCamel(row) as XeroImport;
  },
  updateXeroImportStatus: async (id) => {
    const { data: lines } = await supabase.from("xero_line_items").select("status").eq("xero_import_id", id);
    if (!lines || lines.length === 0) return;
    const allIgnored = lines.every((l: any) => l.status === 'ignored');
    const allResolved = lines.every((l: any) => l.status !== 'pending');
    const newStatus = allIgnored ? 'ignored' : allResolved ? 'matched' : 'pending';
    await supabase.from("xero_imports")
      .update({ status: newStatus, resolved_at: allResolved ? new Date().toISOString() : null })
      .eq("id", id);
  },
  patchXeroImportSupplier: async (id, supplierId, supplierName) => {
    const { data: row, error } = await supabase.from("xero_imports")
      .update({ supplier_id: supplierId, supplier_name: supplierName })
      .eq("id", id).select().single();
    if (error) return undefined;
    return toCamel(row) as XeroImport;
  },

  // ── Invoice Memory ─────────────────────────────────────────────────────────
  learnSupplierMapping: async (detectedName, supplierId) => {
    const norm = detectedName.toLowerCase().trim();
    const { data: existing } = await supabase.from("invoice_memory")
      .select("id, use_count")
      .eq("detected_supplier_name", norm)
      .eq("supplier_id", supplierId)
      .is("line_item_description", null)
      .single();
    if (existing) {
      await supabase.from("invoice_memory").update({
        use_count: (existing as any).use_count + 1,
        learned_at: new Date().toISOString(),
      }).eq("id", (existing as any).id);
    } else {
      await supabase.from("invoice_memory").insert({
        detected_supplier_name: norm,
        supplier_id: supplierId,
        learned_at: new Date().toISOString(),
        use_count: 1,
      });
    }
  },
  learnLineItemMapping: async (description, ingredientId) => {
    const norm = description.toLowerCase().trim();
    const { data: existing } = await supabase.from("invoice_memory")
      .select("id, use_count")
      .eq("line_item_description", norm)
      .eq("ingredient_id", ingredientId)
      .is("detected_supplier_name", null)
      .single();
    if (existing) {
      await supabase.from("invoice_memory").update({
        use_count: (existing as any).use_count + 1,
        learned_at: new Date().toISOString(),
      }).eq("id", (existing as any).id);
    } else {
      await supabase.from("invoice_memory").insert({
        line_item_description: norm,
        ingredient_id: ingredientId,
        learned_at: new Date().toISOString(),
        use_count: 1,
      });
    }
  },
  suggestSupplierForName: async (detectedName) => {
    const norm = detectedName.toLowerCase().trim();
    const { data } = await supabase.from("invoice_memory")
      .select("supplier_id")
      .eq("detected_supplier_name", norm)
      .not("supplier_id", "is", null)
      .order("use_count", { ascending: false })
      .limit(1)
      .single();
    return (data as any)?.supplier_id ?? null;
  },
  suggestIngredientForLine: async (description) => {
    const norm = description.toLowerCase().trim();
    const { data: exact } = await supabase.from("invoice_memory")
      .select("ingredient_id")
      .eq("line_item_description", norm)
      .not("ingredient_id", "is", null)
      .order("use_count", { ascending: false })
      .limit(1)
      .single();
    if (exact) return (exact as any).ingredient_id;
    // Partial match: fetch all and check
    const { data: rows } = await supabase.from("invoice_memory")
      .select("line_item_description, ingredient_id, use_count")
      .not("ingredient_id", "is", null)
      .order("use_count", { ascending: false });
    if (rows) {
      for (const r of rows as any[]) {
        if (norm.includes(r.line_item_description) || r.line_item_description.includes(norm)) {
          return r.ingredient_id;
        }
      }
    }
    return null;
  },
  getLineItemSuggestions: async () => {
    const { data, error } = await supabase.from("invoice_memory")
      .select("*")
      .not("ingredient_id", "is", null)
      .order("use_count", { ascending: false });
    if (error) return [];
    return toCamel(data) as InvoiceMemory[];
  },

  // ── Xero Line Items ───────────────────────────────────────────────────────
  getXeroLineItems: async (xeroImportId) => {
    const { data, error } = await supabase.from("xero_line_items").select("*").eq("xero_import_id", xeroImportId);
    if (error) return [];
    return toCamel(data) as XeroLineItem[];
  },
  getXeroLineItem: async (id) => {
    const { data, error } = await supabase.from("xero_line_items").select("*").eq("id", id).single();
    if (error) return undefined;
    return toCamel(data) as XeroLineItem;
  },
  createXeroLineItem: async (data) => {
    const { data: row, error } = await supabase.from("xero_line_items").insert(toSnake(data)).select().single();
    if (error) throw error;
    return toCamel(row) as XeroLineItem;
  },
  updateXeroLineItem: async (id, data) => {
    const { data: row, error } = await supabase.from("xero_line_items").update(toSnake(data)).eq("id", id).select().single();
    if (error) return undefined;
    return toCamel(row) as XeroLineItem;
  },
  deleteXeroLineItem: async (id) => {
    await supabase.from("xero_line_items").delete().eq("id", id);
  },
  resolveXeroLineItem: async (id, resolution) => {
    const { data: row, error } = await supabase.from("xero_line_items")
      .update({ ...toSnake(resolution), resolved_at: new Date().toISOString() })
      .eq("id", id).select().single();
    if (error) return undefined;
    return toCamel(row) as XeroLineItem;
  },
};

// Export supabase client for direct use in routes.ts (for raw SQL-style queries)
export { supabase };
