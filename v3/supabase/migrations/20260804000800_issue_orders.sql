-- =============================================================================
-- 008 — issue_orders: one press of send, one batch, one order per vendor
-- =============================================================================
-- Pooja makes one decision and the system splits it by weaver. That split has
-- to be atomic: three orders where the second insert failed is worse than none,
-- because two weavers start work on half a decision.
--
-- PostgREST has no transaction across requests, so the whole split lives in one
-- function. This is the only reason it exists.
--
-- SECURITY DEFINER, deliberately, for two things RLS cannot express from the
-- client side: writing `products.last_ordered_at` (no UPDATE grant on products
-- exists, and should not), and reading every product to resolve its vendor in a
-- single pass. The guard on the first line is therefore load-bearing — it is
-- the only thing standing between this function and a vendor calling it as an
-- RPC. `search_path` is pinned for the usual reason: without it, a caller who
-- can create objects earlier on the path could shadow `products`.
--
-- Vendor is NEVER taken from the payload. It is resolved from the SKU's own
-- product row, which is resolved from the SKU prefix by the loader. The client
-- says which sarees; the database says whose they are.
-- =============================================================================

create or replace function public.issue_orders(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch        uuid := gen_random_uuid();
  v_result       jsonb := '[]'::jsonb;
  v_restock      jsonb := coalesce(p_payload -> 'restock', '[]'::jsonb);
  v_new_designs  jsonb := coalesce(p_payload -> 'new_designs', '[]'::jsonb);
  v_line         jsonb;
  v_sku          text;
  v_missing      text;
  v_vendor       uuid;
  v_order_id     uuid;
  v_order_number text;
  v_line_id      uuid;
  v_refs         text[];
  v_ref_count    integer;
  v_lines        integer;
begin
  if not app.is_internal() then
    raise exception 'Only procurement can issue orders.'
      using errcode = 'insufficient_privilege';
  end if;

  if jsonb_array_length(v_restock) = 0 and jsonb_array_length(v_new_designs) = 0 then
    raise exception 'Nothing selected.' using errcode = 'check_violation';
  end if;

  -- ---------------------------------------------------------------------------
  -- Everything named must exist. Checked up front so a bad SKU fails before any
  -- order is written rather than halfway through the third one.
  -- ---------------------------------------------------------------------------
  create temporary table _wanted (sku text primary key) on commit drop;

  insert into _wanted (sku)
  select distinct s from (
    select jsonb_array_elements(v_restock) ->> 'sku' as s
    union
    select jsonb_array_elements(jsonb_path_query_array(v_new_designs, '$[*].refs[*]')) #>> '{}'
  ) x
  where s is not null;

  select w.sku into v_missing
    from _wanted w
    left join public.products p on p.sku = w.sku
   where p.sku is null
   limit 1;

  if v_missing is not null then
    raise exception 'No such design: %', v_missing using errcode = 'foreign_key_violation';
  end if;

  -- ---------------------------------------------------------------------------
  -- Which weavers this press of send touches.
  --
  -- A restock line belongs to its own SKU's vendor. A new-design line belongs to
  -- the vendor of the sarees Pooja pointed at — so those references must all be
  -- one weaver's, or the line has no addressee.
  -- ---------------------------------------------------------------------------
  create temporary table _work (
    vendor_id   uuid    not null,
    kind        text    not null,
    sku         text,
    brief       text,
    quantity    integer not null,
    refs        text[],
    seq         integer not null
  ) on commit drop;

  for v_line in select * from jsonb_array_elements(v_restock)
  loop
    v_sku := v_line ->> 'sku';
    select p.vendor_id into v_vendor from public.products p where p.sku = v_sku;

    insert into _work (vendor_id, kind, sku, quantity, seq)
    values (
      v_vendor,
      'restock',
      v_sku,
      greatest(1, coalesce((v_line ->> 'quantity')::integer, 1)),
      coalesce((select max(seq) from _work), 0) + 1
    );
  end loop;

  for v_line in select * from jsonb_array_elements(v_new_designs)
  loop
    select array_agg(value #>> '{}') into v_refs
      from jsonb_array_elements(coalesce(v_line -> 'refs', '[]'::jsonb));

    v_ref_count := coalesce(array_length(v_refs, 1), 0);
    if v_ref_count < 1 or v_ref_count > 6 then
      raise exception 'A new design needs one to six reference designs; got %.', v_ref_count
        using errcode = 'check_violation';
    end if;

    if coalesce(length(trim(v_line ->> 'brief')), 0) = 0 then
      raise exception 'A new design needs a note.' using errcode = 'check_violation';
    end if;

    select count(distinct p.vendor_id) into v_lines
      from public.products p where p.sku = any(v_refs);

    if v_lines <> 1 then
      raise exception
        'The reference designs on a new-design line must all belong to one weaver.'
        using errcode = 'check_violation';
    end if;

    select p.vendor_id into v_vendor
      from public.products p where p.sku = v_refs[1];

    insert into _work (vendor_id, kind, brief, quantity, refs, seq)
    values (
      v_vendor,
      'new_design',
      trim(v_line ->> 'brief'),
      greatest(1, coalesce((v_line ->> 'quantity')::integer, 1)),
      v_refs,
      coalesce((select max(seq) from _work), 0) + 1
    );
  end loop;

  -- ---------------------------------------------------------------------------
  -- One order per weaver, all sharing the batch. Snapshots are taken here, from
  -- the product row as it stands right now, because the vendor must see what was
  -- ordered rather than what the record later became.
  -- ---------------------------------------------------------------------------
  for v_vendor in select distinct w.vendor_id from _work w order by 1
  loop
    insert into public.orders (batch_id, vendor_id, created_by)
    values (v_batch, v_vendor, (select auth.uid()))
    returning id, order_number into v_order_id, v_order_number;

    insert into public.order_lines
      (order_id, line_type, sku, quantity, reorder_reason,
       snapshot_title, snapshot_image_url, snapshot_desc)
    select
      v_order_id,
      'restock',
      w.sku,
      w.quantity,
      case p.qty_available when 0 then 'sold_out' when 1 then 'last_piece' else null end,
      p.title,
      p.image_url,
      p.description
    from _work w
    join public.products p on p.sku = w.sku
    where w.vendor_id = v_vendor and w.kind = 'restock'
    order by w.seq;

    for v_line in
      select to_jsonb(w) from _work w
       where w.vendor_id = v_vendor and w.kind = 'new_design'
       order by w.seq
    loop
      insert into public.order_lines (order_id, line_type, brief, quantity)
      values (v_order_id, 'new_design', v_line ->> 'brief', (v_line ->> 'quantity')::integer)
      returning id into v_line_id;

      insert into public.order_line_refs (order_line_id, sku, snapshot_image_url)
      select v_line_id, p.sku, p.image_url
        from public.products p
       where p.sku = any(
         select jsonb_array_elements_text(v_line -> 'refs')
       );
    end loop;

    select count(*) into v_lines from public.order_lines where order_id = v_order_id;

    v_result := v_result || jsonb_build_object(
      'order_id',     v_order_id,
      'order_number', v_order_number,
      'vendor_code',  (select code from public.vendors where id = v_vendor),
      'vendor_name',  (select display_name from public.vendors where id = v_vendor),
      'lines',        v_lines
    );
  end loop;

  -- Only restock lines: pointing at a saree for inspiration is not ordering it.
  update public.products p
     set last_ordered_at = now()
    from _work w
   where w.kind = 'restock' and p.sku = w.sku;

  return jsonb_build_object('batch_id', v_batch, 'orders', v_result);
end;
$$;

revoke all on function public.issue_orders(jsonb) from public, anon;
grant execute on function public.issue_orders(jsonb) to authenticated;

comment on function public.issue_orders(jsonb) is
  'One press of send: splits a selection by vendor and writes one order each, in a single transaction. Vendor is resolved from each SKU''s product row, never from the payload.';
