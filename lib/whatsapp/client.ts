// Thin typed wrapper around the go-whatsapp-web-multidevice REST API.
// All device-scoped calls take a `deviceId` and inject it as `X-Device-Id`.
// Basic auth + base URL come from WHATSAPP_API_{URL,USER,PASS} env.

import { Agent, request, type Dispatcher } from 'undici'

type Envelope<T> = {
  code: string
  message: string
  results: T
}

export type LoginResult = {
  qr_duration: number
  qr_link: string
}

export type StatusResult = {
  is_connected: boolean
  is_logged_in: boolean
  device_id?: string
}

export type AddDeviceResult = {
  // The service returns this as `id` (UUID). Field name aligned with the
  // actual response body, not the OpenAPI spec which is out of date.
  id: string
  display_name?: string
  jid?: string
  state?: string
  created_at?: string
}

// Mirrors the `Chat` schema in whatsapp_swag.yaml. Group chats are identified
// by JID suffix (`@g.us`) — there's no dedicated `is_group` field.
export type ChatListItem = {
  jid: string
  name?: string
  last_message_time?: string
  ephemeral_expiration?: number
  created_at?: string
  updated_at?: string
  archived?: boolean
}

export type ChatListResult = {
  data?: ChatListItem[]
  pagination?: { limit?: number; offset?: number; total?: number }
}

export type ChatReaction = {
  emoji?: string
  sender_jid?: string
  is_from_me?: boolean
  timestamp?: string
}

// Mirrors the `ChatMessage` schema in whatsapp_swag.yaml.
export type ChatMessageItem = {
  id: string
  chat_jid: string
  sender_jid?: string
  content?: string
  timestamp?: string
  is_from_me?: boolean
  media_type?: string | null
  filename?: string | null
  url?: string | null
  file_length?: number | null
  reactions?: ChatReaction[]
  call_metadata?: string
  created_at?: string
  updated_at?: string
}

export type ChatMessagesResult = {
  data?: ChatMessageItem[]
  pagination?: { limit?: number; offset?: number; total?: number }
  chat_info?: ChatListItem
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env ${name}. Fill .env.local — see .env.example.`)
  return v
}

function authHeader(): string {
  const user = requireEnv('WHATSAPP_API_USER')
  const pass = requireEnv('WHATSAPP_API_PASS')
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
}

function baseUrl(): string {
  return requireEnv('WHATSAPP_API_URL').replace(/\/$/, '')
}

// Lazily build a single undici Agent that disables TLS verification when
// the user opts in. Reused across calls so we don't churn connection pools.
let insecureAgent: Dispatcher | undefined
function dispatcher(): Dispatcher | undefined {
  if (process.env.WHATSAPP_API_INSECURE_TLS !== '1') return undefined
  if (!insecureAgent) {
    insecureAgent = new Agent({ connect: { rejectUnauthorized: false } })
  }
  return insecureAgent
}

// Walk a thrown Error's `cause` chain — Node's fetch wraps the real network
// error inside a generic `TypeError: fetch failed`, which is useless on its own.
function describeCause(err: unknown): string {
  let cur: unknown = err
  const parts: string[] = []
  let depth = 0
  while (cur && depth < 5) {
    if (cur instanceof Error) {
      const code = (cur as Error & { code?: string }).code
      parts.push(`${cur.message}${code ? ` [${code}]` : ''}`)
      cur = (cur as Error & { cause?: unknown }).cause
      depth++
    } else {
      break
    }
  }
  return parts.join(' → ')
}

async function call<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  opts: { deviceId?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {},
): Promise<T> {
  const url = new URL(baseUrl() + path)
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null || v === '') continue
      url.searchParams.set(k, String(v))
    }
  }

  const headers: Record<string, string> = {
    Authorization: authHeader(),
    Accept: 'application/json',
  }
  if (opts.deviceId) headers['X-Device-Id'] = opts.deviceId
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  // Use undici's `request` directly rather than the global fetch:
  //   1) Next.js wraps the global fetch with its own undici, which can clash
  //      with the dispatcher we want to pass for self-signed TLS.
  //   2) `request` lets us disable redirect-following so we can manually
  //      re-issue with auth preserved (Node's fetch drops Authorization on
  //      cross-origin redirects, which is what happens when the server
  //      308s HTTP → HTTPS).
  let currentUrl = url.toString()
  let statusCode = 0
  let bodyText = ''
  let hops = 0
  while (true) {
    let res
    try {
      // No `maxRedirections` — undici's request doesn't follow redirects by
      // default, which is what we want; we handle 3xx manually below.
      res = await request(currentUrl, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        dispatcher: dispatcher(),
      })
    } catch (err) {
      throw new Error(
        `WhatsApp API ${method} ${currentUrl} failed before response: ${describeCause(err)}`,
      )
    }
    statusCode = res.statusCode
    // Follow 3xx ourselves so the Authorization header survives. Cap at 3
    // hops to avoid loops if the server redirects in a cycle.
    if (statusCode >= 300 && statusCode < 400 && hops < 3) {
      const loc = res.headers.location
      if (loc) {
        const next = Array.isArray(loc) ? loc[0] : loc
        currentUrl = new URL(next, currentUrl).toString()
        hops++
        // Drain the body so the connection can be reused.
        await res.body.text().catch(() => undefined)
        continue
      }
    }
    bodyText = await res.body.text()
    break
  }

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(
      `WhatsApp API ${method} ${path} → ${statusCode}: ${bodyText.slice(0, 500)}`,
    )
  }
  if (!bodyText) return undefined as T
  const parsed = JSON.parse(bodyText) as Envelope<T>
  return parsed.results
}

// Device management
export function addDevice(deviceId?: string): Promise<AddDeviceResult> {
  return call<AddDeviceResult>('POST', '/devices', { body: deviceId ? { device_id: deviceId } : {} })
}

export function removeDevice(deviceId: string): Promise<void> {
  return call<void>('DELETE', `/devices/${encodeURIComponent(deviceId)}`)
}

// We use the legacy `/app/*` endpoints with `X-Device-Id` rather than the
// newer `/devices/{id}/{login,status}` ones because the latter return
// "not implemented" on the deployed build. Behavior is equivalent — the
// header scopes the call to the device.
export function deviceStatus(deviceId: string): Promise<StatusResult> {
  return call<StatusResult>('GET', '/app/status', { deviceId })
}

export function deviceLogin(deviceId: string): Promise<LoginResult> {
  return call<LoginResult>('GET', '/app/login', { deviceId })
}

// Chats — device-scoped
export function listChats(
  deviceId: string,
  query: { limit?: number; offset?: number; search?: string; has_media?: boolean; archived?: boolean } = {},
): Promise<ChatListResult> {
  return call<ChatListResult>('GET', '/chats', { deviceId, query })
}

export function getChatMessages(
  deviceId: string,
  chatJid: string,
  query: {
    limit?: number
    offset?: number
    start_time?: string
    end_time?: string
    media_only?: boolean
    is_from_me?: boolean
    search?: string
  } = {},
): Promise<ChatMessagesResult> {
  // JIDs go into the path raw — encodeURIComponent would turn `@` into `%40`,
  // and this build of the service treats the encoded form as a literal and
  // returns "chat not found". `@` is legal in a path segment per RFC 3986.
  return call<ChatMessagesResult>('GET', `/chat/${chatJid}/messages`, {
    deviceId,
    query,
  })
}
