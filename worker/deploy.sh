#!/usr/bin/env bash
# Deploy the sync worker to Cloudflare and write its URL into ../config.js.
# Run on the Mac: cd ~/greek/app/worker && ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v npx >/dev/null; then
	echo "Нужен Node.js: brew install node" >&2
	exit 1
fi

W=(npx --yes wrangler@4)

if "${W[@]}" whoami 2>&1 | grep -qi "not authenticated"; then
	echo "→ Вход в Cloudflare (откроется браузер)…"
	"${W[@]}" login
fi

if grep -q 'id = "REPLACE_ME"' wrangler.toml; then
	echo "→ Создаю хранилище KV…"
	kv_out=$("${W[@]}" kv namespace create greek-cards-sync 2>&1 || true)
	kv_id=$(printf '%s' "$kv_out" | grep -oE '[0-9a-f]{32}' | head -1 || true)
	if [ -z "$kv_id" ]; then
		echo "$kv_out" >&2
		echo "Не удалось создать KV namespace" >&2
		exit 1
	fi
	sed -i.bak "s/REPLACE_ME/$kv_id/" wrangler.toml && rm -f wrangler.toml.bak
fi

echo "→ Деплой…"
log=$(mktemp)
# `script` keeps a TTY so wrangler can ask to register a workers.dev subdomain on first deploy
if [ "$(uname)" = "Darwin" ]; then
	script -q "$log" "${W[@]}" deploy
else
	script -q -c "${W[*]} deploy" "$log"
fi
url=$(grep -aoE 'https://[a-z0-9.-]+\.workers\.dev' "$log" | head -1 || true)
rm -f "$log"

if [ -z "$url" ]; then
	echo "Не нашёл URL воркера в выводе wrangler — пришли мне вывод выше." >&2
	exit 1
fi

echo "window.GK_API = '$url';" > ../config.js
echo
echo "Готово: $url"
echo "Записал адрес в config.js — напиши Claude, он закоммитит и запушит."
