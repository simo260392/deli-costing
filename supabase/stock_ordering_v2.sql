-- Stock ordering v2 (applied to production 13 Oct 2026)
alter table suppliers add column if not exists collection_method text not null default 'delivery'
  check (collection_method in ('delivery','driver'));

create table if not exists stock_supplier_orders (
  id bigserial primary key,
  supplier_id integer references suppliers(id) on delete set null,
  supplier_name text not null,
  sent_to text,
  subject text,
  body text,
  sent_by text,
  sent_via text not null default 'email',
  status text not null default 'sent' check (status in ('sent','received')),
  sent_at timestamptz not null default now(),
  received_at timestamptz,
  received_by text
);

create table if not exists stock_requests (
  id bigserial primary key,
  ingredient_id integer,
  item_name text not null,
  qty numeric not null default 1,
  unit text,
  supplier_id integer references suppliers(id) on delete set null,
  method text not null default 'delivery' check (method in ('delivery','driver')),
  notes text,
  status text not null default 'requested'
    check (status in ('requested','ordered','collected','unavailable','received','cancelled')),
  requested_by text,
  requested_at timestamptz not null default now(),
  supplier_order_id bigint references stock_supplier_orders(id) on delete set null,
  handled_by text,
  handled_at timestamptz,
  alerted_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists stock_requests_status_idx on stock_requests(status);
create index if not exists stock_requests_supplier_idx on stock_requests(supplier_id);

update suppliers set collection_method='driver'
 where name ilike '%market%' or name ilike 'costco%' or name ilike 'spud shed%' or name ilike 'kakulas%';

-- Old tables no longer used by the app (safe to drop once happy):
-- stock_orders, stock_order_items, stock_order_drafts, stock_order_supplier_items,
-- cbd_stock_order_config, cbd_order_item_ticks, ingredient_par_levels
