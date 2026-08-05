import type { Client } from 'pg'

/**
 * Finds every vendor-scoped relation, and how ownership of one of its rows is
 * decided — from the system catalog, never from a list in this file.
 *
 * A hand-maintained list is a list somebody forgets to extend. The moment a
 * table is added that hangs off an order, the suite covers it, whether or not
 * anyone remembers this file exists.
 *
 * Two kinds of scoping, because the schema has two:
 *
 *   * Direct — the relation carries `vendor_id`. `products`, `orders`,
 *     `vendor_users`, and the `vendor_collections` view.
 *
 *   * Indirect — the relation carries no vendor_id at all and is scoped through
 *     a parent, which is exactly how `order_lines` and `order_line_refs` are
 *     specified. Found by walking foreign keys out of an already-scoped
 *     relation, and the ownership predicate is built by nesting the parent's.
 *
 * So `order_line_refs` is discovered through `order_lines` into `orders`. Nobody
 * wrote that down; Postgres did.
 *
 * Only NOT NULL foreign keys are followed. A nullable one cannot establish who
 * owns a row, because the rows where it is null have no owner along that path —
 * `order_lines.sku` is the live example: it is null on every new-design line, so
 * walking it would produce a predicate that quietly matches none of them and a
 * suite that believed it had checked.
 */
export interface ScopedRelation {
  tableName: string
  /** 'r' table, 'v' view, 'm' materialised view. */
  kind: string
  /** How many foreign keys from a relation that carries vendor_id. */
  depth: number
  /** SQL predicate selecting the rows that belong to the vendor in $1. */
  ownerPredicate: string
}

const DISCOVERY = `
with recursive scoped as (
  -- Relations that carry the anchor column themselves.
  select
    c.oid                                            as relid,
    c.relname::text                                  as table_name,
    c.relkind::text                                  as kind,
    0                                                as depth,
    format('%I.vendor_id = $1', c.relname)           as owner_predicate
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'v', 'm')
    and exists (
      select 1 from pg_attribute a
       where a.attrelid = c.oid
         and a.attname = 'vendor_id'
         and a.attnum > 0
         and not a.attisdropped
    )

  union all

  -- Relations reachable by a foreign key OUT of something already scoped.
  -- The child's predicate nests the parent's, so ownership is resolved all the
  -- way back to a vendor_id however many hops away it is.
  select
    child.oid,
    child.relname::text,
    child.relkind::text,
    parent.depth + 1,
    format(
      '%I.%I in (select %I from %I where %s)',
      child.relname, child_att.attname,
      parent_att.attname, parent.table_name, parent.owner_predicate
    )
  from pg_constraint fk
  join pg_class child       on child.oid = fk.conrelid
  join pg_namespace n       on n.oid = child.relnamespace
  join scoped parent        on parent.relid = fk.confrelid
  join pg_attribute child_att
    on child_att.attrelid = fk.conrelid and child_att.attnum = fk.conkey[1]
  join pg_attribute parent_att
    on parent_att.attrelid = fk.confrelid and parent_att.attnum = fk.confkey[1]
  where fk.contype = 'f'
    and n.nspname = 'public'
    and child.relkind = 'r'
    and child.oid <> parent.relid
    -- See the header: a nullable FK is not an ownership anchor.
    and child_att.attnotnull
    -- Single-column keys only; the schema has no composite ones, and a
    -- half-built predicate would be worse than an honest omission.
    and array_length(fk.conkey, 1) = 1
    -- Backstop against a cycle; the schema is three deep.
    and parent.depth < 4
)
select distinct table_name, kind, depth, owner_predicate
  from scoped
 order by depth, table_name, owner_predicate
`

export async function discoverScopedRelations(c: Client): Promise<ScopedRelation[]> {
  const { rows } = await c.query<{
    table_name: string
    kind: string
    depth: number
    owner_predicate: string
  }>(DISCOVERY)

  return rows.map((r) => ({
    tableName: r.table_name,
    kind: r.kind,
    depth: r.depth,
    ownerPredicate: r.owner_predicate,
  }))
}
