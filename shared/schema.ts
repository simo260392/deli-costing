import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Suppliers ────────────────────────────────────────────────────────────────
export const suppliers = sqliteTable("suppliers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
});

export const insertSupplierSchema = createInsertSchema(suppliers).omit({ id: true });
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliers.$inferSelect;

// ─── Ingredients ──────────────────────────────────────────────────────────────
// Stores the cheapest / most recent cost per ingredient from any supplier.
// Per-supplier pricing lives in supplierIngredients.
export const ingredients = sqliteTable("ingredients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull().default("General"), // e.g. Protein, Dairy, Produce
  unit: text("unit").notNull(), // kg, g, L, ml, each, pack
  // Cheapest cost per unit (computed from supplierIngredients)
  bestCostPerUnit: real("best_cost_per_unit").notNull().default(0),
  bestSupplierId: integer("best_supplier_id"),
  avgWeightPerUnit: real("avg_weight_per_unit"),
  notes: text("notes"),
  dietariesJson: text("dietaries_json").default("[]"), // string[] of allergen keys
  pealLabel: text("peal_label").default(""), // PEAL ingredient description e.g. "Cheddar cheese (Milk)"
  // Nutrition per 100g/100ml (FSANZ mandatory 7): energy(kJ), protein(g), fatTotal(g), fatSat(g), carbs(g), sugars(g), sodium(mg)
  nutritionJson: text("nutrition_json").default(""), // JSON: {energy,protein,fatTotal,fatSat,carbs,sugars,sodium} or null
  barcode: text("barcode").default(""),          // EAN/UPC barcode
  shelfLife: text("shelf_life").default(""),       // e.g. "7 days", "3 months"
  storageTemp: text("storage_temp").default(""),   // e.g. "Refrigerated 0–4°C", "Frozen", "Ambient"
  categoriesJson: text("categories_json").default("[]"), // string[] of ingredient sub-categories
});

export const insertIngredientSchema = createInsertSchema(ingredients).omit({ id: true });
export type InsertIngredient = z.infer<typeof insertIngredientSchema>;
export type Ingredient = typeof ingredients.$inferSelect;

// ─── Supplier Ingredient Pricing ──────────────────────────────────────────────
export const supplierIngredients = sqliteTable("supplier_ingredients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  supplierId: integer("supplier_id").notNull(),
  ingredientId: integer("ingredient_id").notNull(),
  costPerUnit: real("cost_per_unit").notNull(), // cost per the ingredient's unit
  packSize: real("pack_size"), // e.g. 5 (kg), 12 (each) — the invoice pack size
  packCost: real("pack_cost"), // invoice line total for pack
  invoiceDate: text("invoice_date"), // ISO date string
  invoiceRef: text("invoice_ref"), // invoice number
  notes: text("notes"),
});

export const insertSupplierIngredientSchema = createInsertSchema(supplierIngredients).omit({ id: true });
export type InsertSupplierIngredient = z.infer<typeof insertSupplierIngredientSchema>;
export type SupplierIngredient = typeof supplierIngredients.$inferSelect;

// ─── Sub-Recipes ──────────────────────────────────────────────────────────────
// A sub-recipe produces a certain yield and can be used in recipes/platters.
export const subRecipes = sqliteTable("sub_recipes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull().default("General"),
  description: text("description"),
  yieldAmount: real("yield_amount").notNull().default(1), // how much it produces
  yieldUnit: text("yield_unit").notNull().default("each"), // unit of yield
  // ingredients stored as JSON: [{ingredientId, quantity}]
  ingredientsJson: text("ingredients_json").notNull().default("[]"),
  // nested sub-recipes stored as JSON: [{subRecipeId, quantity}]
  subRecipesJson: text("sub_recipes_json").notNull().default("[]"),
  // computed total ingredient cost
  totalCost: real("total_cost").notNull().default(0),
  costPerUnit: real("cost_per_unit").notNull().default(0), // totalCost / yieldAmount
  photoUrl: text("photo_url"),  // uploaded dish photo path
  // Computed rolled-up nutrition per yield unit (same keys as ingredient nutritionJson)
  nutritionJson: text("nutrition_json").default(""),
});

export const insertSubRecipeSchema = createInsertSchema(subRecipes).omit({ id: true });
export type InsertSubRecipe = z.infer<typeof insertSubRecipeSchema>;
export type SubRecipe = typeof subRecipes.$inferSelect;

// ─── Recipes (Menu Items) ─────────────────────────────────────────────────────
export const recipes = sqliteTable("recipes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull().default("Main"), // Sandwich, Wrap, Salad, etc.
  description: text("description"),
  portionSize: text("portion_size"), // e.g. "200g", "1 each"
  // Ingredients: [{ingredientId, quantity, unit}]
  ingredientsJson: text("ingredients_json").notNull().default("[]"),
  // Sub-recipes used: [{subRecipeId, quantity, unit}]
  subRecipesJson: text("sub_recipes_json").notNull().default("[]"),
  // Other full recipes used as components: [{recipeId, quantity}]
  recipesJson: text("recipes_json").notNull().default("[]"),
  // Packaging: [{ingredientId, quantity}] — packaging items are also ingredients
  packagingJson: text("packaging_json").notNull().default("[]"),
  // Costs (computed)
  ingredientCost: real("ingredient_cost").notNull().default(0),
  subRecipeCost: real("sub_recipe_cost").notNull().default(0),
  packagingCost: real("packaging_cost").notNull().default(0),
  labourMinutes: real("labour_minutes").notNull().default(0), // time to make (minutes)
  labourCost: real("labour_cost").notNull().default(0),        // computed: (minutes/60) × hourly rate
  totalCost: real("total_cost").notNull().default(0),          // total batch cost
  portionCount: real("portion_count").notNull().default(1),    // number of serves per batch
  costPerServe: real("cost_per_serve").notNull().default(0),   // totalCost / portionCount
  foodCostPerServe: real("food_cost_per_serve").notNull().default(0), // ingredients+subs+packaging only (no labour) / portionCount
  photoUrl: text("photo_url"),  // uploaded dish photo path
  // Computed rolled-up nutrition per serve (same keys as ingredient nutritionJson)
  nutritionJson: text("nutrition_json").default(""),
  // Serving info for nutrition panel
  servingSize: text("serving_size").default(""),     // e.g. "50g" or "200ml"
  servingsPerPackage: real("servings_per_package"),  // e.g. 4
  // Pricing (all per-serve)
  rrp: real("rrp"), // user-set actual selling price per serve
  wholesaleRrp: real("wholesale_rrp"), // user-set wholesale selling price per serve
  targetRrp: real("target_rrp").notNull().default(0), // computed from markup % on costPerServe
  wholesaleTargetRrp: real("wholesale_target_rrp").notNull().default(0), // computed from 45% wholesale markup
  marginPercent: real("margin_percent").notNull().default(0),
  wholesaleMarginPercent: real("wholesale_margin_percent").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const insertRecipeSchema = createInsertSchema(recipes).omit({ id: true });
export type InsertRecipe = z.infer<typeof insertRecipeSchema>;
export type Recipe = typeof recipes.$inferSelect;

// ─── Platters ─────────────────────────────────────────────────────────────────
export const platters = sqliteTable("platters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull().default("Platter"),
  description: text("description"),
  servings: integer("servings"),
  // Items: [{type: 'recipe'|'ingredient', id, quantity}]
  itemsJson: text("items_json").notNull().default("[]"),
  // Packaging: [{ingredientId, quantity}]
  packagingJson: text("packaging_json").notNull().default("[]"),
  // Costs
  itemsCost: real("items_cost").notNull().default(0),
  packagingCost: real("packaging_cost").notNull().default(0),
  labourCost: real("labour_cost").notNull().default(0),
  totalCost: real("total_cost").notNull().default(0),
  photoUrl: text("photo_url"),  // uploaded dish photo path
  // Computed rolled-up nutrition per serve
  nutritionJson: text("nutrition_json").default(""),
  // Serving info for nutrition panel
  servingSize: text("serving_size").default(""),
  servingsPerPackage: real("servings_per_package"),
  // Pricing
  rrp: real("rrp"),
  wholesaleRrp: real("wholesale_rrp"),
  targetRrp: real("target_rrp").notNull().default(0),
  wholesaleTargetRrp: real("wholesale_target_rrp").notNull().default(0),
  marginPercent: real("margin_percent").notNull().default(0),
  wholesaleMarginPercent: real("wholesale_margin_percent").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const insertPlatterSchema = createInsertSchema(platters).omit({ id: true });
export type InsertPlatter = z.infer<typeof insertPlatterSchema>;
export type Platter = typeof platters.$inferSelect;

// ─── App Settings ─────────────────────────────────────────────────────────────
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

export const insertSettingSchema = createInsertSchema(settings).omit({ id: true });
export type InsertSetting = z.infer<typeof insertSettingSchema>;
export type Setting = typeof settings.$inferSelect;

// ─── Invoice Uploads ──────────────────────────────────────────────────────────
export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  supplierId: integer("supplier_id"),
  filename: text("filename").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  invoiceDate: text("invoice_date"),
  invoiceRef: text("invoice_ref"),
  // Parsed line items as JSON: [{description, quantity, unit, unitCost, totalCost}]
  lineItemsJson: text("line_items_json").notNull().default("[]"),
  notes: text("notes"),
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// ─── Xero Imports ─────────────────────────────────────────────────────────────
// Each row = one Xero purchase bill pulled from the API.
// status: 'pending' | 'matched' | 'added' | 'ignored'
export const xeroImports = sqliteTable("xero_imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  xeroInvoiceId: text("xero_invoice_id").notNull().unique(),
  xeroInvoiceNumber: text("xero_invoice_number"),
  supplierName: text("supplier_name"),
  supplierId: integer("supplier_id"),
  invoiceDate: text("invoice_date"),
  totalAmount: real("total_amount"),
  currency: text("currency").default("AUD"),
  lineDescription: text("line_description"),
  hubdocUrl: text("hubdoc_url"),
  source: text("source").notNull().default("xero"), // 'xero' | 'drive'
  driveFileId: text("drive_file_id"),
  driveFileUrl: text("drive_file_url"),
  // Resolution
  status: text("status").notNull().default("pending"), // pending | matched | added | ignored
  ingredientId: integer("ingredient_id"),   // set when matched to existing ingredient
  costPerUnit: real("cost_per_unit"),        // user-entered cost per unit
  quantity: real("quantity"),                // user-entered qty / pack size
  unit: text("unit"),                        // unit for the cost
  notes: text("notes"),
  syncedAt: text("synced_at").notNull(),
  resolvedAt: text("resolved_at"),
});

export type XeroImport = typeof xeroImports.$inferSelect;

// ─── Xero Line Items ──────────────────────────────────────────────────────────
// One row per line item inside a Xero import (user-entered breakdown of invoice)
// status: 'pending' | 'matched' | 'added' | 'ignored'
export const xeroLineItems = sqliteTable("xero_line_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  xeroImportId: integer("xero_import_id").notNull(), // FK → xero_imports.id
  // Description from user (what is this line item?)
  description: text("description"),
  // Resolution
  status: text("status").notNull().default("pending"), // pending | matched | added | ignored
  ingredientId: integer("ingredient_id"),   // set when matched
  ingredientName: text("ingredient_name"),  // cached for display
  costPerUnit: real("cost_per_unit"),
  quantity: real("quantity"),
  unit: text("unit"),
  lineTotal: real("line_total"),             // costPerUnit * quantity (informational)
  // Carton/pack breakdown (for wholesale invoices like Bidfood, Campbells)
  cartonsSupplied: real("cartons_supplied"),  // number of cartons ordered
  packsPerCarton: real("packs_per_carton"),   // packs inside each carton
  packSize: real("pack_size"),               // size of each pack (e.g. 12, 1, 2.5)
  packUnit: text("pack_unit"),               // unit of pack size (each, kg, L, etc.)
  notes: text("notes"),
  brandName: text("brand_name").default(""),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
});

export const insertXeroLineItemSchema = createInsertSchema(xeroLineItems).omit({ id: true });
export type InsertXeroLineItem = z.infer<typeof insertXeroLineItemSchema>;
export type XeroLineItem = typeof xeroLineItems.$inferSelect;

// ─── Invoice Learning / Pattern Memory ────────────────────────────────────────────────────────
// Remembers: invoice detected name → supplier, and line item description → ingredient.
// Used to auto-suggest matches on future uploads.
export const invoiceMemory = sqliteTable("invoice_memory", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Supplier name memory: raw detected name → confirmed supplier id
  detectedSupplierName: text("detected_supplier_name"),  // what the PDF parser found
  supplierId: integer("supplier_id"),                    // confirmed supplier
  // Line item memory: raw description → ingredient
  lineItemDescription: text("line_item_description"),    // raw line item text from invoice
  ingredientId: integer("ingredient_id"),                // matched ingredient id
  // Metadata
  learnedAt: text("learned_at").notNull(),
  useCount: integer("use_count").notNull().default(1),
});
export type InvoiceMemory = typeof invoiceMemory.$inferSelect;

// ─── Flex Products ─────────────────────────────────────────────────────────────
// Synced from Flex Catering API. Read-only mirror of the Flex catalogue.
export const flexProducts = sqliteTable("flex_products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  flexUuid: text("flex_uuid").notNull().unique(),
  flexId: integer("flex_id"),
  name: text("name").notNull(),
  sku: text("sku").notNull().default(""),
  price: real("price").notNull().default(0),       // Flex selling price (inc GST)
  status: text("status").notNull().default("active"),
  type: text("type").notNull().default("simple"),
  categoriesJson: text("categories_json").notNull().default("[]"),   // [{uuid,name}]
  flexDietariesJson: text("flex_dietaries_json").notNull().default("[]"), // from Flex [{code,name}]
  flexAllergensJson: text("flex_allergens_json").notNull().default("[]"),  // derived from Flex dietaries
  imageUrl: text("image_url"),
  lastSyncedAt: text("last_synced_at").notNull(),
  barcodesJson: text("barcodes_json").notNull().default("[]"), // string[] of GTINs
});

export type FlexProduct = typeof flexProducts.$inferSelect;

// ─── Flex Product Costings ─────────────────────────────────────────────────────
// User-defined costing build for each Flex product.
// A product links to multiple recipes/sub-recipes (with quantities) + packaging.
export const flexProductCostings = sqliteTable("flex_product_costings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  flexProductId: integer("flex_product_id").notNull().unique(), // FK → flex_products.id
  // Components: [{type:'recipe'|'sub_recipe', id, quantity, name}]
  componentsJson: text("components_json").notNull().default("[]"),
  // Packaging: [{ingredientId, quantity, name, unit}]
  packagingJson: text("packaging_json").notNull().default("[]"),
  // Computed costs
  recipeCost: real("recipe_cost").notNull().default(0),
  packagingCost: real("packaging_cost").notNull().default(0),
  labourCost: real("labour_cost").notNull().default(0),
  totalCost: real("total_cost").notNull().default(0),
  // Margin
  flexPrice: real("flex_price").notNull().default(0),   // snapshot of Flex price at save time
  marginPercent: real("margin_percent").notNull().default(0),
  profitDollars: real("profit_dollars").notNull().default(0),
  // App-computed allergens & dietaries (rolled up from all linked recipes)
  computedAllergensJson: text("computed_allergens_json").notNull().default("[]"),
  computedDietariesJson: text("computed_dietaries_json").notNull().default("[]"),
  updatedAt: text("updated_at").notNull(),
});

export type FlexProductCosting = typeof flexProductCostings.$inferSelect;

// ─── Prep Sessions ─────────────────────────────────────────────────────────────
// One prep session = one day's prep list (can have multiple per day if needed)
export const prepSessions = sqliteTable("prep_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // ISO date e.g. "2026-04-27"
  notes: text("notes"),
  // Orders entered: [{type:'flex_product'|'recipe', id, name, quantity}]
  ordersJson: text("orders_json").notNull().default("[]"),
  status: text("status").notNull().default("active"), // active | completed
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
});

export const insertPrepSessionSchema = createInsertSchema(prepSessions).omit({ id: true });
export type InsertPrepSession = z.infer<typeof insertPrepSessionSchema>;
export type PrepSession = typeof prepSessions.$inferSelect;

// ─── Prep Tasks ─────────────────────────────────────────────────────────────────
// One task = one sub-recipe, recipe, or platter to be made in a prep session
export const prepTasks = sqliteTable("prep_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull(), // FK → prep_sessions.id
  // What needs to be made
  itemType: text("item_type").notNull(), // 'sub_recipe' | 'recipe' | 'platter'
  itemId: integer("item_id").notNull(),
  itemName: text("item_name").notNull(),
  // How many to make
  quantityRequired: real("quantity_required").notNull().default(1),
  quantityActual: real("quantity_actual"), // entered by staff on finish
  // Which orders this task is needed for (JSON array of order references)
  forOrdersJson: text("for_orders_json").notNull().default("[]"),
  // Time tracking
  assignedTo: integer("assigned_to"), // Deputy employee ID
  assignedName: text("assigned_name"), // cached name for display
  expectedMinutes: real("expected_minutes"), // from recipe labourMinutes × quantity
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  actualMinutes: real("actual_minutes"), // computed on finish
  // Status
  status: text("status").notNull().default("pending"), // pending | in_progress | done | skipped
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertPrepTaskSchema = createInsertSchema(prepTasks).omit({ id: true });
export type InsertPrepTask = z.infer<typeof insertPrepTaskSchema>;
export type PrepTask = typeof prepTasks.$inferSelect;
