import 'server-only'

/**
 * The Shopify Admin GraphQL client, and the bulk operation runner.
 *
 * WHY BULK AND NOT PAGINATION. There are 9,840 products with a median of eleven
 * images each. Paginated REST is 100 products a page — 99 round trips, each
 * costing a rate-limit bucket, and the images push each response past the point
 * where the connection is the bottleneck. Shopify's own answer to this is
 * `bulkOperationRunQuery`: one mutation submits a query, Shopify runs it
 * server-side against the whole catalogue, and hands back a URL to a JSONL file.
 * One request, one poll loop, one download. It also cannot be rate-limited
 * halfway through and leave the catalogue half-updated.
 *
 * ONE BULK OPERATION AT A TIME. Shopify permits exactly one running bulk query
 * per shop per API client, and submitting a second while one runs is an error
 * rather than a queue. So the runner checks for one already in flight and
 * refuses rather than stampeding — which matters the moment the 30-minute cron
 * overlaps with an admin pressing the button.
 */

const API_VERSION = '2025-10'

export interface ShopifyConfig {
  shop: string
  accessToken: string
}

/**
 * Configuration, or null when Shopify has not been connected yet.
 *
 * Null rather than throwing, because "not connected" is a legitimate state of
 * this application — the whole build runs against the seed CSVs until the
 * credentials arrive, and every screen has to work in the meantime.
 */
export function shopifyConfig(): ShopifyConfig | null {
  const shop = process.env.SHOPIFY_SHOP_DOMAIN
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN

  if (!shop || !accessToken) return null

  return { shop: shop.replace(/^https?:\/\//, '').replace(/\/$/, ''), accessToken }
}

export class ShopifyError extends Error {
  constructor(message: string, readonly detail?: unknown) {
    super(message)
    this.name = 'ShopifyError'
  }
}

interface GraphQLResponse<T> {
  data?: T
  errors?: { message: string }[]
}

export async function shopifyGraphQL<T>(
  config: ShopifyConfig,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://${config.shop}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': config.accessToken,
      },
      body: JSON.stringify({ query, variables }),
      // This is a data sync, never a cached read.
      cache: 'no-store',
    },
  )

  if (!response.ok) {
    throw new ShopifyError(
      `Shopify returned ${response.status} ${response.statusText}`,
      await response.text().catch(() => undefined),
    )
  }

  const body = (await response.json()) as GraphQLResponse<T>

  // GraphQL answers 200 with an errors array. Treating that as success is how a
  // sync "succeeds" having written nothing.
  if (body.errors?.length) {
    throw new ShopifyError(body.errors.map((e) => e.message).join('; '), body.errors)
  }
  if (!body.data) throw new ShopifyError('Shopify returned no data')

  return body.data
}

// -----------------------------------------------------------------------------
// Bulk operations
// -----------------------------------------------------------------------------

interface BulkOperation {
  id: string
  status: 'CREATED' | 'RUNNING' | 'COMPLETED' | 'CANCELED' | 'CANCELING' | 'FAILED' | 'EXPIRED'
  errorCode: string | null
  objectCount: string | null
  url: string | null
  partialDataUrl: string | null
}

const CURRENT_BULK = `
  query {
    currentBulkOperation(type: QUERY) {
      id status errorCode objectCount url partialDataUrl
    }
  }
`

const RUN_BULK = `
  mutation bulkOperationRunQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status errorCode objectCount url partialDataUrl }
      userErrors { field message }
    }
  }
`

const CANCEL_BULK = `
  mutation bulkOperationCancel($id: ID!) {
    bulkOperationCancel(id: $id) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`

export async function currentBulkOperation(config: ShopifyConfig): Promise<BulkOperation | null> {
  const data = await shopifyGraphQL<{ currentBulkOperation: BulkOperation | null }>(
    config,
    CURRENT_BULK,
  )
  return data.currentBulkOperation
}

/**
 * Submit a bulk query, wait for it, and return the JSONL as an array of objects.
 *
 * The poll interval starts at two seconds and backs off to fifteen. A products
 * export of this size finishes in well under a minute; the backoff is there so
 * that a slow one does not spend its whole life making requests.
 */
export async function runBulkQuery<T>(
  config: ShopifyConfig,
  query: string,
  opts: { timeoutMs?: number; onProgress?: (message: string) => void } = {},
): Promise<T[]> {
  const say = opts.onProgress ?? (() => {})
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000

  // Shopify runs one bulk QUERY per shop at a time. A stale one from a crashed
  // run would otherwise block every sync from here on, so an operation older
  // than the timeout is cancelled rather than waited on.
  const existing = await currentBulkOperation(config)
  if (existing && (existing.status === 'RUNNING' || existing.status === 'CREATED')) {
    throw new ShopifyError(
      'A Shopify bulk operation is already running for this shop. It will finish on its own; try again in a few minutes.',
    )
  }

  const started = await shopifyGraphQL<{
    bulkOperationRunQuery: {
      bulkOperation: BulkOperation | null
      userErrors: { field: string[]; message: string }[]
    }
  }>(config, RUN_BULK, { query })

  const errors = started.bulkOperationRunQuery.userErrors
  if (errors?.length) {
    throw new ShopifyError(errors.map((e) => e.message).join('; '), errors)
  }

  const operation = started.bulkOperationRunQuery.bulkOperation
  if (!operation) throw new ShopifyError('Shopify did not start the bulk operation')

  say('Bulk operation submitted')

  const deadline = Date.now() + timeoutMs
  let wait = 2000

  for (;;) {
    if (Date.now() > deadline) {
      // Leaving it running would block the next sync too.
      await shopifyGraphQL(config, CANCEL_BULK, { id: operation.id }).catch(() => {})
      throw new ShopifyError(`Shopify bulk operation did not finish within ${timeoutMs / 1000}s`)
    }

    await new Promise((resolve) => setTimeout(resolve, wait))
    wait = Math.min(wait * 1.5, 15000)

    const current = await currentBulkOperation(config)
    if (!current || current.id !== operation.id) {
      throw new ShopifyError('Shopify lost track of the bulk operation')
    }

    if (current.status === 'COMPLETED') {
      // No URL with a zero object count is normal and means an empty result,
      // not a failure.
      if (!current.url) return []
      say(`Downloading ${current.objectCount ?? '?'} objects`)
      return downloadJsonl<T>(current.url)
    }

    if (
      current.status === 'FAILED' ||
      current.status === 'CANCELED' ||
      current.status === 'EXPIRED'
    ) {
      throw new ShopifyError(
        `Shopify bulk operation ${current.status.toLowerCase()}${
          current.errorCode ? `: ${current.errorCode}` : ''
        }`,
      )
    }

    say(`Waiting — ${current.status.toLowerCase()}, ${current.objectCount ?? 0} objects so far`)
  }
}

/**
 * JSONL, streamed and parsed line by line.
 *
 * Not `await response.text()` then `.split('\n')`: a full products export of
 * this catalogue is tens of megabytes, and holding the whole string plus the
 * whole array of parsed objects at once is two copies of it in a serverless
 * function with a fixed memory ceiling.
 */
async function downloadJsonl<T>(url: string): Promise<T[]> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok || !response.body) {
    throw new ShopifyError(`Could not download the bulk result: ${response.status}`)
  }

  const rows: T[] = []
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) rows.push(JSON.parse(line) as T)
    }
  }

  const last = buffer.trim()
  if (last) rows.push(JSON.parse(last) as T)

  return rows
}
