const DEFAULT_ALLOW_HEADERS = [
  'authorization',
  'x-client-info',
  'apikey',
  'content-type',
  'stripe-signature',
  'x-razorpay-signature',
  'x-menuverse-internal-secret',
].join(', ');

const MENUVERSE_PRODUCTION_ORIGINS = [
  'https://menu-verse-admin.vercel.app',
  'https://menu-verse.vercel.app',
];

function normalizeOrigin(origin: string | null) {
  return (origin || '').trim().replace(/\/$/, '');
}

function vercelOrigin() {
  const raw = Deno.env.get('VERCEL_DEPLOYMENT_URL') || Deno.env.get('VERCEL_URL') || '';
  if (!raw) return '';
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

function configuredOrigins() {
  const explicit = Deno.env.get('ALLOWED_ORIGINS');
  const source = [
    explicit,
    Deno.env.get('APP_ORIGIN'),
    Deno.env.get('CUSTOMER_APP_URL'),
    vercelOrigin(),
    Deno.env.get('SUPABASE_URL'),
    ...MENUVERSE_PRODUCTION_ORIGINS,
  ].filter(Boolean).join(',');

  return new Set(
    source
      .split(',')
      .map((origin) => normalizeOrigin(origin))
      .filter(Boolean),
  );
}

export function corsHeadersFor(req: Request, extraHeaders: Record<string, string> = {}) {
  const requestOrigin = normalizeOrigin(req.headers.get('Origin'));
  const allowedOrigins = configuredOrigins();
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Headers': DEFAULT_ALLOW_HEADERS,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    ...extraHeaders,
  };

  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
  }

  return headers;
}

export function jsonResponse(req: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeadersFor(req) });
}

export function preflightResponse(req: Request) {
  return new Response(null, { status: 204, headers: corsHeadersFor(req) });
}
