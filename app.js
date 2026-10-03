'use strict';

/* Greek flashcards PWA: FSRS scheduling (ts-fsrs), progress in localStorage. */

const { fsrs, generatorParameters, createEmptyCard, Rating, State } = window.FSRS;

const LS = { cards: 'gk.cards.v1', log: 'gk.log.v1', settings: 'gk.settings.v1', extra: 'gk.extra.v1', account: 'gk.account.v1' };
const DAY_START_HOUR = 4; // new day starts at 04:00 local time
const LEARN_AHEAD_MS = 20 * 60 * 1000;
const ARTICLES = ['ο', 'η', 'το'];
const DECK_TYPES = { vocab: ['el_ru', 'ru_el', 'article'], phrases: ['el_ru', 'ru_el'], reading: ['el_ru'], rules: ['el_ru'] };
const DECK_ORDER = { vocab: 0, phrases: 0, reading: 1, rules: 2 };
const TYPE_ORDER = { el_ru: 0, article: 1, ru_el: 2 };
const TYPE_LABEL = { el_ru: 'Переведи', ru_el: 'Как по-гречески?', article: 'Выбери артикль' };
const TYPE_SHORT = { el_ru: 'el→ru', ru_el: 'ru→el', article: 'артикль' };
const GRADES = [
	{ r: Rating.Again, key: 'again', label: 'Снова' },
	{ r: Rating.Hard, key: 'hard', label: 'Трудно' },
	{ r: Rating.Good, key: 'good', label: 'Хорошо' },
	{ r: Rating.Easy, key: 'easy', label: 'Легко' },
];
const DEFAULT_SETTINGS = {
	newPerDay: 15,
	decks: { vocab: true, phrases: true, reading: true, rules: false },
	types: { el_ru: true, ru_el: true, article: true },
	typing: true,
	autoplay: true,
	rate: 0.85,
	voice: '',
	retention: 0.9,
};

/* ---------- storage ---------- */

const store = {
	get(key, def) {
		try {
			const v = localStorage.getItem(key);
			return v ? JSON.parse(v) : def;
		} catch {
			return def;
		}
	},
	set(key, val) {
		try {
			localStorage.setItem(key, JSON.stringify(val));
			return true;
		} catch {
			toast('Не удалось сохранить прогресс');
			return false;
		}
	},
};

function loadSettings() {
	const s = store.get(LS.settings, {});
	return {
		...DEFAULT_SETTINGS,
		...s,
		decks: { ...DEFAULT_SETTINGS.decks, ...(s.decks || {}) },
		types: { ...DEFAULT_SETTINGS.types, ...(s.types || {}) },
	};
}

let SETTINGS = loadSettings();
let CARDS = store.get(LS.cards, {});
let LOG = store.get(LS.log, []);
let DATA = { lessons: {}, decks: {}, words: [] };
let NOTES = [];
let WORDS = new Map();
let F = makeScheduler();

function makeScheduler() {
	return fsrs(generatorParameters({ enable_fuzz: true, request_retention: SETTINGS.retention }));
}

function saveSettings() {
	store.set(LS.settings, SETTINGS);
	DIRTY = true;
	F = makeScheduler();
}

function saveProgress() {
	store.set(LS.cards, CARDS);
	if (LOG.length > 20000) LOG = LOG.slice(-20000);
	store.set(LS.log, LOG);
}

/* ---------- time helpers ---------- */

function dayStart(ts = Date.now()) {
	const d = new Date(ts);
	d.setHours(DAY_START_HOUR, 0, 0, 0);
	if (d.getTime() > ts) d.setDate(d.getDate() - 1);
	return d.getTime();
}
const nextDayStart = (ts = Date.now()) => dayStart(ts) + 86400000;
function dayKey(ts) {
	const d = new Date(dayStart(ts));
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtInterval(ms) {
	const m = ms / 60000;
	if (m < 1) return '<1 мин';
	if (m < 60) return `${Math.round(m)} мин`;
	const h = m / 60;
	if (h < 24) return `${Math.round(h)} ч`;
	const d = h / 24;
	if (d < 30) return `${Math.round(d)} д`;
	const mo = d / 30;
	if (mo < 12) return `${String(Math.round(mo * 10) / 10).replace('.', ',')} мес`;
	return `${String(Math.round((d / 365) * 10) / 10).replace('.', ',')} г`;
}

/* ---------- text helpers ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function norm(s) {
	return String(s)
		.normalize('NFC')
		.toLowerCase()
		.replace(/[.,;:!?·;«»"“”„'’‘()…‐-―-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function bare(s) {
	return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ς/g, 'σ').normalize('NFC');
}

const withArt = (w) => (w.art ? `${w.art} ${w.el}` : w.el);
const isGreekText = (w) => w.deck !== 'rules';

/* ---------- cards ---------- */

function typesFor(w) {
	return DECK_TYPES[w.deck].filter((t) => {
		if (w.deck === 'vocab' || w.deck === 'phrases') {
			if (!SETTINGS.types[t]) return false;
		}
		if (t === 'article') return ARTICLES.includes(w.art);
		return true;
	});
}

function allCards() {
	const out = [];
	DATA.words.forEach((w, idx) => {
		if (!SETTINGS.decks[w.deck]) return;
		for (const t of typesFor(w)) out.push({ id: `${w.id}|${t}`, w, type: t, idx });
	});
	return out;
}

function cardState(id) {
	const c = CARDS[id];
	return c ? c.state : State.New;
}

function firstSeenMap() {
	const m = new Map();
	for (const l of LOG) if (!m.has(l.c)) m.set(l.c, l.t);
	return m;
}

function wordStartedBefore(wordId, ts, firstSeen) {
	const id = `${wordId}|el_ru`;
	const c = CARDS[id];
	if (!c || c.state === State.New) return false;
	const t = firstSeen.get(id);
	return t !== undefined ? t < ts : Date.parse(c.last_review || c.due) < ts;
}

function todayLog() {
	const from = dayStart();
	return LOG.filter((l) => l.t >= from);
}

function newLimitToday() {
	const extra = store.get(LS.extra, {});
	return SETTINGS.newPerDay + (extra[dayKey(Date.now())] || 0);
}

function computeQueue(now = Date.now()) {
	const tLog = todayLog();
	const newDone = tLog.filter((l) => l.s === State.New).length;
	const touchedWords = new Set(tLog.map((l) => l.c.split('|')[0]));
	const endOfDay = nextDayStart(now);
	const today0 = dayStart(now);
	const learnNow = [], learnSoon = [], learnLater = [], review = [], fresh = [];

	for (const c of allCards()) {
		const st = CARDS[c.id];
		if (!st || st.state === State.New) {
			fresh.push(c);
			continue;
		}
		const due = Date.parse(st.due);
		if (st.state === State.Learning || st.state === State.Relearning) {
			if (due <= now) learnNow.push(c);
			else if (due <= now + LEARN_AHEAD_MS) learnSoon.push(c);
			else if (due < endOfDay) learnLater.push(c);
		} else if (due < endOfDay) {
			review.push(c);
		}
	}

	const byDue = (a, b) => Date.parse(CARDS[a.id].due) - Date.parse(CARDS[b.id].due);
	learnNow.sort(byDue);
	learnSoon.sort(byDue);
	learnLater.sort(byDue);
	review.sort(byDue);

	// bury siblings: one card per word per day (learning steps of the same card are fine)
	const reviewOk = review.filter((c) => !touchedWords.has(c.w.id) || tLog.some((l) => l.c === c.id));
	const reviewWords = new Set();
	const reviewQ = [];
	for (const c of reviewOk) {
		if (reviewWords.has(c.w.id)) continue;
		reviewWords.add(c.w.id);
		reviewQ.push(c);
	}

	const busy = new Set([...touchedWords, ...reviewWords, ...learnNow.map((c) => c.w.id), ...learnSoon.map((c) => c.w.id)]);
	const firstSeen = firstSeenMap();
	const freshOk = fresh
		.filter((c) => c.type === 'el_ru' || wordStartedBefore(c.w.id, today0, firstSeen))
		.sort((a, b) =>
			DECK_ORDER[a.w.deck] - DECK_ORDER[b.w.deck] ||
			b.w.lesson - a.w.lesson ||
			a.idx - b.idx ||
			TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
	const newLeft = Math.max(0, newLimitToday() - newDone);
	const newQ = [];
	const newWords = new Set();
	for (const c of freshOk) {
		if (newQ.length >= newLeft) break;
		if (busy.has(c.w.id) || newWords.has(c.w.id)) continue;
		newWords.add(c.w.id);
		newQ.push(c);
	}

	return {
		learnNow, learnSoon, learnLater, review: reviewQ, fresh: newQ,
		freshTotal: fresh.length, newDone, newLeft,
		counts: { learn: learnNow.length + learnSoon.length, review: reviewQ.length, fresh: newQ.length },
	};
}

function pickNext(q) {
	if (q.learnNow.length) return q.learnNow[0];
	if (q.review.length) return q.review[0];
	if (q.fresh.length) return q.fresh[0];
	if (q.learnSoon.length) return q.learnSoon[0];
	return null;
}

function rateCard(cardRef, rating) {
	const now = new Date();
	const prev = CARDS[cardRef.id];
	const input = prev ? { ...prev } : createEmptyCard(now);
	const { card } = F.next(input, now, rating);
	UNDO = { id: cardRef.id, prev, logLen: LOG.length };
	CARDS[cardRef.id] = JSON.parse(JSON.stringify(card));
	LOG.push({ c: cardRef.id, r: rating, t: now.getTime(), s: prev ? prev.state : State.New });
	saveProgress();
}

let UNDO = null;
function undo() {
	if (!UNDO) return false;
	if (UNDO.prev) CARDS[UNDO.id] = UNDO.prev;
	else delete CARDS[UNDO.id];
	LOG.length = UNDO.logLen;
	saveProgress();
	UNDO = null;
	return true;
}

function previews(cardRef) {
	const now = new Date();
	const prev = CARDS[cardRef.id];
	const rec = F.repeat(prev ? { ...prev } : createEmptyCard(now), now);
	const out = {};
	for (const g of GRADES) out[g.r] = fmtInterval(rec[g.r].card.due.getTime() - now.getTime());
	return out;
}

/* ---------- answer checking ---------- */

function checkAnswer(input, w) {
	const u = norm(input);
	if (!u) return { verdict: 'empty' };
	const bases = [w.el, ...(w.alts || [])].map(norm);
	const arts = w.art === 'ο/η' ? ['ο', 'η'] : w.art ? [w.art] : [];
	const full = arts.length ? bases.flatMap((b) => arts.map((a) => `${a} ${b}`)) : bases;
	if (full.includes(u)) return { verdict: 'ok' };
	if (full.map(bare).includes(bare(u))) return { verdict: 'accent' };
	if (arts.length) {
		if (bases.includes(u)) return { verdict: 'article' };
		if (bases.map(bare).includes(bare(u))) return { verdict: 'accent', noArt: true };
		const m = u.match(/^(ο|η|το|τα|οι|τον|την)\s+(.+)$/);
		if (m && bases.map(bare).includes(bare(m[2]))) return { verdict: 'wrongArt' };
	}
	return { verdict: 'wrong' };
}

const VERDICTS = {
	ok: { cls: 'ok', text: 'Верно', grade: Rating.Good },
	accent: { cls: 'warn', text: 'Почти: проверь ударение', grade: Rating.Hard },
	article: { cls: 'warn', text: 'Верно, но без артикля', grade: Rating.Hard },
	wrongArt: { cls: 'warn', text: 'Слово верно, артикль нет', grade: Rating.Hard },
	wrong: { cls: 'bad', text: 'Неверно', grade: Rating.Again },
	empty: { cls: 'bad', text: 'Не вспомнил', grade: Rating.Again },
};

/* ---------- speech ---------- */

let VOICES = [];
// iOS also ships novelty/Eloquence voices; never pick them automatically
const ODD_VOICES = /\b(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox)\b/i;
function greekVoices() {
	if (!('speechSynthesis' in window)) return [];
	return speechSynthesis.getVoices().filter((v) => (v.lang || '').toLowerCase().replace('_', '-').startsWith('el') && !ODD_VOICES.test(v.name));
}
function loadVoices() {
	const had = VOICES.length;
	VOICES = greekVoices();
	// Safari fills the list late: redraw settings once voices appear
	if (!had && VOICES.length && TAB === 'stats' && !SUBVIEW && document.getElementById('voice-row')) renderStats();
}
if ('speechSynthesis' in window) {
	// Safari doesn't reliably fire `voiceschanged` via addEventListener — use the property and poll a bit
	speechSynthesis.onvoiceschanged = loadVoices;
	[0, 300, 1000, 3000].forEach((ms) => setTimeout(loadVoices, ms));
}

function voiceLabel(v) {
	const id = `${v.voiceURI} ${v.name}`;
	const q = /premium/i.test(id) ? ' — премиум' : /enhanced/i.test(id) ? ' — улучшенный' : /compact/i.test(id) ? ' — компактный' : '';
	return v.name + q;
}

/** Fresh voice object every time: Safari ignores stale SpeechSynthesisVoice objects. */
function pickVoice() {
	if (!SETTINGS.voice) return null;
	const list = greekVoices();
	return list.find((v) => v.voiceURI === SETTINGS.voice) || list.find((v) => v.name === SETTINGS.voiceName) || null;
}

function speak(text) {
	if (!('speechSynthesis' in window) || !text) return;
	const synth = window.speechSynthesis;
	try {
		// iOS Safari mutes web audio when the silent switch is on; 'playback' behaves like a media app
		if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
	} catch {}
	if (synth.speaking || synth.pending) synth.cancel();
	if (synth.paused) synth.resume(); // iOS sometimes leaves the queue paused after backgrounding
	const clean = String(text).replace(/\s+/g, ' ').trim();
	// long texts are split into sentences: iOS may cut off very long utterances
	const parts = clean.length > 180 ? clean.match(/[^.!;;…]+[.!;;…]*/g) || [clean] : [clean];
	// only force a voice the user picked explicitly; otherwise iOS uses its default Greek voice
	const voice = pickVoice();
	for (const part of parts) {
		const u = new SpeechSynthesisUtterance(part.trim());
		u.lang = 'el-GR';
		u.rate = SETTINGS.rate;
		if (voice) {
			u.voice = voice;
			u.lang = voice.lang;
		}
		synth.speak(u);
	}
}

const SPEAKER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h3.5L12 5v14l-4.5-4H4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const speakBtn = (text, label = 'Озвучить') => `<button class="icon-btn" data-speak="${esc(text)}" aria-label="${label}">${SPEAKER_SVG}</button>`;

document.addEventListener('click', (e) => {
	const b = e.target.closest('[data-speak]');
	if (b) {
		e.stopPropagation();
		speak(b.dataset.speak);
	}
}, true);

/* ---------- ui helpers ---------- */

const $view = document.getElementById('view');
const $title = document.getElementById('view-title');
const $session = document.getElementById('session');
let TAB = 'learn';
let SUBVIEW = null;

function toast(msg) {
	const t = document.getElementById('toast');
	t.textContent = msg;
	t.classList.add('show');
	clearTimeout(toast.timer);
	toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function setTitle(text, back) {
	$title.textContent = text;
	const bar = $title.parentElement;
	bar.classList.toggle('sub', Boolean(back));
	bar.querySelector('.back')?.remove();
	if (back) {
		const b = document.createElement('button');
		b.className = 'back';
		b.textContent = '‹ Назад';
		b.onclick = back;
		bar.prepend(b);
	}
}

function lessonLabel(n) {
	const d = DATA.lessons?.[n];
	return d ? `Урок ${n} · ${d}` : `Урок ${n}`;
}

function wordStatus(w) {
	const ids = DECK_TYPES[w.deck].map((t) => `${w.id}|${t}`).filter((id) => CARDS[id]);
	if (!ids.length) return { cls: 'new', text: 'новое' };
	const cs = ids.map((id) => CARDS[id]);
	if (cs.some((c) => c.state === State.Learning || c.state === State.Relearning)) return { cls: 'learning', text: 'учу' };
	const due = Math.min(...cs.map((c) => Date.parse(c.due)));
	const ms = due - Date.now();
	return { cls: 'review', text: ms <= 0 ? 'повторить' : `через ${fmtInterval(ms)}` };
}

/* ---------- tabs ---------- */

function showTab(tab) {
	TAB = tab;
	SUBVIEW = null;
	document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
	({ learn: renderLearn, dict: renderDict, notes: renderNotes, stats: renderStats })[tab]();
	window.scrollTo(0, 0);
}

document.querySelectorAll('.tabbar button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

/* ---------- learn tab ---------- */

function renderLearn() {
	setTitle('Учить');
	const q = computeQueue();
	const total = allCards().length;
	const started = allCards().filter((c) => CARDS[c.id]).length;
	const pct = total ? Math.round((started / total) * 100) : 0;
	const nothing = !q.counts.learn && !q.counts.review && !q.counts.fresh;
	let later = '';
	if (nothing && q.learnLater.length) {
		later = `<p class="muted small">Ещё ${q.learnLater.length} в изучении — вернись через ${fmtInterval(Date.parse(CARDS[q.learnLater[0].id].due) - Date.now())}</p>`;
	}
	$view.innerHTML = `
		<div class="card hero">
			<div class="counts">
				<div><div class="num c-new">${q.counts.fresh}</div><div class="lbl">новые</div></div>
				<div><div class="num c-learn">${q.counts.learn}</div><div class="lbl">учу</div></div>
				<div><div class="num c-due">${q.counts.review}</div><div class="lbl">повторить</div></div>
			</div>
			${nothing ? `<div class="done-msg">На сегодня всё</div>${later}` : ''}
			<button class="btn primary block" id="start" ${nothing ? 'disabled' : ''}>Начать</button>
			${nothing && q.freshTotal ? '<button class="btn ghost" id="more">Ещё 10 новых</button>' : ''}
		</div>
		<div class="card">
			<div class="row"><div class="grow"><b>Начато карточек</b></div><div class="muted">${started} из ${total}</div></div>
			<div class="progressbar" style="margin-top:10px"><i style="width:${pct}%"></i></div>
			<p class="muted small" style="margin:10px 0 0">Новых сегодня: ${q.newDone} из ${newLimitToday()}. Колоды: ${Object.keys(DATA.decks).filter((d) => SETTINGS.decks[d]).map((d) => DATA.decks[d]).join(', ')}.</p>
		</div>
		${renderLessonSummary()}
	`;
	if (API && !ACCOUNT && !store.get(LS.account + '.hint', false)) {
		$view.insertAdjacentHTML('afterbegin', `<div class="card banner">
			<div class="grow small">Создай личный код в «Прогрессе» — прогресс сохранится на сервере и появится в рейтинге группы.</div>
			<button class="btn ghost" id="hint-go">Создать</button><button class="icon-btn close" id="hint-x" aria-label="Скрыть">×</button>
		</div>`);
		document.getElementById('hint-go').onclick = () => showTab('stats');
		document.getElementById('hint-x').onclick = () => {
			store.set(LS.account + '.hint', true);
			renderLearn();
		};
	}
	document.getElementById('start')?.addEventListener('click', startSession);
	document.getElementById('more')?.addEventListener('click', () => {
		const extra = store.get(LS.extra, {});
		const k = dayKey(Date.now());
		extra[k] = (extra[k] || 0) + 10;
		store.set(LS.extra, extra);
		renderLearn();
	});
}

function renderLessonSummary() {
	const by = {};
	for (const c of allCards()) {
		const l = (by[c.w.lesson] ||= { total: 0, started: 0 });
		l.total++;
		if (CARDS[c.id]) l.started++;
	}
	const rows = Object.keys(by).sort((a, b) => b - a).map((n) => {
		const l = by[n];
		const pct = Math.round((l.started / l.total) * 100);
		return `<div style="margin:10px 0"><div class="row small"><div class="grow">${esc(lessonLabel(n))}</div><div class="muted">${l.started}/${l.total}</div></div><div class="progressbar" style="margin-top:6px"><i style="width:${pct}%"></i></div></div>`;
	}).join('');
	return `<div class="section-title">По урокам</div><div class="card">${rows}</div>`;
}

/* ---------- session ---------- */

let CUR = null; // { card, phase, verdict, input }

function startSession() {
	$session.hidden = false;
	document.body.style.overflow = 'hidden';
	nextCard();
}

function endSession() {
	$session.hidden = true;
	document.body.style.overflow = '';
	speechSynthesis?.cancel?.();
	CUR = null;
	showTab('learn');
	sync();
}

function nextCard() {
	const q = computeQueue();
	const c = pickNext(q);
	if (!c) {
		renderSessionDone(q);
		return;
	}
	CUR = { card: c, phase: 'front', q };
	renderCard();
	if (SETTINGS.autoplay && c.type === 'el_ru' && isGreekText(c.w)) speak(withArt(c.w));
}

function sessionTop(q) {
	const left = q.counts.learn + q.counts.review + q.counts.fresh;
	return `<div class="s-top">
		<button id="s-close">Закрыть</button>
		<div class="s-count">осталось ${left}</div>
		<button id="s-undo" ${UNDO ? '' : 'disabled style="opacity:.35"'}>Отменить</button>
	</div>`;
}

function backSide(w, { showEl = true } = {}) {
	return `
		<div class="divider"></div>
		<div class="face">
			${showEl ? `<div class="big el ${withArt(w).length > 18 ? 'long' : ''}">${esc(withArt(w))}</div>` : ''}
			${w.tr ? `<div class="tr">[${esc(w.tr)}]</div>` : ''}
			<div class="mid" style="margin-top:8px">${esc(w.ru)}</div>
			${w.note ? `<div class="note">${esc(w.note)}</div>` : ''}
			<div class="note small">${esc(lessonLabel(w.lesson))}</div>
			${isGreekText(w) ? `<div class="speak-row">${speakBtn(withArt(w))}</div>` : ''}
		</div>`;
}

function gradeButtons(card, suggested) {
	const pv = previews(card);
	return `<div class="grades">${GRADES.map((g) => `
		<button class="grade ${g.key} ${suggested === g.r ? 'suggested' : ''}" data-grade="${g.r}">
			<b>${g.label}</b><span>${pv[g.r]}</span>
		</button>`).join('')}</div>`;
}

function renderCard() {
	const { card, phase, q } = CUR;
	const w = card.w;
	const long = withArt(w).length > 18;
	let body = '';
	let actions = '';
	const tag = `<div class="qtype"><b>${TYPE_LABEL[card.type]}</b> · ${esc(DATA.decks[w.deck] || '')}</div>`;

	if (card.type === 'el_ru') {
		body = `${tag}<div class="face">
			<div class="big el ${long ? 'long' : ''}">${esc(withArt(w))}</div>
			${phase === 'front' && isGreekText(w) ? `<div class="speak-row">${speakBtn(withArt(w))}</div>` : ''}
		</div>`;
		if (phase === 'front') actions = '<button class="btn primary block" id="show">Показать ответ</button>';
		else {
			body += backSide(w, { showEl: false });
			actions = gradeButtons(card);
		}
	} else if (card.type === 'ru_el') {
		body = `${tag}<div class="face"><div class="mid" style="font-size:26px">${esc(w.ru)}</div></div>`;
		if (phase === 'front') {
			if (SETTINGS.typing) {
				body += `<div style="margin-top:22px"><input class="answer-input el" id="answer" lang="el" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="по-гречески…" enterkeyhint="done"></div>`;
				actions = `<div class="two-btns"><button class="btn" id="dunno">Не помню</button><button class="btn primary" id="check">Проверить</button></div>`;
			} else {
				actions = '<button class="btn primary block" id="show">Показать ответ</button>';
			}
		} else {
			const v = CUR.verdict ? VERDICTS[CUR.verdict.verdict] : null;
			if (v) {
				const yours = CUR.input && CUR.verdict.verdict !== 'ok' ? `<span class="yours">${esc(CUR.input)}</span>` : '';
				body += `<div class="verdict ${v.cls}">${v.text}${yours}</div>`;
			}
			body += backSide(w);
			actions = gradeButtons(card, v ? v.grade : undefined);
		}
	} else if (card.type === 'article') {
		body = `${tag}<div class="face">
			<div class="big el"><span class="art-blank">${phase === 'front' ? '___' : esc(w.art)}</span> ${esc(w.el)}</div>
			<div class="mid muted" style="margin-top:8px">${esc(w.ru)}</div>
		</div>`;
		const chosen = CUR.chosen;
		actions = `<div class="art-options">${ARTICLES.map((a) => {
			let cls = '';
			if (phase !== 'front') {
				if (a === w.art) cls = 'right';
				else if (a === chosen) cls = 'wrong';
			}
			return `<button class="el ${cls}" data-art="${a}" ${phase !== 'front' ? 'disabled' : ''}>${a}</button>`;
		}).join('')}</div>`;
		if (phase !== 'front') {
			if (w.note) body += `<div class="note">${esc(w.note)}</div>`;
			body += `<div class="speak-row">${speakBtn(withArt(w))}</div>`;
			actions += '<button class="btn primary block" id="next" style="margin-top:12px">Дальше</button>';
		}
	}

	$session.innerHTML = `${sessionTop(q)}<div class="s-body">${body}</div><div class="s-actions">${actions}</div>`;
	bindSession();
}

function bindSession() {
	const w = CUR.card.w;
	$session.querySelector('#s-close').onclick = endSession;
	const u = $session.querySelector('#s-undo');
	if (u && UNDO) u.onclick = () => {
		if (undo()) {
			toast('Последняя оценка отменена');
			nextCard();
		}
	};
	$session.querySelector('#show')?.addEventListener('click', reveal);
	const input = $session.querySelector('#answer');
	if (input) {
		setTimeout(() => input.focus(), 50);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				check();
			}
		});
	}
	$session.querySelector('#check')?.addEventListener('click', check);
	$session.querySelector('#dunno')?.addEventListener('click', () => {
		CUR.input = '';
		CUR.verdict = { verdict: 'empty' };
		reveal();
	});
	$session.querySelectorAll('[data-grade]').forEach((b) => (b.onclick = () => grade(Number(b.dataset.grade))));
	$session.querySelectorAll('[data-art]').forEach((b) => (b.onclick = () => {
		CUR.chosen = b.dataset.art;
		const ok = b.dataset.art === w.art;
		rateCard(CUR.card, ok ? Rating.Good : Rating.Again);
		maybeSyncDuringSession();
		CUR.phase = 'back';
		renderCard();
		if (SETTINGS.autoplay) speak(withArt(w));
	}));
	$session.querySelector('#next')?.addEventListener('click', nextCard);
}

function check() {
	const input = $session.querySelector('#answer');
	CUR.input = input ? input.value.trim() : '';
	CUR.verdict = checkAnswer(CUR.input, CUR.card.w);
	reveal();
}

function reveal() {
	CUR.phase = 'back';
	renderCard();
	const w = CUR.card.w;
	if (SETTINGS.autoplay && CUR.card.type === 'ru_el' && isGreekText(w)) speak(withArt(w));
}

function grade(r) {
	rateCard(CUR.card, r);
	maybeSyncDuringSession();
	nextCard();
}

function renderSessionDone(q) {
	const later = q.learnLater.length
		? `<p class="muted">Ещё ${q.learnLater.length} в изучении — вернись через ${fmtInterval(Date.parse(CARDS[q.learnLater[0].id].due) - Date.now())}.</p>`
		: '<p class="muted">Следующие повторения — завтра.</p>';
	const tLog = todayLog();
	$session.innerHTML = `${sessionTop(q)}<div class="s-body"><div class="face">
		<div class="big">Готово</div>
		<p>Сегодня: ${tLog.length} ответов, ${tLog.filter((l) => l.s === State.New).length} новых карточек.</p>
		${later}
	</div></div><div class="s-actions"><button class="btn primary block" id="s-finish">К началу</button></div>`;
	$session.querySelector('#s-close').onclick = endSession;
	$session.querySelector('#s-finish').onclick = endSession;
	const u = $session.querySelector('#s-undo');
	if (u && UNDO) u.onclick = () => {
		if (undo()) nextCard();
	};
}

document.addEventListener('keydown', (e) => {
	if ($session.hidden || !CUR) return;
	if (e.target.tagName === 'INPUT') return;
	if (CUR.phase === 'front' && (e.key === ' ' || e.key === 'Enter')) {
		e.preventDefault();
		$session.querySelector('#show, #check')?.click();
	} else if (CUR.phase === 'back' && ['1', '2', '3', '4'].includes(e.key) && $session.querySelector('[data-grade]')) {
		grade(Number(e.key));
	} else if (CUR.phase === 'back' && (e.key === ' ' || e.key === 'Enter')) {
		e.preventDefault();
		($session.querySelector('.grade.suggested') || $session.querySelector('.grade.good') || $session.querySelector('#next'))?.click();
	}
});

/* ---------- dictionary ---------- */

const DICT = { q: '', deck: 'all' };

function renderDict() {
	setTitle('Словарь');
	const chips = [['all', 'Все'], ...Object.entries(DATA.decks)]
		.map(([k, v]) => `<button class="chip ${DICT.deck === k ? 'on' : ''}" data-deck="${k}">${esc(v)}</button>`).join('');
	$view.innerHTML = `
		<input class="search" id="dq" type="search" placeholder="Поиск по-гречески или по-русски" value="${esc(DICT.q)}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
		<div class="chips">${chips}</div>
		<div id="dlist"></div>`;
	const dq = document.getElementById('dq');
	dq.addEventListener('input', () => {
		DICT.q = dq.value;
		renderDictList();
	});
	$view.querySelectorAll('[data-deck]').forEach((b) => (b.onclick = () => {
		DICT.deck = b.dataset.deck;
		renderDict();
	}));
	renderDictList();
}

function renderDictList() {
	const qn = bare(norm(DICT.q));
	const words = DATA.words.filter((w) => {
		if (DICT.deck !== 'all' && w.deck !== DICT.deck) return false;
		if (!qn) return true;
		return [w.el, w.ru, w.tr || '', ...(w.alts || [])].some((s) => bare(norm(s)).includes(qn));
	});
	const el = document.getElementById('dlist');
	if (!words.length) {
		el.innerHTML = '<div class="empty">Ничего не нашлось</div>';
		return;
	}
	const groups = {};
	for (const w of words) (groups[w.lesson] ||= []).push(w);
	el.innerHTML = Object.keys(groups).sort((a, b) => b - a).map((n) => `
		<div class="lesson-head">${esc(lessonLabel(n))} · ${groups[n].length}</div>
		<div class="list">${groups[n].map((w) => {
			const s = wordStatus(w);
			return `<div class="item" data-wid="${esc(w.id)}">
				<div class="row">
					<div class="grow">
						<div class="w-el el">${esc(withArt(w))}${w.tr ? ` <span class="muted small" style="font-weight:400">[${esc(w.tr)}]</span>` : ''}</div>
						<div class="w-ru">${esc(w.ru)}</div>
					</div>
					<span class="pill ${s.cls}">${esc(s.text)}</span>
					${isGreekText(w) ? speakBtn(withArt(w)) : ''}
				</div>
				<div class="w-more" hidden></div>
			</div>`;
		}).join('')}</div>`).join('');
	el.querySelectorAll('.item').forEach((it) => (it.onclick = () => {
		const more = it.querySelector('.w-more');
		if (!more.hidden) {
			more.hidden = true;
			return;
		}
		const w = WORDS.get(it.dataset.wid);
		const cards = DECK_TYPES[w.deck].filter((t) => t !== 'article' || ARTICLES.includes(w.art)).map((t) => {
			const c = CARDS[`${w.id}|${t}`];
			const txt = !c ? 'новая' : (c.state === State.Review ? `повтор через ${fmtInterval(Math.max(0, Date.parse(c.due) - Date.now()))}` : 'изучается');
			return `<span class="pill">${TYPE_SHORT[t]}: ${txt}</span>`;
		}).join(' ');
		more.innerHTML = `${w.note ? `<div style="margin-bottom:6px">${esc(w.note)}</div>` : ''}${cards}${SETTINGS.decks[w.deck] ? '' : '<div style="margin-top:6px">Колода выключена — включи в «Прогресс → Настройки».</div>'}`;
		more.hidden = false;
	}));
}

/* ---------- notes ---------- */

function renderNotes() {
	setTitle('Конспекты');
	const order = [...NOTES].sort((a, b) => noteRank(a) - noteRank(b));
	$view.innerHTML = `<div class="list" style="margin-top:8px">${order.map((n) => `
		<a class="note-link" href="#" data-note="${esc(n.id)}">
			<div class="badge">${esc(noteBadge(n))}</div>
			<div class="grow"><div class="t">${esc(n.title)}</div><div class="d">${esc(n.date)}</div></div>
		</a>`).join('')}</div>`;
	$view.querySelectorAll('[data-note]').forEach((a) => (a.onclick = (e) => {
		e.preventDefault();
		openNote(a.dataset.note);
	}));
}

function noteRank(n) {
	const m = /^(\d+)$/.exec(n.lesson);
	if (n.id.includes('rules')) return -1000;
	return m ? -Number(m[1]) * 10 + (n.id.includes('text') ? 5 : 0) : 0;
}

function noteBadge(n) {
	if (n.id.includes('rules')) return 'αβγ';
	if (n.id.includes('text')) return 'Txt';
	return `У${n.lesson}`;
}

function openNote(id) {
	const n = NOTES.find((x) => x.id === id);
	if (!n) return;
	SUBVIEW = id;
	setTitle(n.title, () => showTab('notes'));
	const html = window.marked.parse(n.md, { gfm: true, breaks: false });
	$view.innerHTML = `<p class="muted small" style="margin:4px 0 0">${esc(n.date)}</p><div class="md">${html}</div>`;
	$view.querySelectorAll('pre > code.language-el').forEach((code) => {
		const text = code.textContent.trim();
		const div = document.createElement('div');
		div.className = 'el-block el';
		div.textContent = text;
		div.insertAdjacentHTML('beforeend', speakBtn(text.replace(/^—\s*/gm, ''), 'Прочитать'));
		code.parentElement.replaceWith(div);
	});
	$view.querySelectorAll('.md a[href^="http"]').forEach((a) => {
		a.target = '_blank';
		a.rel = 'noopener';
	});
	window.scrollTo(0, 0);
}

/* ---------- stats & settings ---------- */

function streakDays() {
	const days = new Set(LOG.map((l) => dayKey(l.t)));
	let n = 0;
	let t = Date.now();
	if (!days.has(dayKey(t))) t -= 86400000; // today not done yet — count from yesterday
	while (days.has(dayKey(t))) {
		n++;
		t -= 86400000;
	}
	return n;
}

function renderStats() {
	setTitle('Прогресс');
	const cards = allCards();
	const states = { new: 0, learning: 0, review: 0, mature: 0 };
	for (const c of cards) {
		const st = CARDS[c.id];
		if (!st || st.state === State.New) states.new++;
		else if (st.state === State.Review) {
			states.review++;
			if (st.stability >= 21) states.mature++;
		} else states.learning++;
	}
	const since = Date.now() - 30 * 86400000;
	const rev = LOG.filter((l) => l.t >= since && l.s === State.Review);
	const retention = rev.length ? Math.round((rev.filter((l) => l.r > Rating.Again).length / rev.length) * 100) : null;
	const tLog = todayLog();

	const d0 = dayStart();
	const forecast = Array.from({ length: 7 }, (_, i) => ({ from: d0 + i * 86400000, n: 0 }));
	for (const c of cards) {
		const st = CARDS[c.id];
		if (!st || st.state === State.New) continue;
		const due = Date.parse(st.due);
		const i = Math.max(0, Math.floor((due - d0) / 86400000));
		if (i < 7) forecast[i].n++;
	}
	const maxF = Math.max(1, ...forecast.map((f) => f.n));
	const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

	$view.innerHTML = `
		${renderGroup()}
		<div class="section-title">Мой прогресс</div>
		<div class="tiles">
			<div class="tile"><div class="v">${tLog.length}</div><div class="k">ответов сегодня</div></div>
			<div class="tile"><div class="v">${streakDays()}</div><div class="k">дней подряд</div></div>
			<div class="tile"><div class="v">${states.review}</div><div class="k">карточек в повторении</div></div>
			<div class="tile"><div class="v">${retention === null ? '—' : retention + '%'}</div><div class="k">помню (30 дней)</div></div>
		</div>
		<div class="section-title">Карточки</div>
		<div class="card small">
			<div class="row"><div class="grow">Новые</div><b>${states.new}</b></div>
			<div class="row" style="margin-top:6px"><div class="grow">Изучаются</div><b>${states.learning}</b></div>
			<div class="row" style="margin-top:6px"><div class="grow">В повторении</div><b>${states.review}</b></div>
			<div class="row" style="margin-top:6px"><div class="grow">Выучены (интервал 3+ недели)</div><b>${states.mature}</b></div>
		</div>
		<div class="section-title">Повторения на неделю</div>
		<div class="card"><div class="bars">${forecast.map((f, i) => `
			<div class="b"><em>${f.n || ''}</em><i style="height:${Math.round((f.n / maxF) * 70)}px"></i><span>${i === 0 ? 'сег' : wd[new Date(f.from).getDay()]}</span></div>`).join('')}
		</div></div>
		${renderSettings()}
	`;
	bindSettings();
	bindGroup();
}

function sw(id, checked) {
	return `<label class="switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span></span></label>`;
}

function renderSettings() {
	const deckCount = (d) => DATA.words.filter((w) => w.deck === d).length;
	VOICES = greekVoices();
	const voices = VOICES.length
		? `<select id="voice"><option value="">Системный</option>${VOICES.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === SETTINGS.voice ? 'selected' : ''}>${esc(voiceLabel(v))}</option>`).join('')}</select>`
		: '<span class="muted small">нет греческого голоса</span>';
	return `
		<div class="section-title">Настройки</div>
		<div class="list settings">
			<div class="srow"><div class="grow">Новых карточек в день</div>
				<div class="stepper"><button id="np-">−</button><output id="np">${SETTINGS.newPerDay}</output><button id="np+">+</button></div></div>
		</div>
		<div class="section-title">Колоды</div>
		<div class="list settings">
			${Object.entries(DATA.decks).map(([k, v]) => `<div class="srow"><div class="grow">${esc(v)}<div class="sub">${deckCount(k)} · ${DECK_TYPES[k].map((t) => TYPE_SHORT[t]).join(', ')}</div></div>${sw(`deck-${k}`, SETTINGS.decks[k])}</div>`).join('')}
		</div>
		<div class="section-title">Типы карточек (слова и фразы)</div>
		<div class="list settings">
			<div class="srow"><div class="grow">Греческий → русский</div>${sw('t-el_ru', SETTINGS.types.el_ru)}</div>
			<div class="srow"><div class="grow">Русский → греческий</div>${sw('t-ru_el', SETTINGS.types.ru_el)}</div>
			<div class="srow"><div class="grow">Артикль ο / η / το</div>${sw('t-article', SETTINGS.types.article)}</div>
			<div class="srow"><div class="grow">Ввод ответа с клавиатуры<div class="sub">для русский → греческий; греческая раскладка — через 🌐</div></div>${sw('typing', SETTINGS.typing)}</div>
		</div>
		<div class="section-title">Озвучка</div>
		<div class="list settings">
			<div class="srow"><div class="grow">Читать слова автоматически</div>${sw('autoplay', SETTINGS.autoplay)}</div>
			<div class="srow"><div class="grow">Скорость</div><input type="range" id="rate" min="0.6" max="1.1" step="0.05" value="${SETTINGS.rate}"></div>
			<div class="srow" id="voice-row"><div class="grow">Голос</div>${voices}<button class="icon-btn" data-speak="Καλημέρα! Είμαι εδώ." aria-label="Проверить голос">${SPEAKER_SVG}</button></div>
			${VOICES.length ? '' : '<div class="srow"><div class="grow sub">На iPhone: Настройки → Универсальный доступ → Устный контент → Голоса → Греческий (Melina).</div></div>'}
			<div class="srow"><div class="grow sub">Нет звука на iPhone? Проверь, не включён ли беззвучный режим — Safari в нём может молчать.</div></div>
		</div>
		<div class="section-title">Данные</div>
		<div class="list settings">
			<div class="srow"><div class="grow">Сохранить прогресс в файл</div><button class="btn ghost" id="export">Экспорт</button></div>
			<div class="srow"><div class="grow">Загрузить прогресс из файла</div><button class="btn ghost" id="import">Импорт</button><input type="file" id="import-file" accept="application/json,.json" hidden></div>
			<div class="srow"><div class="grow">Слова: ${DATA.words.length}<div class="sub">версия данных ${esc(DATA.version ?? '—')}</div></div><button class="btn ghost" id="reload">Обновить</button></div>
			<div class="srow"><div class="grow danger">Сбросить весь прогресс</div><button class="btn ghost danger" id="reset">Сбросить</button></div>
		</div>
		<p class="muted small" style="text-align:center;margin-top:18px">${ACCOUNT ? 'Прогресс синхронизируется с сервером по твоему коду.' : 'Прогресс хранится только на этом устройстве. Создай код или иногда делай экспорт.'}</p>
	`;
}

function bindSettings() {
	const np = document.getElementById('np');
	const setNp = (d) => {
		SETTINGS.newPerDay = Math.max(0, Math.min(100, SETTINGS.newPerDay + d));
		np.textContent = SETTINGS.newPerDay;
		saveSettings();
	};
	document.getElementById('np-').onclick = () => setNp(-5);
	document.getElementById('np+').onclick = () => setNp(5);
	for (const k of Object.keys(DATA.decks)) {
		document.getElementById(`deck-${k}`).onchange = (e) => {
			SETTINGS.decks[k] = e.target.checked;
			saveSettings();
		};
	}
	for (const t of ['el_ru', 'ru_el', 'article']) {
		document.getElementById(`t-${t}`).onchange = (e) => {
			SETTINGS.types[t] = e.target.checked;
			saveSettings();
		};
	}
	document.getElementById('typing').onchange = (e) => {
		SETTINGS.typing = e.target.checked;
		saveSettings();
	};
	document.getElementById('autoplay').onchange = (e) => {
		SETTINGS.autoplay = e.target.checked;
		saveSettings();
	};
	document.getElementById('rate').onchange = (e) => {
		SETTINGS.rate = Number(e.target.value);
		saveSettings();
		speak('Καλημέρα!');
	};
	const voice = document.getElementById('voice');
	if (voice) voice.onchange = () => {
		SETTINGS.voice = voice.value;
		SETTINGS.voiceName = VOICES.find((v) => v.voiceURI === voice.value)?.name || '';
		saveSettings();
		speak('Καλημέρα!');
	};
	document.getElementById('export').onclick = exportProgress;
	const file = document.getElementById('import-file');
	document.getElementById('import').onclick = () => file.click();
	file.onchange = () => file.files[0] && importProgress(file.files[0]);
	document.getElementById('reload').onclick = async () => {
		await loadData(true);
		toast(`Слов: ${DATA.words.length}`);
		renderStats();
	};
	document.getElementById('reset').onclick = () => {
		if (!confirm('Удалить весь прогресс? Это нельзя отменить.')) return;
		CARDS = {};
		LOG = [];
		UNDO = null;
		saveProgress();
		push().catch(() => {});
		toast('Прогресс сброшен');
		renderStats();
	};
}

async function exportProgress() {
	const payload = { app: 'greek-cards', exported: new Date().toISOString(), settings: SETTINGS, cards: CARDS, log: LOG };
	const name = `greek-progress-${dayKey(Date.now())}.json`;
	const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
	try {
		const f = new File([blob], name, { type: 'application/json' });
		if (navigator.canShare?.({ files: [f] })) {
			await navigator.share({ files: [f], title: name });
			return;
		}
	} catch (e) {
		if (e?.name === 'AbortError') return;
	}
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = name;
	document.body.append(a);
	a.click();
	setTimeout(() => {
		URL.revokeObjectURL(a.href);
		a.remove();
	}, 1000);
}

async function importProgress(file) {
	try {
		const data = JSON.parse(await file.text());
		if (data.app !== 'greek-cards' || typeof data.cards !== 'object') throw new Error('bad file');
		if (!confirm(`Заменить текущий прогресс данными из файла (${Object.keys(data.cards).length} карточек)?`)) return;
		CARDS = data.cards;
		LOG = Array.isArray(data.log) ? data.log : [];
		if (data.settings) {
			SETTINGS = { ...SETTINGS, ...data.settings };
			saveSettings();
		}
		UNDO = null;
		saveProgress();
		push().catch(() => {});
		toast('Прогресс загружен');
		renderStats();
	} catch {
		toast('Не получилось прочитать файл');
	}
}

/* ---------- sync & group ---------- */

const API = String(window.GK_API || '').replace(/\/+$/, '');
let ACCOUNT = store.get(LS.account, null); // { code, name, lastSync, pushedDay, reveal }
let DIRTY = false;
let SYNCING = null;
let RATED_SINCE_SYNC = 0;

const fmtCode = (c) => (c ? `${c.slice(0, 4)}-${c.slice(4)}` : '');
const normCode = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

function saveAccount() {
	if (ACCOUNT) store.set(LS.account, ACCOUNT);
	else localStorage.removeItem(LS.account);
}

async function api(method, path, body, code = ACCOUNT?.code) {
	const r = await fetch(API + path, {
		method,
		headers: { 'Content-Type': 'application/json', ...(code ? { Authorization: `Bearer ${code}` } : {}) },
		body: body === undefined ? undefined : JSON.stringify(body),
		cache: 'no-store',
	});
	const data = await r.json().catch(() => ({}));
	if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status, code: data.error });
	return data;
}

const logKey = (l) => `${l.c}|${l.t}`;
const reviewedAt = (c) => (c && c.last_review ? Date.parse(c.last_review) || 0 : 0);

/** Union of local and remote progress; returns { changed, localExtra }. */
function mergeRemote(remote) {
	const res = { changed: false, localExtra: false };
	if (!remote || typeof remote !== 'object') {
		res.localExtra = Object.keys(CARDS).length > 0 || LOG.length > 0;
		return res;
	}
	const rCards = remote.cards && typeof remote.cards === 'object' ? remote.cards : {};
	const rLog = Array.isArray(remote.log) ? remote.log : [];
	const freshDevice = !Object.keys(CARDS).length && !LOG.length;

	for (const [id, lc] of Object.entries(CARDS)) {
		if (!rCards[id] || reviewedAt(lc) > reviewedAt(rCards[id])) res.localExtra = true;
	}
	for (const [id, rc] of Object.entries(rCards)) {
		if (!CARDS[id] || reviewedAt(rc) > reviewedAt(CARDS[id])) {
			CARDS[id] = rc;
			res.changed = true;
		}
	}
	const rKeys = new Set(rLog.map(logKey));
	if (LOG.some((l) => !rKeys.has(logKey(l)))) res.localExtra = true;
	const lKeys = new Set(LOG.map(logKey));
	const add = rLog.filter((l) => l && l.c && !lKeys.has(logKey(l)));
	if (add.length) {
		LOG = LOG.concat(add).sort((a, b) => a.t - b.t);
		res.changed = true;
	}
	if (freshDevice && remote.settings) {
		const s = remote.settings;
		SETTINGS = { ...DEFAULT_SETTINGS, ...s, decks: { ...DEFAULT_SETTINGS.decks, ...(s.decks || {}) }, types: { ...DEFAULT_SETTINGS.types, ...(s.types || {}) } };
		store.set(LS.settings, SETTINGS);
		F = makeScheduler();
		res.changed = true;
	}
	if (res.changed) {
		UNDO = null;
		saveProgress();
	}
	return res;
}

function myStats() {
	let learned = 0, mature = 0;
	const words = new Set();
	for (const [id, c] of Object.entries(CARDS)) {
		if (c.state === State.New) continue;
		words.add(id.split('|')[0]); // words already studied
		if (c.state !== State.Review) continue;
		learned++;
		if (c.stability >= 21) mature++;
	}
	const t0 = dayStart();
	const w0 = t0 - 6 * 86400000;
	let today = 0, week = 0;
	for (const l of LOG) {
		if (l.t >= t0) today++;
		if (l.t >= w0) week++;
	}
	return { words: words.size, learned, mature, today, week, total: LOG.length, streak: streakDays(), day: dayKey(Date.now()) };
}

async function push() {
	if (!API || !ACCOUNT) return;
	await api('PUT', '/api/me', { data: { cards: CARDS, log: LOG, settings: SETTINGS }, stats: myStats(), name: ACCOUNT.name });
	DIRTY = false;
	ACCOUNT.lastSync = Date.now();
	ACCOUNT.pushedDay = dayKey(Date.now());
	saveAccount();
}

/** Pull, merge, push if needed. Resolves to true when local data changed. */
function sync({ quiet = true } = {}) {
	if (!API || !ACCOUNT) return Promise.resolve(false);
	if (SYNCING) return SYNCING;
	SYNCING = (async () => {
		try {
			const me = await api('GET', '/api/me');
			const { changed, localExtra } = mergeRemote(me.data);
			if (localExtra || DIRTY || ACCOUNT.pushedDay !== dayKey(Date.now()) || !me.data) await push();
			else {
				ACCOUNT.lastSync = Date.now();
				saveAccount();
			}
			RATED_SINCE_SYNC = 0;
			return changed;
		} catch (e) {
			if (e.status === 401) {
				ACCOUNT = null;
				saveAccount();
				toast('Код больше не действует — войди заново');
			} else if (!quiet) toast('Нет связи с сервером');
			return false;
		} finally {
			SYNCING = null;
		}
	})();
	return SYNCING;
}

function maybeSyncDuringSession() {
	if (!ACCOUNT) return;
	if (++RATED_SINCE_SYNC >= 20) sync();
}

function rerender() {
	if (!$session.hidden || SUBVIEW) return;
	showTab(TAB);
}

function ago(ts) {
	if (!ts) return 'никогда';
	const ms = Date.now() - ts;
	return ms < 60000 ? 'только что' : `${fmtInterval(ms)} назад`;
}

function renderGroup() {
	if (!API) return '';
	if (!ACCOUNT) {
		return `
		<div class="section-title">Группа</div>
		<div class="card">
			<p class="small" style="margin:0 0 12px">Личный код сохраняет прогресс на сервере: его можно открыть на другом устройстве, и ты попадёшь в рейтинг группы.</p>
			<input class="search" id="acc-name" placeholder="Как тебя зовут?" maxlength="24" autocomplete="nickname">
			<button class="btn primary block" id="acc-create">Создать код</button>
			<div class="row" style="margin-top:14px">
				<input class="search grow" id="acc-code" placeholder="Есть код? XXXX-XXXX" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" style="margin:0">
				<button class="btn" id="acc-login">Войти</button>
			</div>
		</div>`;
	}
	return `
		<div class="section-title">Группа</div>
		<div class="list" id="board"><div class="empty small" style="padding:18px 0">Загружаю рейтинг…</div></div>
		<div class="card small">
			<div class="row">
				<div class="grow">Ты — <b>${esc(ACCOUNT.name)}</b><div class="muted" id="acc-status">Синхронизировано: ${ago(ACCOUNT.lastSync)}</div></div>
				<button class="btn sm" id="acc-sync">Обновить</button>
			</div>
			<div class="acc-code">
				<div class="code" id="acc-code-view">${ACCOUNT.reveal ? fmtCode(ACCOUNT.code) : '••••-••••'}</div>
				<div class="row" style="gap:6px">
					<button class="btn sm" id="acc-show">${ACCOUNT.reveal ? 'Скрыть' : 'Показать'}</button>
					<button class="btn sm" id="acc-copy">Копировать</button>
				</div>
			</div>
			<p class="muted" style="margin:6px 0">Твой личный код: введи его на другом устройстве, чтобы продолжить с тем же прогрессом. Не показывай другим — по нему можно войти в твой профиль.</p>
			<div class="row" style="justify-content:space-between;margin-top:6px">
				<button class="link" id="acc-logout">Выйти на этом устройстве</button>
				<button class="link danger" id="acc-delete">Удалить профиль</button>
			</div>
		</div>`;
}

function boardRow(u, i) {
	const s = u.stats || {};
	const today = s.day === dayKey(Date.now()) ? s.today || 0 : 0;
	const stale = Date.now() - (u.updated || 0) > 2 * 86400000;
	const bits = [`серия ${s.streak || 0} дн`, `за неделю ${s.week || 0}`];
	if (today) bits.unshift(`сегодня ${today}`);
	else if (stale) bits.unshift(`был(а) ${ago(u.updated)}`);
	return `<div class="item board-row ${u.me ? 'me' : ''}">
		<div class="row">
			<div class="rank">${i + 1}</div>
			<div class="grow">
				<div class="w-el">${esc(u.name)}${u.me ? ' <span class="pill new">ты</span>' : ''}</div>
				<div class="w-ru small">${bits.join(' · ')}</div>
			</div>
			<div class="score"><b>${s.words || 0}</b><span>слов</span></div>
		</div>
	</div>`;
}

async function loadBoard() {
	const el = document.getElementById('board');
	if (!el) return;
	try {
		const { users } = await api('GET', '/api/board');
		users.sort((a, b) => (b.stats?.words || 0) - (a.stats?.words || 0) || (b.stats?.week || 0) - (a.stats?.week || 0));
		if (document.getElementById('board') !== el) return;
		el.innerHTML = users.length ? users.map(boardRow).join('') : '<div class="empty small">Пока никого</div>';
	} catch (e) {
		if (e.status === 401) {
			ACCOUNT = null;
			saveAccount();
			renderStats();
			return;
		}
		el.innerHTML = '<div class="empty small" style="padding:18px 0">Нет связи с сервером</div>';
	}
}

function bindGroup() {
	if (!API) return;
	if (!ACCOUNT) {
		document.getElementById('acc-create').onclick = createAccount;
		document.getElementById('acc-login').onclick = loginWithCode;
		document.getElementById('acc-code').addEventListener('keydown', (e) => e.key === 'Enter' && loginWithCode());
		document.getElementById('acc-name').addEventListener('keydown', (e) => e.key === 'Enter' && createAccount());
		return;
	}
	document.getElementById('acc-sync').onclick = async () => {
		const st = document.getElementById('acc-status');
		st.textContent = 'Синхронизирую…';
		const changed = await sync({ quiet: false });
		if (changed || !ACCOUNT) renderStats();
		else {
			st.textContent = `Синхронизировано: ${ago(ACCOUNT.lastSync)}`;
			loadBoard();
		}
	};
	document.getElementById('acc-show').onclick = () => {
		ACCOUNT.reveal = !ACCOUNT.reveal;
		saveAccount();
		renderStats();
	};
	document.getElementById('acc-copy').onclick = async () => {
		try {
			await navigator.clipboard.writeText(fmtCode(ACCOUNT.code));
			toast('Код скопирован');
		} catch {
			ACCOUNT.reveal = true;
			saveAccount();
			renderStats();
		}
	};
	document.getElementById('acc-logout').onclick = logout;
	document.getElementById('acc-delete').onclick = deleteAccount;
	loadBoard();
}

async function createAccount() {
	const name = document.getElementById('acc-name').value.trim();
	if (!name) {
		toast('Напиши имя — его увидят в рейтинге');
		document.getElementById('acc-name').focus();
		return;
	}
	const btn = document.getElementById('acc-create');
	btn.disabled = true;
	try {
		const r = await api('POST', '/api/register', { name }, null);
		ACCOUNT = { code: normCode(r.code), name: r.name, lastSync: 0, reveal: true };
		saveAccount();
		await push();
		toast('Код создан — сохрани его');
		renderStats();
	} catch (e) {
		toast(e.code === 'too_many_users' ? 'В группе уже максимум участников' : 'Не получилось — нет связи?');
		btn.disabled = false;
	}
}

async function loginWithCode() {
	const code = normCode(document.getElementById('acc-code').value);
	if (code.length !== 8) {
		toast('Код — 8 символов, например K7QM-4XPA');
		return;
	}
	const btn = document.getElementById('acc-login');
	btn.disabled = true;
	try {
		const me = await api('GET', '/api/me', undefined, code);
		const localCards = Object.keys(CARDS).length;
		if (localCards && me.data && !confirm(`На этом устройстве уже есть прогресс (${localCards} карточек). Объединить его с профилем «${me.name}»?\n\nОтмена — заменить его прогрессом профиля.`)) {
			CARDS = {};
			LOG = [];
		}
		ACCOUNT = { code, name: me.name, lastSync: 0, reveal: false };
		saveAccount();
		mergeRemote(me.data);
		await push();
		toast(`Привет, ${me.name}!`);
		renderStats();
	} catch (e) {
		toast(e.status === 401 ? 'Такого кода нет' : 'Нет связи с сервером');
		btn.disabled = false;
	}
}

async function logout() {
	if (!confirm('Выйти? Прогресс на этом устройстве удалится, но останется на сервере — вернуть его можно по коду.')) return;
	try {
		await push();
	} catch {
		toast('Нет связи — сначала нужно сохранить прогресс на сервер');
		return;
	}
	ACCOUNT = null;
	saveAccount();
	CARDS = {};
	LOG = [];
	UNDO = null;
	saveProgress();
	toast('Вышел');
	renderStats();
}

async function deleteAccount() {
	if (!confirm('Удалить профиль с сервера? Код перестанет работать, ты пропадёшь из рейтинга. Прогресс на этом устройстве останется.')) return;
	try {
		await api('DELETE', '/api/me');
		ACCOUNT = null;
		saveAccount();
		toast('Профиль удалён');
		renderStats();
	} catch {
		toast('Нет связи с сервером');
	}
}

/* ---------- boot ---------- */

async function fetchJson(url, fresh) {
	const r = await fetch(url, { cache: fresh ? 'reload' : 'no-cache' });
	if (!r.ok) throw new Error(`${url}: ${r.status}`);
	return r.json();
}

async function loadData(fresh = false) {
	const [words, notes] = await Promise.all([fetchJson('data/words.json', fresh), fetchJson('data/notes.json', fresh)]);
	DATA = words;
	WORDS = new Map(DATA.words.map((w) => [w.id, w]));
	NOTES = notes.notes || [];
}

async function boot() {
	try {
		await loadData();
	} catch (e) {
		$view.innerHTML = `<div class="empty">Не удалось загрузить слова.<br><span class="small">${esc(e.message)}</span></div>`;
		return;
	}
	showTab('learn');
	sync().then((changed) => changed && rerender());
	navigator.storage?.persist?.().catch(() => {});
	if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
		// a new version took over: reload once so the fresh app.js runs (not in the middle of a session)
		const hadController = Boolean(navigator.serviceWorker.controller);
		let reloading = false;
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			if (!hadController || reloading || !$session.hidden) return;
			reloading = true;
			location.reload();
		});
		navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch(() => {});
	}
}

document.addEventListener('visibilitychange', () => {
	if (document.visibilityState !== 'visible') return;
	if ($session.hidden && TAB === 'learn' && !SUBVIEW) renderLearn();
	if (ACCOUNT && Date.now() - (ACCOUNT.lastSync || 0) > 2 * 60000) sync().then((changed) => changed && rerender());
});

boot();
