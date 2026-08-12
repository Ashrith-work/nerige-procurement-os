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

function normaliseShop(shop: string): string {
  return shop.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

// -----------------------------------------------------------------------------
// The access token
// -----------------------------------------------------------------------------

/**
 * TWO WAYS TO HOLD A TOKEN, AND THEY EXPIRE DIFFERENTLY.
 *
 * The old way is a custom app installed from the Shopify admin, which reveals a
 * `shpat_` token once and never expires it. Set `SHOPIFY_ADMIN_ACCESS_TOKEN` and
 * nothing below runs.
 *
 * The new way is a client-credentials grant against
 * `/admin/oauth/access_token` with the app's client ID and secret. It returns a
 * token of exactly the same `shpat_` shape — and `expires_in: 86399`. Twenty-four
 * hours.
 *
 * That difference is the whole reason this file changed. Pasting a
 * client-credentials token into an environment variable produces a deployment
 * that syncs perfectly for one day and then answers 401 to every request
 * forever, at 30-minute intervals, having last succeeded yesterday. The failure
 * arrives a day after the person who configured it stopped watching, and reads
 * as "the sync broke" rather than "the token was never renewable".
 *
 * So the secret goes in the environment and the token is minted here, cached in
 * module scope, and re-minted before it lapses.
 */
interface CachedToken {
  accessToken: string
  /** Epoch ms after which this token must not be used again. */
  expiresAt: number
}

let cachedToken: CachedToken | null = null

/**
 * Re-mint this long before the stated expiry.
 *
 * A products bulk operation can legitimately run for minutes, and the poll loop
 * keeps calling `currentBulkOperation` throughout. A token checked as valid at
 * the start of a sync and expiring in its middle is the one case a naive
 * `Date.now() < expiresAt` still gets wrong, so the margin is comfortably wider
 * than the longest request this client makes.
 */
const REFRESH_MARGIN_MS = 10 * 60 * 1000

/**
 * One in-flight mint at a time.
 *
 * The scheduled sync runs products then sales back to back, and an admin can
 * press Sync now while it does. Without this, a cold start with two concurrent
 * callers mints two tokens and throws one away.
 */
let inFlight: Promise<CachedToken> | null = null

async function mintToken(shop: string, clientId: string, clientSecret: string): Promise<CachedToken> {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
    cache: 'no-store',
  })

  if (!response.ok) {
    // The body carries Shopify's own reason — a rotated secret, a client ID
    // belonging to a different shop — and none of that is guessable from 401.
    throw new ShopifyError(
      `Could not obtain a Shopify access token: ${response.status} ${response.statusText}`,
      await response.text().catch(() => undefined),
    )
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) {
    throw new ShopifyError('Shopify returned no access token', body)
  }

  // Default to an hour if Shopify ever stops sending expires_in. Treating a
  // missing expiry as "never expires" is the one wrong guess available here.
  const lifetimeMs = (body.expires_in ?? 3600) * 1000

  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + lifetimeMs,
  }
}

async function resolveToken(shop: string, clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - REFRESH_MARGIN_MS) {
    return cachedToken.accessToken
  }

  inFlight ??= mintToken(shop, clientId, clientSecret)
    .then((token) => {
      cachedToken = token
      return token
    })
    .finally(() => {
      inFlight = null
    })

  return (await inFlight).accessToken
}

/**
 * Configuration, or null when Shopify has not been connected yet.
 *
 * Null rather than throwing, because "not connected" is a legitimate state of
 * this application — the whole build runs against the seed CSVs until the
 * credentials arrive, and every screen has to work in the meantime.
 *
 * Async because the client-credentials path has to reach Shopify for a token.
 * A missing credential still returns null without a network call, so an
 * unconnected deployment costs nothing.
 */
export async function shopifyConfig(): Promise<ShopifyConfig | null> {
  const rawShop = process.env.SHOPIFY_SHOP_DOMAIN
  if (!rawShop) return null

  const shop = normaliseShop(rawShop)

  // A pasted permanent token wins, so an existing deployment keeps working
  // unchanged and there is a way back if the grant ever misbehaves.
  const staticToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
  if (staticToken) return { shop, accessToken: staticToken }

  const clientId = process.env.SHOPIFY_API_KEY
  const clientSecret = process.env.SHOPIFY_API_SECRET
  if (!clientId || !clientSecret) return null

  return { shop, accessToken: await resolveToken(shop, clientId, clientSecret) }
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
