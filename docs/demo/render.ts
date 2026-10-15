// Renders the README's screenshots with a demo group, in English and in
// Russian, and the plugin's icon.
//
// The words come from the mod's translations (hooks/i18n.ts), the picture
// preview from its SVG (hooks/lib.ts pictureSvg) and the reply in the group
// from its Markdown → Telegram HTML converter (hooks/lib.ts telegramPieces);
// the page around them follows Claude Desktop's dark theme. Run from the
// repository root:
//
//   node docs/demo/render.ts
//
// Needs Node 23.6+ (TypeScript type stripping) and Google Chrome.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sizeOf, t } from '../../hooks/i18n.ts'
import { pictureSvg, telegramPieces } from '../../hooks/lib.ts'

type Lang = 'en' | 'ru'

const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
const escape = (text: string) => text.replace(/[<>&"]/g, c => `&#${c.charCodeAt(0)};`)

/** The picture a client sent: a made-up checkout mock-up with a big pay button. */
const MOCKUP = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
<rect width="640" height="400" fill="#f4f1ea"/>
<rect x="150" y="34" width="340" height="332" rx="22" fill="#ffffff" stroke="#e3ded3"/>
<rect x="182" y="66" width="140" height="16" rx="8" fill="#2b2a27"/>
<rect x="182" y="96" width="220" height="10" rx="5" fill="#c9c3b6"/>
<rect x="182" y="132" width="276" height="44" rx="10" fill="#f4f1ea"/>
<rect x="198" y="148" width="120" height="12" rx="6" fill="#a39d90"/>
<rect x="182" y="188" width="276" height="44" rx="10" fill="#f4f1ea"/>
<rect x="198" y="204" width="90" height="12" rx="6" fill="#a39d90"/>
<rect x="182" y="262" width="276" height="66" rx="16" fill="#d97757"/>
<rect x="262" y="288" width="116" height="14" rx="7" fill="#ffffff"/>
<circle cx="470" cy="290" r="34" fill="none" stroke="#e5484d" stroke-width="5" stroke-dasharray="10 7"/>
</svg>`

type Demo = {
  project: string
  group: string
  bot: string
  maria: string
  alex: string
  hello: string
  brief: string
  briefFile: string
  briefSize: number
  pictureCaption: string
  replyMd: string
  reply: string
  inserted: string
  prompt: string
}

const PATH = '~/.claude/tg-bridge/files/7…/-100…/412.jpg'

const DEMO: Record<Lang, Demo> = {
  en: {
    project: 'northwind-shop',
    group: 'Northwind · Shop',
    bot: 'northwind_dev_bot',
    maria: 'Maria Lopez',
    alex: 'Alex Kim',
    hello: 'Hi! Can we have Apple Pay on checkout by Friday?',
    brief: 'The brief for the new checkout',
    briefFile: 'checkout-brief.docx',
    briefSize: 49_000,
    pictureCaption: 'Make the pay button like this, and bigger',
    replyMd: [
      '## Apple Pay is on staging',
      '',
      '- the **pay button** is 56px tall, as in the mock-up',
      '- Apple Pay shows only where the browser supports it',
      '',
      'Changed files:',
      '',
      '| File | What |',
      '|---|---|',
      '| `Checkout.tsx` | the button |',
      '| `payments.ts` | Apple Pay |',
      '',
      '> Check it: https://staging.northwind.dev/checkout',
    ].join('\n'),
    reply: 'Done: the pay button is bigger and Apple Pay is on staging.',
    inserted: 'Make the pay button like this, and bigger',
    prompt: 'Reply to Claude…',
  },
  ru: {
    project: 'northwind-shop',
    group: 'Northwind · Магазин',
    bot: 'northwind_dev_bot',
    maria: 'Мария Лопес',
    alex: 'Алексей Ким',
    hello: 'Привет! Успеем добавить Apple Pay в оформление заказа к пятнице?',
    brief: 'ТЗ на новое оформление заказа',
    briefFile: 'checkout-brief.docx',
    briefSize: 49_000,
    pictureCaption: 'Кнопку оплаты сделайте вот так, и покрупнее',
    replyMd: [
      '## Apple Pay на стенде',
      '',
      '- **кнопка оплаты** высотой 56px, как на макете',
      '- Apple Pay показывается, только если браузер его поддерживает',
      '',
      'Изменённые файлы:',
      '',
      '| Файл | Что |',
      '|---|---|',
      '| `Checkout.tsx` | кнопка |',
      '| `payments.ts` | Apple Pay |',
      '',
      '> Проверить: https://staging.northwind.dev/checkout',
    ].join('\n'),
    reply: 'Готово: кнопка оплаты крупнее, Apple Pay уже на стенде.',
    inserted: 'Кнопку оплаты сделайте вот так, и покрупнее',
    prompt: 'Ответьте Claude…',
  },
}

const CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; background: #151515; color: #e8e6e3; color-scheme: dark;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; }
img { display: block; }
.app { display: flex; height: 100vh; }
.main { flex: 1; min-width: 0; padding: 26px 30px 26px; display: flex; flex-direction: column; }
.reply { color: #d4d2cc; font-size: 15px; line-height: 1.6; max-width: 640px; margin: 0 0 0 6px; }
.reply code, .prompt code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: #232322; padding: 1px 5px; border-radius: 5px; }
.spacer { flex: 1; }
.prompt { border: 1px solid #343433; border-radius: 16px; background: #1d1d1d; min-height: 112px; padding: 14px 18px; color: #e8e6e3; font-size: 15px; white-space: pre-wrap; }
.prompt .ph { color: #6f6e69; }
.prompt .mention { color: #8fb8ff; }
.caret { display: inline-block; width: 1.5px; height: 17px; background: #ecebe7; margin-left: 1px; vertical-align: -3px; }
.pane { width: 440px; background: #191918; border-left: 1px solid #2a2a29; padding: 0 18px 24px; overflow: hidden; }
.pane.alone { width: 100%; border-left: none; min-height: 100vh; }
.pane .head { display: flex; align-items: center; justify-content: space-between; height: 46px; border-bottom: 1px solid #262625; margin: 0 -18px 16px; padding: 0 20px; color: #d5d3ce; font-weight: 600; }
.pane .x { color: #8f8e89; font-weight: 400; font-size: 16px; word-spacing: 12px; white-space: nowrap; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.title { font-weight: 650; font-size: 15px; }
.dim { color: #8f8e89; }
.gap > * + * { margin-top: 14px; }
.form { display: flex; gap: 8px; }
.field { flex: 1; height: 34px; border: 1px solid #4a4945; border-radius: 9px; padding: 0 12px; display: flex; align-items: center; color: #6f6e69; }
.btn { background: #2b2b2a; color: #e3e1dc; border-radius: 8px; padding: 6px 14px; white-space: nowrap; display: inline-block; }
.btn.primary { background: #ecebe7; color: #1a1a19; }
.msg .name { font-weight: 650; }
.msg .name.own { color: #6cc4d8; }
.msg .time { color: #8f8e89; font-weight: 400; margin-left: 6px; }
.msg .to { color: #8f8e89; }
.msg .to.hover { color: #e8e6e3; }
.msg .text { margin-top: 3px; white-space: pre-wrap; color: #dcdad5; }
.msg .pic { margin-top: 6px; border-radius: 8px; overflow: hidden; width: 240px; }
.link { color: #8fb8ff; word-break: break-all; }
.mono { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
.chat { min-height: 100vh; padding: 26px 30px; background: #0f1418; }
.chat .label { color: #8f8e89; margin: 0 0 12px 4px; font-size: 13px; }
.bubble { max-width: 520px; background: #1f2b35; border-radius: 16px 16px 16px 6px; padding: 10px 14px 8px; color: #e9eef2; white-space: pre-wrap; line-height: 1.5; }
.bubble + .bubble { margin-top: 8px; }
.bubble .who { color: #6cc4d8; font-weight: 650; margin-bottom: 2px; }
.bubble b { font-weight: 700; }
.bubble code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; color: #f2b8a2; }
.bubble pre { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: #16212a; border-radius: 8px; padding: 8px 10px; margin: 2px 0; white-space: pre; }
.bubble blockquote { margin: 2px 0; padding: 2px 10px; border-left: 3px solid #6cc4d8; background: #22323e; border-radius: 4px; }
.bubble a { color: #8fc8ff; text-decoration: none; }
.bubble .meta { text-align: right; color: #8aa0b0; font-size: 12px; margin-top: 2px; }
`

const page = (body: string, extra = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}${extra}</style></head><body>${body}</body></html>`

function message(l: Lang, opts: { name: string; time: string; text?: string; own?: boolean; pic?: boolean; file?: string; hover?: boolean }): string {
  const d = DEMO[l]
  const pic = opts.pic ? `<div class="pic"><img src="${svgUri(pictureSvg(svgUri(MOCKUP), 640, 400))}" width="240" height="150" alt=""></div>` : ''
  const file = opts.file ? `<div class="text">📎 ${escape(opts.file)} <span class="dim">${sizeOf(d.briefSize, l)}</span></div>` : ''
  const text = opts.text ? `<div class="text">${escape(opts.text)}</div>` : ''
  return `<div class="msg"><div class="row"><span class="name${opts.own ? ' own' : ''}">${escape(opts.name)}<span class="time">${opts.time}</span></span><span class="to${opts.hover ? ' hover' : ''}">${t(l, 'toPrompt')}</span></div>${pic}${file}${text}</div>`
}

function pane(l: Lang, alone = false): string {
  const d = DEMO[l]
  const messages = [
    message(l, { name: `@${d.bot}`, time: '12:41', text: telegramPieces(d.replyMd)[0]?.plain.split('\n').slice(0, 3).join('\n'), own: true }),
    message(l, { name: d.maria, time: '12:38', pic: true, text: d.pictureCaption, hover: true }),
    message(l, { name: d.alex, time: '12:35', file: d.briefFile, text: d.brief }),
    message(l, { name: d.maria, time: '12:30', text: d.hello }),
  ].join('')
  return `<div class="pane${alone ? ' alone' : ''}"><div class="head"><span>Telegram</span><span class="x">⤢ ✕</span></div><div class="gap">
<div class="row"><span class="title">${escape(d.group)}</span><span class="dim">${t(l, 'changeBot', { bot: d.bot })}</span></div>
<div class="form"><div class="field">${t(l, 'messagePlaceholder')}</div><span class="btn">${t(l, 'send')}</span></div>
<div><span class="btn">${t(l, 'sendReply')}</span></div>
${messages}</div></div>`
}

function paneScene(l: Lang): string {
  const d = DEMO[l]
  const prompt = `<div class="prompt">${escape(d.inserted)}\n<span class="mention">@${escape(PATH)}</span><span class="caret"></span></div>`
  return `<div class="app"><div class="main"><p class="reply">${escape(d.reply)}</p><div class="spacer"></div>${prompt}</div>${pane(l)}</div>`
}

function linkScene(l: Lang): string {
  const d = DEMO[l]
  const code = 'K7QX2M'
  return `<div class="pane alone"><div class="head"><span>Telegram</span><span class="x">⤢ ✕</span></div><div class="gap">
<div class="title">${t(l, 'groupNotLinked', { project: d.project })}</div>
<div><div>${t(l, 'addByLink')}</div><div class="link">https://t.me/${d.bot}?startgroup=${code}</div>
<div class="dim">${t(l, 'orSendThere')}</div><div class="title mono">/link@${d.bot} ${code}</div></div>
<div class="dim">${t(l, 'changeBot', { bot: d.bot })}</div></div></div>`
}

function replyScene(l: Lang): string {
  const d = DEMO[l]
  const label = l === 'en' ? 'In the group: the reply as Telegram draws it' : 'В группе: ответ так, как его рисует Telegram'
  const bubbles = telegramPieces(d.replyMd)
    // A block element already ends its line: the newline after one is no line of its own.
    .map(piece => piece.html.replace(/(<\/pre>|<\/blockquote>)\n/g, '$1'))
    .map(html => `<div class="bubble"><div class="who">@${d.bot}</div>${html}<div class="meta">12:41</div></div>`)
    .join('')
  return `<div class="chat"><div class="label">${label}</div>${bubbles}</div>`
}

/** The plugin's listing icon: a paper plane leaving a chat bubble. */
function iconPage(): string {
  const css = `
html, body { margin: 0; width: 512px; height: 512px; background: #1d1c1b; }
.icon { width: 512px; height: 512px; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(120% 120% at 30% 15%, #34322e 0%, #1d1c1b 60%, #141413 100%); }
`
  // A paper plane in Claude's orange, not Telegram's blue: the mod is no part of Telegram.
  const art = `<svg width="420" height="420" viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg">
<rect x="30" y="60" width="290" height="220" rx="58" fill="#121211"/>
<path d="M92 262 L78 338 L170 270 Z" fill="#121211"/>
<rect x="78" y="118" width="170" height="22" rx="11" fill="#8f8e89"/>
<rect x="78" y="164" width="112" height="22" rx="11" fill="#ecebe7"/>
<rect x="78" y="210" width="142" height="22" rx="11" fill="#8f8e89"/>
<g transform="translate(212 150)">
<path d="M0 92 L190 0 L92 136 Z" fill="#ec9a7b"/>
<path d="M92 136 L190 0 L150 196 Z" fill="#d97757"/>
<path d="M92 136 L104 196 L124 162 Z" fill="#a8523a"/>
</g>
</svg>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="icon">${art}</div></body></html>`
}

const SCENES: { name: string; html: string; width: number; height: number; out: string }[] = []
for (const l of ['en', 'ru'] as const) {
  SCENES.push(
    { name: `pane-${l}`, html: page(paneScene(l)), width: 1180, height: 760, out: `docs/screenshots/${l}/pane.png` },
    { name: `link-${l}`, html: page(linkScene(l)), width: 440, height: 250, out: `docs/screenshots/${l}/link.png` },
    { name: `reply-${l}`, html: page(replyScene(l)), width: 600, height: 400, out: `docs/screenshots/${l}/reply.png` },
  )
}
SCENES.push({ name: 'icon', html: iconPage(), width: 512, height: 512, out: '.claude-plugin/icon.png' })

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const htmlDir = join(root, 'docs/demo/out')
mkdirSync(htmlDir, { recursive: true })

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
for (const scene of SCENES) {
  mkdirSync(dirname(join(root, scene.out)), { recursive: true })
  const html = join(htmlDir, `${scene.name}.html`)
  writeFileSync(html, scene.html)
  execFileSync(CHROME, [
    '--headless=new',
    '--hide-scrollbars',
    '--force-dark-mode',
    '--force-device-scale-factor=2',
    `--window-size=${scene.width},${scene.height}`,
    `--screenshot=${join(root, scene.out)}`,
    `file://${html}`,
  ], { stdio: 'ignore' })
  console.log(scene.out)
}
