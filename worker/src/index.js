// Sync + leaderboard backend for the Greek cards PWA.
// Storage: one KV record per user, key = "u:" + sha256(code).
// Value = progress JSON, metadata = { n: name, s: stats, t: updated } (used by the leaderboard).

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O, 1/I/L
const CODE_LEN = 8;
const MAX_BODY = 4 * 1024 * 1024;
const STAT_KEYS = ['words', 'learned', 'mature', 'today', 'week', 'total', 'streak'];

export default {
	async fetch(req, env) {
		const headers = corsHeaders(req, env);
		if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
		const { pathname } = new URL(req.url);
		try {
			if (pathname === '/api/register' && req.method === 'POST') return await register(req, env, headers);
			if (pathname === '/api/me') {
				const me = await auth(req, env);
				if (!me) return json({ error: 'bad_code' }, 401, headers);
				if (req.method === 'GET') return json({ name: me.meta.n, data: me.value.data ?? null, updated: me.meta.t }, 200, headers);
				if (req.method === 'PUT') return await update(req, env, me, headers);
				if (req.method === 'DELETE') {
					await env.KV.delete(me.key);
					return json({ ok: true }, 200, headers);
				}
			}
			if (pathname === '/api/board' && req.method === 'GET') {
				const me = await auth(req, env);
				if (!me) return json({ error: 'bad_code' }, 401, headers);
				return await board(env, me, headers);
			}
			if (pathname === '/' || pathname === '/api') return json({ ok: true, service: 'greek-cards-sync' }, 200, headers);
			return json({ error: 'not_found' }, 404, headers);
		} catch (e) {
			return json({ error: 'server', detail: String(e?.message || e) }, 500, headers);
		}
	},
};

function corsHeaders(req, env) {
	const origin = req.headers.get('Origin');
	const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
	const h = {
		'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
		'Access-Control-Allow-Headers': 'Authorization,Content-Type',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
	};
	if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
	return h;
}

function json(data, status, headers) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
	});
}

function genCode() {
	const out = [];
	const buf = new Uint8Array(16);
	const limit = 256 - (256 % CODE_ALPHABET.length); // rejection sampling, no modulo bias
	while (out.length < CODE_LEN) {
		crypto.getRandomValues(buf);
		for (const b of buf) {
			if (b < limit) out.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
			if (out.length === CODE_LEN) break;
		}
	}
	return out.join('');
}

const normCode = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

async function keyFor(code) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`greek-cards:${code}`));
	return 'u:' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 24);

function cleanStats(s) {
	if (!s || typeof s !== 'object') return null;
	const out = {};
	for (const k of STAT_KEYS) {
		const v = Number(s[k]);
		out[k] = Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 1e7) : 0;
	}
	out.day = /^\d{4}-\d{2}-\d{2}$/.test(String(s.day)) ? String(s.day) : '';
	return out;
}

async function readJson(req) {
	const text = await req.text();
	if (text.length > MAX_BODY) throw Object.assign(new Error('too_large'), { status: 413 });
	return text ? JSON.parse(text) : {};
}

async function auth(req, env) {
	const code = normCode((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
	if (code.length !== CODE_LEN) return null;
	const key = await keyFor(code);
	const { value, metadata } = await env.KV.getWithMetadata(key, 'json');
	if (!value) return null;
	return { key, value, meta: metadata || {} };
}

async function countUsers(env) {
	let n = 0;
	let cursor;
	do {
		const page = await env.KV.list({ prefix: 'u:', cursor });
		n += page.keys.length;
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
	return n;
}

async function register(req, env, headers) {
	const body = await readJson(req);
	const name = cleanName(body.name);
	if (!name) return json({ error: 'name_required' }, 400, headers);
	if ((await countUsers(env)) >= Number(env.MAX_USERS || 30)) return json({ error: 'too_many_users' }, 403, headers);
	let code, key;
	for (let i = 0; i < 5; i++) {
		code = genCode();
		key = await keyFor(code);
		if (!(await env.KV.get(key))) break;
	}
	const now = Date.now();
	await env.KV.put(key, JSON.stringify({ data: null, created: now }), { metadata: { n: name, s: cleanStats({}), t: now } });
	return json({ code, name }, 200, headers);
}

async function update(req, env, me, headers) {
	let body;
	try {
		body = await readJson(req);
	} catch (e) {
		return json({ error: e.status === 413 ? 'too_large' : 'bad_json' }, e.status || 400, headers);
	}
	const value = { ...me.value };
	if (body.data !== undefined) value.data = body.data;
	const meta = {
		n: cleanName(body.name) || me.meta.n || 'Без имени',
		s: cleanStats(body.stats) || me.meta.s || cleanStats({}),
		t: Date.now(),
	};
	await env.KV.put(me.key, JSON.stringify(value), { metadata: meta });
	return json({ ok: true, updated: meta.t, name: meta.n }, 200, headers);
}

async function board(env, me, headers) {
	const rows = [];
	let cursor;
	do {
		const page = await env.KV.list({ prefix: 'u:', cursor });
		for (const k of page.keys) {
			const m = k.metadata || {};
			rows.push({ name: m.n || '—', stats: m.s || {}, updated: m.t || 0, me: k.name === me.key });
		}
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);
	return json({ users: rows }, 200, headers);
}
