-- Supalens demo dataset v2 — "Northwind Supply", a small direct-to-consumer apparel store (USD).
--
-- Run on the DEDICATED demo Postgres (Neon) as its OWNER role — NEVER the app database:
--   psql "$SUPALENS_DEMO_OWNER_URL" -v ON_ERROR_STOP=1 -f demo/seed.sql
-- Supalens connects as supalens_demo_ro (DEMO_DATABASE_URL), which may only SELECT the four
-- public views below. Re-running the file rebuilds everything deterministically.
--
-- Rolling window: rows live in the private `demo_data` schema, generated once around an anchor
-- day. The public views move them forward in whole weeks and hide anything later than now(), so
-- "last 30 days" questions always have data, weekday patterns stay on real weekdays, and no write
-- job is needed. Keep DEMO_DATA_ANCHOR in src/lib/demo/public-demo.ts equal to the anchor below.
--
-- Planted stories (base day 0 = anchor; a base day shows up 0–6 days later than its offset):
--   1. Stock-out    — Selvedge Denim Jeans (best seller) sells nothing on base days -18…-14 and
--                     fewer shoppers arrive; daily revenue drops sharply, then recovers.
--   2. Refund spike — Trail Runner Sneakers from a bad batch (base days -45…-12) are refunded
--                     about 40% of the time; everything else stays near 6%.
--   3. New market   — Japan signups and orders grow about 4× from base day -35.
-- Plus ~50% order growth over six months and busier weekends.

begin;

select setseed(0.4242);

drop view if exists public.order_items, public.orders, public.products, public.customers cascade;
drop table if exists public.order_items, public.orders, public.products, public.customers cascade;
drop schema if exists demo_data cascade;
create schema demo_data;

create table demo_data.meta (anchor date not null);
insert into demo_data.meta values ('2026-09-17');

create table demo_data.customers (
  id          serial primary key,
  name        text not null,
  email       text not null,
  country     text not null,
  signup_date date not null
);

create table demo_data.products (
  id         serial primary key,
  name       text not null,
  category   text not null,
  price      numeric(10,2) not null,
  popularity numeric not null
);

create table demo_data.orders (
  id           serial primary key,
  customer_id  int not null references demo_data.customers(id),
  order_date   timestamptz not null,
  status       text not null,
  total_amount numeric(12,2) not null default 0
);

create table demo_data.order_items (
  id         serial primary key,
  order_id   int not null references demo_data.orders(id),
  product_id int not null references demo_data.products(id),
  quantity   int not null,
  unit_price numeric(10,2) not null
);

insert into demo_data.products (name, category, price, popularity) values
  ('Selvedge Denim Jeans',     'Apparel',     128.00, 18),
  ('Classic Crew Tee',         'Apparel',      32.00, 10),
  ('Heavyweight Hoodie',       'Apparel',      78.00,  7),
  ('Oxford Button-Down',       'Apparel',      68.00,  4),
  ('Merino Crewneck Sweater',  'Apparel',      98.00,  4),
  ('Relaxed Chino Pants',      'Apparel',      74.00,  4),
  ('Linen Camp Shirt',         'Apparel',      62.00,  3),
  ('Quilted Liner Jacket',     'Apparel',     148.00,  3),
  ('Waxed Field Jacket',       'Apparel',     195.00,  2),
  ('Ribbed Tank Top',          'Apparel',      24.00,  3),
  ('Fleece Half-Zip',          'Apparel',      84.00,  3),
  ('Pleated Midi Skirt',       'Apparel',      72.00,  2),
  ('Slub Pocket Tee',          'Apparel',      36.00,  3),
  ('Corduroy Overshirt',       'Apparel',      88.00,  2),
  ('Everyday Joggers',         'Apparel',      58.00,  4),
  ('Wrap Knit Cardigan',       'Apparel',      92.00,  2),
  ('Trail Runner Sneakers',    'Footwear',    145.00,  6),
  ('Court Leather Sneakers',   'Footwear',    120.00,  5),
  ('Canvas Low-Tops',          'Footwear',     58.00,  5),
  ('Suede Chelsea Boots',      'Footwear',    175.00,  2),
  ('Everyday Slides',          'Footwear',     34.00,  3),
  ('Knit Runner',              'Footwear',     98.00,  3),
  ('Leather Loafers',          'Footwear',    138.00,  2),
  ('Hiking Boots',             'Footwear',    165.00,  2),
  ('Wool Slippers',            'Footwear',     48.00,  2),
  ('Platform Sandals',         'Footwear',     64.00,  2),
  ('Canvas Tote Bag',          'Accessories',  28.00,  6),
  ('Wool Beanie',              'Accessories',  26.00,  4),
  ('Leather Card Wallet',      'Accessories',  45.00,  4),
  ('Crew Socks 3-Pack',        'Accessories',  18.00,  7),
  ('Baseball Cap',             'Accessories',  30.00,  4),
  ('Cashmere Scarf',           'Accessories',  89.00,  2),
  ('Leather Belt',             'Accessories',  52.00,  2),
  ('Canvas Backpack',          'Accessories',  96.00,  2),
  ('Polarized Sunglasses',     'Accessories',  78.00,  2),
  ('Silk Bandana',             'Accessories',  34.00,  1),
  ('Weekender Duffel',         'Accessories', 158.00,  1),
  ('Minimal Watch',            'Accessories', 135.00,  1),
  ('Knit Gloves',              'Accessories',  29.00,  2),
  ('Travel Pouch',             'Accessories',  22.00,  2);

create function demo_data.pick_country(jp_boost boolean) returns text
language plpgsql as $$
declare
  countries text[] := array['US', 'GB', 'DE', 'CA', 'AU', 'KR', 'JP', 'FR', 'NL', 'SE'];
  weights numeric[] := array[38, 11, 9, 8, 6, 8, 5, 5, 5, 5];
  total numeric := 0;
  target numeric;
  acc numeric := 0;
begin
  if jp_boost then weights[7] := weights[7] * 4; end if;
  for n in 1..array_length(weights, 1) loop total := total + weights[n]; end loop;
  target := random() * total;
  for n in 1..array_length(countries, 1) loop
    acc := acc + weights[n];
    if target <= acc then return countries[n]; end if;
  end loop;
  return 'US';
end $$;

create function demo_data.add_customer(country text, signup date) returns int
language plpgsql as $$
declare
  first_names text[] := array['Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Ethan', 'Mia', 'Lucas', 'Sofia',
    'Mason', 'Isla', 'Leo', 'Amelia', 'Oscar', 'Harper', 'Jack', 'Chloe', 'Henry', 'Grace', 'Theo',
    'Hana', 'Yuto', 'Sakura', 'Ren', 'Jiwoo', 'Minjun', 'Clara', 'Felix', 'Lena', 'Jonas', 'Maya',
    'Daniel', 'Zoe', 'Arthur', 'Nora', 'Elias'];
  last_names text[] := array['Smith', 'Johnson', 'Brown', 'Taylor', 'Wilson', 'Clarke', 'Walker',
    'Hughes', 'Evans', 'Martin', 'Garcia', 'Miller', 'Davis', 'Lopez', 'Moore', 'Young', 'Allen',
    'King', 'Wright', 'Scott', 'Tanaka', 'Sato', 'Suzuki', 'Kim', 'Lee', 'Park', 'Schmidt', 'Muller',
    'Fischer', 'Weber', 'Dubois', 'Laurent', 'Jansen', 'Berg', 'Nilsson', 'Rossi'];
  new_id int;
begin
  insert into demo_data.customers (name, email, country, signup_date)
  values (
    first_names[1 + floor(random() * array_length(first_names, 1))::int] || ' ' ||
      last_names[1 + floor(random() * array_length(last_names, 1))::int],
    '',
    country,
    signup
  )
  returning id into new_id;
  update demo_data.customers set email = 'customer' || new_id || '@example.com' where id = new_id;
  return new_id;
end $$;

do $$
declare
  anchor date := (select m.anchor from demo_data.meta m);
  jeans_id int := (select id from demo_data.products where name = 'Selvedge Denim Jeans');
  runner_id int := (select id from demo_data.products where name = 'Trail Runner Sneakers');
  product_ids int[];
  product_prices numeric[];
  product_cumulative numeric[];
  popularity_total numeric;
  v_customers_so_far int;
  v_day_orders int;
  v_day date;
  v_country text;
  v_customer_id int;
  v_order_id int;
  v_line_count int;
  v_product_index int;
  v_target numeric;
  v_quantity int;
  v_includes_runner boolean;
  v_status text;
begin
  select array_agg(id order by id), array_agg(price order by id),
         array_agg(cumulative order by id), max(cumulative)
  into product_ids, product_prices, product_cumulative, popularity_total
  from (select id, price, sum(popularity) over (order by id) as cumulative from demo_data.products) p;

  -- 700 accounts that signed up before the six-month window
  for n in 1..700 loop
    perform demo_data.add_customer(demo_data.pick_country(false), anchor - (183 + floor(random() * 240)::int));
  end loop;
  v_customers_so_far := 700;

  for d in -182..7 loop
    v_day := anchor + d;
    -- +50% growth across the window, busier weekends, day-to-day noise
    v_day_orders := round(
      (20 + 10 * (d + 182) / 189.0)
      * (case when extract(isodow from v_day) in (6, 7) then 1.25 else 1 end)
      * (0.85 + random() * 0.3)
    );
    -- the stock-out also turns away shoppers who came for the jeans
    if d between -18 and -14 then v_day_orders := round(v_day_orders * 0.7); end if;

    for o in 1..v_day_orders loop
      v_country := demo_data.pick_country(d >= -35);
      if random() < (case when v_country = 'JP' and d >= -35 then 0.75 else 0.34 end) then
        v_customer_id := demo_data.add_customer(v_country, v_day - floor(random() * 3)::int);
        v_customers_so_far := v_customers_so_far + 1;
      else
        -- ids are sequential and every existing account signed up on or before this v_day
        v_customer_id := 1 + floor(random() * v_customers_so_far)::int;
      end if;

      insert into demo_data.orders (customer_id, order_date, status)
      values (
        v_customer_id,
        v_day::timestamp at time zone 'UTC' + make_interval(mins => floor(360 + random() * random() * 1079)::int),
        'paid'
      )
      returning id into v_order_id;

      v_line_count := 1 + floor(random() * random() * 3)::int;
      v_includes_runner := false;
      for l in 1..v_line_count loop
        loop
          v_target := random() * popularity_total;
          v_product_index := 1;
          while product_cumulative[v_product_index] < v_target loop
            v_product_index := v_product_index + 1;
          end loop;
          exit when not (product_ids[v_product_index] = jeans_id and d between -18 and -14);
        end loop;
        v_quantity := case when random() < 0.86 then 1 when random() < 0.8 then 2 else 3 end;
        insert into demo_data.order_items (order_id, product_id, quantity, unit_price)
        values (v_order_id, product_ids[v_product_index], v_quantity, product_prices[v_product_index]);
        if product_ids[v_product_index] = runner_id then v_includes_runner := true; end if;
      end loop;

      -- orders from the latest day turn pending in the view, so no recency rule here
      v_status := case
        when v_includes_runner and d between -45 and -12 and random() < 0.4 then 'refunded'
        when random() < 0.06 then 'refunded'
        when random() < 0.02 then 'pending'
        else 'paid'
      end;
      update demo_data.orders
      set status = v_status,
          total_amount = (select sum(oi.quantity * oi.unit_price) from demo_data.order_items oi where oi.order_id = v_order_id)
      where id = v_order_id;
    end loop;
  end loop;

  -- accounts that never ordered (roughly a third of all signups)
  for n in 1..900 loop
    v_day := anchor + (-182 + floor(random() * 190)::int);
    perform demo_data.add_customer(demo_data.pick_country(v_day >= anchor - 35), v_day);
  end loop;
end $$;

drop function demo_data.add_customer(text, date);
drop function demo_data.pick_country(boolean);

create index on demo_data.orders (order_date);
create index on demo_data.orders (customer_id);
create index on demo_data.order_items (order_id);
create index on demo_data.order_items (product_id);

-- Whole-week shift since the anchor keeps weekday patterns on real weekdays.
create view demo_data.window_shift as
select (floor((current_date - anchor) / 7.0) * 7)::int as days
from demo_data.meta;

create view public.customers as
select c.id, c.name, c.email, c.country, c.signup_date + s.days as signup_date
from demo_data.customers c
cross join demo_data.window_shift s
where c.signup_date + s.days <= current_date;

create view public.products as
select p.id, p.name, p.category, p.price
from demo_data.products p;

-- Orders placed within the last day are still settling: about a third show as pending.
create view public.orders as
select o.id,
       o.customer_id,
       o.order_date + make_interval(days => s.days) as order_date,
       case
         when o.status = 'paid'
          and o.order_date + make_interval(days => s.days) > now() - interval '1 day'
          and o.id % 3 = 0
         then 'pending'
         else o.status
       end as status,
       o.total_amount
from demo_data.orders o
cross join demo_data.window_shift s
where o.order_date + make_interval(days => s.days) <= now();

create view public.order_items as
select oi.id, oi.order_id, oi.product_id, oi.quantity, oi.unit_price
from demo_data.order_items oi
join public.orders o on o.id = oi.order_id;

comment on view public.customers is 'Store accounts, one row per signup.';
comment on view public.products is 'Catalog items with category and list price in USD.';
comment on view public.orders is 'Checkouts. status is paid, refunded or pending; total_amount in USD.';
comment on view public.order_items is 'Product lines inside an order, priced at order time in USD.';

-- ── Read-only role ──────────────────────────────────────────────────────────────────────────────
-- First time only:  create role supalens_demo_ro login password '<STRONG_PASSWORD>';
-- DEMO_DATABASE_URL = postgresql://supalens_demo_ro:<STRONG_PASSWORD>@<host>:5432/<db>?sslmode=require
revoke all on schema demo_data from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supalens_demo_ro') then
    execute 'revoke all on schema demo_data from supalens_demo_ro';
    execute 'grant usage on schema public to supalens_demo_ro';
    execute 'grant select on public.customers, public.products, public.orders, public.order_items to supalens_demo_ro';
  end if;
end $$;

commit;
