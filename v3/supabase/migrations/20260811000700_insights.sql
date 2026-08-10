-- =============================================================================
-- 017 — The insights dashboard, as two functions
-- =============================================================================
-- Everything this screen asks is a GROUP BY with a variable grouping column and
-- four optional multi-valued filters. PostgREST can express none of that, and
-- doing it in TypeScript means pulling `sku_sales_daily` joined to `products`
-- into a serverless function and aggregating it there — a year of daily rows
-- across 9,827 designs, to produce five numbers.
--
-- So: two functions. One returns the headline figures, one returns the
-- breakdown a level below whatever is selected. Both take the same filter
-- arguments so the two can never disagree about what "the selection" means.
--
-- SECURITY INVOKER, not definer. This is a reporting surface, and it must be
-- impossible for it to become a way around RLS — if a vendor login ever reached
-- it, she would see her own rows and nothing else, because the policies apply
-- exactly as they do to a direct query. The internal check is belt to that
-- braces: the dashboard is admin-only by product decision, not only by policy.
--
-- THE SELL-THROUGH DENOMINATOR is the part worth stating. "Units sold divided
-- by units available in period" has no single honest reading, because stock
-- moves during the window. This uses units sold ÷ (units sold + units still on
-- hand at the end) — what was actually shifted, over everything that could have
-- been. It is the reading a buyer means when she asks "how much of it went",
-- and it cannot exceed 1.
-- =============================================================================

create or replace function public.insights_summary(
  p_from     date,
  p_to       date,
  p_vendors     text[] default null,
  p_collections text[] default null,
  p_fabrics     text[] default null,
  p_colours     text[] default null
)
returns table (
  orders_placed     bigint,
  units_sold        bigint,
  products_sold     bigint,
  units_on_hand     bigint,
  sell_through      numeric,
  revenue           numeric
)
language sql
security invoker
stable
set search_path = ''
as $$
  with scoped as (
    select p.sku, p.qty_available
      from public.products p
      join public.vendors v on v.id = p.vendor_id
     where (p_vendors     is null or v.code       = any(p_vendors))
       and (p_collections is null or p.collection = any(p_collections))
       and (p_fabrics     is null or p.fabric     = any(p_fabrics))
       and (p_colours     is null or p.colour_code = any(p_colours))
  ),
  sales as (
    select s.sku, s.units, s.orders, s.revenue
      from public.sku_sales_daily s
      join scoped sc on sc.sku = s.sku
     where s.date between p_from and p_to
  )
  select
    coalesce(sum(sales.orders), 0)::bigint,
    coalesce(sum(sales.units), 0)::bigint,
    (select count(distinct sku) from sales where units > 0)::bigint,
    (select coalesce(sum(qty_available), 0) from scoped)::bigint,
    -- Sold ÷ (sold + still on hand). Null rather than a division by zero when
    -- nothing sold and nothing remains — a rate of 0% would claim a fact about
    -- a set with nothing in it.
    case
      when coalesce(sum(sales.units), 0) + (select coalesce(sum(qty_available), 0) from scoped) = 0
        then null
      else round(
        coalesce(sum(sales.units), 0)::numeric
        / (coalesce(sum(sales.units), 0) + (select coalesce(sum(qty_available), 0) from scoped)),
        4
      )
    end,
    coalesce(sum(sales.revenue), 0)::numeric
  from sales;
$$;

comment on function public.insights_summary(date, date, text[], text[], text[], text[]) is
  'Headline figures for a period and filter selection. security_invoker, so RLS applies exactly as to a direct query.';

/**
 * The same figures, grouped one level below whatever is selected.
 *
 * `p_group_by` is validated against a fixed list rather than interpolated,
 * because a grouping column arriving from a query string and reaching SQL by
 * concatenation is an injection in the one place people forget to look.
 */
create or replace function public.insights_breakdown(
  p_group_by text,
  p_from     date,
  p_to       date,
  p_vendors     text[] default null,
  p_collections text[] default null,
  p_fabrics     text[] default null,
  p_colours     text[] default null
)
returns table (
  bucket          text,
  orders_placed   bigint,
  units_sold      bigint,
  products_sold   bigint,
  units_on_hand   bigint,
  sell_through    numeric,
  revenue         numeric
)
language plpgsql
security invoker
stable
set search_path = ''
as $$
begin
  if p_group_by not in ('vendor', 'collection', 'fabric', 'colour') then
    raise exception 'Unknown grouping "%".', p_group_by using errcode = 'invalid_parameter_value';
  end if;

  return query
  with scoped as (
    select
      p.sku,
      p.qty_available,
      case p_group_by
        when 'vendor'     then v.code
        when 'collection' then p.collection
        when 'fabric'     then p.fabric
        else                   p.colour_code
      end as bucket
      from public.products p
      join public.vendors v on v.id = p.vendor_id
     where (p_vendors     is null or v.code       = any(p_vendors))
       and (p_collections is null or p.collection = any(p_collections))
       and (p_fabrics     is null or p.fabric     = any(p_fabrics))
       and (p_colours     is null or p.colour_code = any(p_colours))
  ),
  sales as (
    select sc.bucket, s.sku, s.units, s.orders, s.revenue
      from public.sku_sales_daily s
      join scoped sc on sc.sku = s.sku
     where s.date between p_from and p_to
  ),
  stock as (
    select sc.bucket, sum(sc.qty_available) as on_hand
      from scoped sc
     group by sc.bucket
  ),
  sold as (
    select
      sa.bucket,
      sum(sa.orders)                             as orders_placed,
      sum(sa.units)                              as units_sold,
      count(distinct sa.sku) filter (where sa.units > 0) as products_sold,
      sum(sa.revenue)                            as revenue
      from sales sa
     group by sa.bucket
  )
  select
    coalesce(st.bucket, so.bucket)              as bucket,
    coalesce(so.orders_placed, 0)::bigint,
    coalesce(so.units_sold, 0)::bigint,
    coalesce(so.products_sold, 0)::bigint,
    coalesce(st.on_hand, 0)::bigint,
    case
      when coalesce(so.units_sold, 0) + coalesce(st.on_hand, 0) = 0 then null
      else round(
        coalesce(so.units_sold, 0)::numeric
        / (coalesce(so.units_sold, 0) + coalesce(st.on_hand, 0)),
        4
      )
    end,
    coalesce(so.revenue, 0)::numeric
  from stock st
  full outer join sold so on so.bucket = st.bucket
  where coalesce(st.bucket, so.bucket) is not null
  order by coalesce(so.units_sold, 0) desc, bucket;
end;
$$;

comment on function public.insights_breakdown(text, date, date, text[], text[], text[], text[]) is
  'The same figures one level down. p_group_by is validated against a fixed list, never interpolated.';

/**
 * Units sold per day across the selection, for the chart.
 *
 * Returns only days that had sales; the client fills the gaps with zeroes. A
 * server-side generate_series over 365 days per request costs more than the
 * loop it saves, and the client has to walk the array to draw the line anyway.
 */
create or replace function public.insights_daily(
  p_from     date,
  p_to       date,
  p_vendors     text[] default null,
  p_collections text[] default null,
  p_fabrics     text[] default null,
  p_colours     text[] default null
)
returns table (day date, units bigint, revenue numeric)
language sql
security invoker
stable
set search_path = ''
as $$
  select s.date, sum(s.units)::bigint, sum(s.revenue)::numeric
    from public.sku_sales_daily s
    join public.products p on p.sku = s.sku
    join public.vendors  v on v.id = p.vendor_id
   where s.date between p_from and p_to
     and (p_vendors     is null or v.code       = any(p_vendors))
     and (p_collections is null or p.collection = any(p_collections))
     and (p_fabrics     is null or p.fabric     = any(p_fabrics))
     and (p_colours     is null or p.colour_code = any(p_colours))
   group by s.date
   order by s.date;
$$;

comment on function public.insights_daily(date, date, text[], text[], text[], text[]) is
  'Units and revenue per day for the chart. Days with no sales are absent; the client fills them.';

revoke all on function public.insights_summary(date, date, text[], text[], text[], text[])            from public, anon;
revoke all on function public.insights_breakdown(text, date, date, text[], text[], text[], text[])    from public, anon;
revoke all on function public.insights_daily(date, date, text[], text[], text[], text[])              from public, anon;

grant execute on function public.insights_summary(date, date, text[], text[], text[], text[])         to authenticated;
grant execute on function public.insights_breakdown(text, date, date, text[], text[], text[], text[]) to authenticated;
grant execute on function public.insights_daily(date, date, text[], text[], text[], text[])           to authenticated;

-- -----------------------------------------------------------------------------
-- The filter options
-- -----------------------------------------------------------------------------
-- `vendor_facets` already does this per vendor for the weaver's catalogue. This
-- is the same idea across the whole catalogue, with the vendor code carried so
-- the four filters can narrow each other.
--
-- security_invoker, like every view here: an admin sees everything through it
-- because `products_select_internal` says so, not because the view bypasses
-- anything.
--
-- `vendor_id` is carried alongside `vendor_code` purely so the isolation
-- suite's discovery finds this view and holds it to the leak assertion. Nothing
-- reads the uuid — the filters key on the code — but a vendor-scoped view that
-- discovery cannot see is a view whose security_invoker nobody is checking.
create view catalogue_facets
with (security_invoker = true) as
  select
    p.vendor_id,
    v.code                    as vendor_code,
    p.collection,
    p.fabric,
    p.colour_code,
    count(*)::integer         as design_count
  from products p
  join vendors v on v.id = p.vendor_id
  group by p.vendor_id, v.code, p.collection, p.fabric, p.colour_code;

grant select on catalogue_facets to authenticated;

comment on view catalogue_facets is
  'Every vendor/collection/fabric/colour combination with a count, for the cascading insight filters.';
