import { request as undiciRequest } from 'undici'

/**
 * Proxies the WhatsApp QR image from the internal Docker service to the
 * browser.  The WhatsApp container is only reachable inside the Docker
 * network (`http://whatsapp:2777`), so the browser can't load the QR
 * image directly — this route streams it through.
 *
 * Usage: GET /api/whatsapp-qr?url=<encoded-internal-url>
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const target = searchParams.get('url')

  if (!target) {
    return new Response('Missing ?url param', { status: 400 })
  }

  // Only allow proxying URLs from the configured WhatsApp API base to prevent
  // this endpoint from becoming an open proxy.
  const allowed = (process.env.WHATSAPP_API_URL ?? '').replace(/\/$/, '')
  if (!allowed || !target.startsWith(allowed)) {
    return new Response('Forbidden', { status: 403 })
  }

  const user = process.env.WHATSAPP_API_USER ?? ''
  const pass = process.env.WHATSAPP_API_PASS ?? ''

  const res = await undiciRequest(target, {
    method: 'GET',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'),
    },
  })

  const body = Buffer.from(await res.body.arrayBuffer())

  return new Response(body, {
    status: res.statusCode,
    headers: {
      'Content-Type': res.headers['content-type']?.toString() ?? 'image/png',
      'Cache-Control': 'no-store',
    },
  })
}
