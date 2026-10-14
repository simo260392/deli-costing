-- Supplier invoices v2 (Oct 2026)
-- Additive only: existing tables (invoices, xero_imports, xero_line_items,
-- supplier_ingredients, invoice_memory) are left untouched and retired later.
--
-- Model:
--   ingredient          generic thing recipes use ("Plain flour", unit kg/L/each)
--   supplier_product    one supplier's specific item: their code, their name,
--                       brand, pack structure, latest price
--   supplier_invoice    one invoice/receipt (from Xero or uploaded)
--   supplier_invoice_line  one line on it, matched to a supplier_product
--   supplier_price_history every approved price, for trends and jump alerts

-- Suppliers: identifiers used to recognise an invoice's supplier
alter table suppliers add column if not exists abn text;
alter table suppliers add column if not exists our_account_number text;   -- their customer number for us (e.g. Bidfood 445400, Il Granino 2375)
alter table suppliers add column if not exists name_aliases text[] default '{}';  -- other names on invoices ("BIDFOOD MALAGA", "Campbells Balcatta")
alter table suppliers add column if not exists prices_include_gst boolean default false; -- Costco/Spud Shed receipts show GST-inclusive prices
alter table suppliers add column if not exists xero_contact_id text;

create table if not exists supplier_products (
  id                    bigserial primary key,
  supplier_id           integer not null references suppliers(id),
  ingredient_id         integer references ingredients(id),
  item_type             text not null default 'ingredient'
                        check (item_type in ('ingredient','packaging','cleaning','other')),
  supplier_code         text,          -- product code on the invoice (null for Spud Shed etc.)
  supplier_description  text not null, -- exactly as the supplier writes it
  brand                 text,
  -- Pack structure. Example "6 x 2L carton": purchase_unit='CTN', units_per_purchase=6, unit_size=2, unit_size_uom='L'
  purchase_unit         text,          -- how it is invoiced: CTN, BKT, BAG, EA, KG, PKT...
  units_per_purchase    numeric default 1,
  unit_size             numeric,       -- size of one inner unit (2 for 2L); null for priced-by-weight
  unit_size_uom         text check (unit_size_uom in ('kg','L','each')),
  priced_by_weight      boolean not null default false, -- invoiced per kg (meat, cheese, produce)
  -- Base quantity per purchase in the ingredient's unit. Derived from the pack
  -- structure; can be set by hand when the invoice doesn't say (Spud Shed bacon = 1kg).
  base_qty_per_purchase numeric,
  pack_size_confirmed   boolean not null default false, -- true once Scott has confirmed the pack size
  gst_applicable        boolean,
  last_price_ex_gst     numeric,       -- per purchase unit (or per kg when priced_by_weight)
  last_unit_cost        numeric,       -- per ingredient unit (kg / L / each), ex GST, after discounts
  last_invoice_id       bigint,
  last_invoice_date     date,
  is_preferred          boolean not null default false, -- the one drivers buy / stock sheets show
  active                boolean not null default true,
  legacy_supplier_ingredient_id integer, -- link back to supplier_ingredients during migration
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists supplier_products_code_uq
  on supplier_products (supplier_id, lower(supplier_code)) where supplier_code is not null and supplier_code <> '';
create index if not exists supplier_products_desc_idx on supplier_products (supplier_id, lower(supplier_description));
create index if not exists supplier_products_ingredient_idx on supplier_products (ingredient_id);
-- At most one preferred product per ingredient
create unique index if not exists supplier_products_one_preferred
  on supplier_products (ingredient_id) where is_preferred and ingredient_id is not null;

create table if not exists supplier_invoices (
  id                 bigserial primary key,
  source             text not null check (source in ('xero','upload')),
  xero_invoice_id    text unique,
  supplier_id        integer references suppliers(id),
  detected_supplier_name text,
  detected_abn       text,
  document_type      text default 'invoice' check (document_type in ('invoice','receipt','credit_note','order_confirmation','statement','other')),
  invoice_number     text,
  invoice_date       date,
  subtotal_ex_gst    numeric,
  gst                numeric,
  total_inc_gst      numeric,
  file_path          text,          -- stored PDF/photo
  file_name          text,
  status             text not null default 'new'
                     check (status in ('new','reading','needs_review','approved','ignored','failed','duplicate')),
  status_note        text,
  extraction_json    jsonb,         -- raw output of the reader, kept for debugging
  totals_check_ok    boolean,       -- do the lines add up to the invoice total?
  approved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists supplier_invoices_number_uq
  on supplier_invoices (supplier_id, lower(invoice_number)) where supplier_id is not null and invoice_number is not null;

create table if not exists supplier_invoice_lines (
  id                  bigserial primary key,
  invoice_id          bigint not null references supplier_invoices(id) on delete cascade,
  line_no             integer,
  line_type           text not null default 'product'
                      check (line_type in ('product','freight','fee','deposit','discount','credit','personal','ignore')),
  supplier_code       text,
  description         text,
  brand               text,
  quantity            numeric,       -- number of purchase units (or kg when priced by weight)
  purchase_unit       text,
  units_per_purchase  numeric,
  unit_size           numeric,
  unit_size_uom       text,
  priced_by_weight    boolean default false,
  unit_price_ex_gst   numeric,       -- per purchase unit / per kg, after any line discount
  discount_ex_gst     numeric default 0,
  line_total_ex_gst   numeric,
  gst_amount          numeric,
  base_qty            numeric,       -- total quantity in ingredient units (kg/L/each)
  unit_cost           numeric,       -- line_total_ex_gst / base_qty
  supplier_product_id bigint references supplier_products(id),
  ingredient_id       integer references ingredients(id),
  match_method        text check (match_method in ('code','description','suggested','manual','new')),
  match_confidence    numeric,
  price_change_pct    numeric,       -- vs previous price of the same supplier product
  status              text not null default 'pending' check (status in ('pending','approved','skipped')),
  notes               text,
  created_at          timestamptz not null default now()
);
create index if not exists supplier_invoice_lines_invoice_idx on supplier_invoice_lines (invoice_id);

create table if not exists supplier_price_history (
  id                  bigserial primary key,
  supplier_product_id bigint not null references supplier_products(id) on delete cascade,
  invoice_id          bigint references supplier_invoices(id) on delete set null,
  invoice_line_id     bigint references supplier_invoice_lines(id) on delete set null,
  invoice_date        date,
  quantity            numeric,
  price_ex_gst        numeric,       -- per purchase unit / per kg
  unit_cost           numeric,       -- per ingredient unit, ex GST
  created_at          timestamptz not null default now()
);
create index if not exists supplier_price_history_product_idx on supplier_price_history (supplier_product_id, invoice_date desc);
