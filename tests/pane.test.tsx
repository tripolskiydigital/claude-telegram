import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { chunks, inlineHtml, linkCodeOf, linkKeyFor, merge, projectOfGitDir, telegramPieces } from '../hooks/lib'

const PANE = {
  plugin: 'tg-bridge',
  component: 'Pane',
  requestId: 'tg-bridge',
} as const

type Call = { method: string; body: Record<string, unknown> }

/** The bot as Telegram answers it: getMe, a queue of getUpdates rounds, and sendMessage. */
function telegram(on: Parameters<TestBody>[1], rounds: unknown[][]) {
  const calls: Call[] = []
  let sentId = 900
  on('http.fetch', ($, e) => {
    const method = e.url.split('/').pop() ?? ''
    const body = JSON.parse(String(e.init?.body ?? '{}')) as Record<string, unknown>
    calls.push({ method, body })
    let result: unknown = true
    if (method === 'getMe') result = { id: 111, is_bot: true, username: 'demo_bot' }
    if (method === 'getUpdates') result = rounds.shift() ?? []
    if (method === 'sendMessage') result = { message_id: ++sentId, date: 1_700_000_000 }
    if (method === 'getFile') result = { file_path: `photos/${String(body.file_id)}.jpg` }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ ok: true, result }) } } as never
  })
  return calls
}

function stubs(on: Parameters<TestBody>[1]) {
  mock.store(on, {})
  mock.env(on, { HOME: '/Users/t' })
  const clock = mock.clock(on)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true as const } }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  return clock
}

const GROUP = { id: -100500, type: 'supergroup', title: 'Проект Альфа' }

function update(id: number, text: string, from = 'Анна') {
  return {
    update_id: id,
    message: { message_id: id, date: 1_700_000_000 + id, chat: GROUP, from: { id: 7, first_name: from }, text },
  }
}

test('a link code ties the group to the project and its messages reach the pane', { options: { botToken: '111:AAA' } }, async ($, on) => {
  const rounds: unknown[][] = []
  const calls = telegram(on, rounds)
  const clock = stubs(on)
  await $.session.start({ cwd: '/p/alpha', surface: 'desktop', isInteractive: true } as never)
  await clock.settle()

  const asked = await $.command.run({ command: 'tg-link', args: '' } as never)
  const code = /Link code: (\w{6})/.exec(asked.text ?? '')?.[1]
  expect(code).toBeDefined()
  expect(asked.text).toContain(`https://t.me/demo_bot?startgroup=${code}`)

  rounds.push([update(1, `/start@demo_bot ${code}`), update(2, 'Привет, Claude')])
  await clock.advance(3000)

  // The bot said so in the group, and the group is the pane's now.
  expect(calls.some(c => c.method === 'sendMessage' && String(c.body.text).includes('alpha'))).toBe(true)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface, props: { title: 'Telegram', bodyColumns: 80 } as never })
    expect(await ui.find({ type: 'Text', text: /Проект Альфа/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Привет, Claude/ })).toBeDefined()
    expect(await ui.find({ key: 'q1' })).toBeUndefined()
    await ui.unmount()
  }

  // The next round asks past what it read.
  await clock.advance(3000)
  const asks = calls.filter(c => c.method === 'getUpdates')
  expect(asks[asks.length - 1]?.body.offset).toBe(3)
})

test('a message quotes into the prompt and the field sends to the group', { options: { botToken: '111:AAA' } }, async ($, on) => {
  const rounds: unknown[][] = []
  const calls = telegram(on, rounds)
  const clock = stubs(on)
  const filled: string[] = []
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  await $.session.start({ cwd: '/p/alpha', surface: 'desktop', isInteractive: true } as never)
  const asked = await $.command.run({ command: 'tg-link', args: '' } as never)
  const code = /Link code: (\w{6})/.exec(asked.text ?? '')?.[1]
  rounds.push([update(1, `/link ${code}`), update(2, 'Сделай кнопку синей\nи покрупнее')])
  await clock.advance(3000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { title: 'Telegram', bodyColumns: 80 } as never })
  await ui.press({ key: 'q2' })
  // The message's own words alone: no author, no quote marks.
  expect(filled).toEqual(['Сделай кнопку синей\nи покрупнее'])

  await ui.input({ key: 'compose-0', text: 'Готово, смотрите' })
  const sent = calls.filter(c => c.method === 'sendMessage' && c.body.chat_id === GROUP.id)
  expect(sent[sent.length - 1]?.body.text).toBe('Готово, смотрите')
  // The field is drawn anew, empty, and the sent message is in the list.
  expect(await ui.find({ key: 'compose-1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Готово, смотрите/ })).toBeDefined()
  await ui.unmount()
})

test('with no token nothing is polled; a token typed into the pane connects the bot', async ($, on) => {
  const calls = telegram(on, [])
  const clock = stubs(on)
  await $.session.start({ cwd: '/p/alpha', surface: 'desktop', isInteractive: true } as never)
  await clock.advance(10_000)
  expect(calls).toEqual([])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { title: 'Telegram', bodyColumns: 80 } as never })
  await ui.input({ key: 'token', text: 'not a token' })
  expect(calls).toEqual([])
  await ui.input({ key: 'token', text: ' 111:AAAAAAAAAAAAAAAAAAAAAAAAAA ' })
  expect(calls[0]?.method).toBe('getMe')
  // Connected: the pane asks for a group now, and the bot is polled.
  expect(await ui.find({ key: 'link' })).toBeDefined()
  expect(await ui.find({ key: 'change-bot' })).toBeDefined()
  await clock.advance(3000)
  expect(calls.some(c => c.method === 'getUpdates')).toBe(true)

  await ui.press({ key: 'change-bot' })
  expect(await ui.find({ key: 'token' })).toBeDefined()
  await ui.press({ key: 'token-cancel' })
  expect(await ui.find({ key: 'link' })).toBeDefined()
  await ui.unmount()
})

test('link codes, chunks and merging', async () => {
  expect(linkCodeOf('/start ABC234')).toBe('ABC234')
  expect(linkCodeOf('/link@demo_bot abc234')).toBe('ABC234')
  expect(linkCodeOf('/start')).toBeUndefined()
  expect(linkCodeOf('hello /link ABC234')).toBeUndefined()

  const long = `${'a'.repeat(3000)}\n${'b'.repeat(3000)}`
  expect(chunks(long)).toEqual(['a'.repeat(3000), 'b'.repeat(3000)])
  expect(chunks('x'.repeat(9000)).map(p => p.length)).toEqual([4000, 4000, 1000])

  expect(linkKeyFor(['/p/app', '/p/app/web', '/p/other'], '/p/app/web/src')).toBe('/p/app/web')
  expect(linkKeyFor(['/p/app'], '/p/app')).toBe('/p/app')
  expect(linkKeyFor(['/p/app'], '/p/apple')).toBeUndefined()
  expect(projectOfGitDir('/p/app/.git\n')).toBe('/p/app')
  expect(projectOfGitDir('/p/app/.git/worktrees/x')).toBeUndefined()

  const one = { id: 1, from: 'a', text: 'old', date: 0, isOwn: false }
  expect(merge([one], [{ ...one, text: 'edited' }, { ...one, id: 0 }]).map(m => m.text)).toEqual(['old', 'edited'])
})

test('a picture shows as a preview and goes to the prompt as a downloaded file', { options: { botToken: '111:AAA' } }, async ($, on) => {
  const rounds: unknown[][] = []
  telegram(on, rounds)
  const clock = stubs(on)
  const filled: string[] = []
  const downloads: string[] = []
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('process.run', ($, e) => {
    if (e.argv[0] !== 'curl') return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    downloads.push(e.argv[4] ?? '')
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', () => ({ value: false }) as never)
  on('fs.read', () => ({ value: { base64: 'AAAA' } }) as never)
  await $.session.start({ cwd: '/p/alpha', surface: 'desktop', isInteractive: true } as never)
  const asked = await $.command.run({ command: 'tg-link', args: '' } as never)
  const code = /Link code: (\w{6})/.exec(asked.text ?? '')?.[1]
  const photo = [
    { file_id: 'small', width: 90, height: 60 },
    { file_id: 'mid', width: 320, height: 213 },
    { file_id: 'big', width: 1280, height: 853 },
  ]
  rounds.push([
    update(1, `/link ${code}`),
    { update_id: 3, message: { message_id: 3, date: 1_700_000_003, chat: GROUP, from: { id: 7, first_name: 'Анна' }, photo, caption: 'Тест' } },
  ])
  await clock.advance(3000)
  // The preview is the ~320px copy, kept under ~/.claude, not in the project.
  expect(downloads).toEqual(['/Users/t/.claude/tg-bridge/files/111/-100500/3-preview.jpg'])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { title: 'Telegram', bodyColumns: 80 } as never })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Тест/ })).toBeDefined()
  await ui.press({ key: 'q3' })
  expect(downloads[1]).toBe('/Users/t/.claude/tg-bridge/files/111/-100500/3.jpg')
  expect(filled).toEqual(['Тест\n@/Users/t/.claude/tg-bridge/files/111/-100500/3.jpg'])
  await ui.unmount()

  // The terminal draws no Svg: a word stands for the picture there.
  const term = await $.ui.mount({ ...PANE, surface: 'terminal', props: { title: 'Telegram', bodyColumns: 80 } as never })
  expect(await term.find({ type: 'Text', text: /\[picture\]/ })).toBeDefined()
  await term.unmount()
})

test('every session of a linked project opens the pane by itself, a worktree too', { options: { botToken: '111:AAA' } }, async ($, on) => {
  const rounds: unknown[][] = []
  telegram(on, rounds)
  mock.store(on, {
    token: '111:AAA',
    '111:links': { '/p/app': { chatId: GROUP.id, title: GROUP.title } },
    [`111:msgs:${GROUP.id}`]: [{ id: 5, from: 'Анна', text: 'Из группы', date: 1_700_000_005, isOwn: false }],
  })
  mock.env(on, { HOME: '/Users/t' })
  const clock = mock.clock(on)
  const opened: string[] = []
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  // The session runs in a worktree of /p/app: git names the main checkout's .git.
  on('process.run', ($, e) => ({
    value: { exitCode: 0, stdout: '/p/app/.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  await $.session.start({ cwd: '/elsewhere/worktrees/app-fix', surface: 'desktop', isInteractive: true } as never)
  await clock.settle()
  expect(opened).toEqual(['tg-bridge'])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { title: 'Telegram', bodyColumns: 80 } as never })
  expect(await ui.find({ type: 'Text', text: /Из группы/ })).toBeDefined()
  await ui.unmount()

  // Once a session: later rounds leave a pane the person closed closed.
  await clock.advance(9000)
  expect(opened).toEqual(['tg-bridge'])
})

test('with autoOpen off the pane waits for /tg', { options: { botToken: '111:AAA', autoOpen: false } }, async ($, on) => {
  telegram(on, [])
  mock.store(on, { token: '111:AAA', '111:links': { '/p/app': { chatId: GROUP.id, title: GROUP.title } } })
  mock.env(on, { HOME: '/Users/t' })
  const clock = mock.clock(on)
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/p/app', surface: 'desktop', isInteractive: true } as never)
  await clock.advance(3000)
  expect(opened).toEqual([])
})

test('a file goes to the prompt under its own name; the answer button is there before any turn', { options: { botToken: '111:AAA' } }, async ($, on) => {
  const rounds: unknown[][] = []
  const calls = telegram(on, rounds)
  const clock = stubs(on)
  const filled: string[] = []
  const downloads: string[] = []
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('process.run', ($, e) => {
    if (e.argv[0] === 'curl') downloads.push(e.argv[4] ?? '')
    // Claude Desktop speaks Russian here: the pane does too.
    const stdout = e.argv[0] === 'grep' ? '"locale": "ru-RU"' : ''
    return { value: { exitCode: e.argv[0] === 'curl' || e.argv[0] === 'grep' ? 0 : 128, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', () => ({ value: false }) as never)
  // A resumed session: the reply is in the transcript, no turn ran in this run.
  on('session.messages', () => ({ value: [{ role: 'assistant' as const, text: 'Готово: кнопка синяя.', toolUses: [] }] }) as never)
  await $.session.start({ cwd: '/p/alpha', surface: 'desktop', isInteractive: true } as never)
  const asked = await $.command.run({ command: 'tg-link', args: '' } as never)
  const code = /Код привязки: (\w{6})/.exec(asked.text ?? '')?.[1]
  const document = { file_id: 'doc1', file_name: 'ТЗ v2/final.docx', mime_type: 'application/msword', file_size: 52_000 }
  rounds.push([
    update(1, `/link ${code}`),
    { update_id: 4, message: { message_id: 4, date: 1_700_000_004, chat: GROUP, from: { id: 7, first_name: 'Анна' }, document } },
  ])
  await clock.advance(3000)
  // No preview is fetched for a file that is no picture.
  expect(downloads).toEqual([])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { title: 'Telegram', bodyColumns: 80 } as never })
  expect(await ui.find({ type: 'Text', text: /📎 ТЗ v2\/final\.docx/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /51 КБ/ })).toBeDefined()
  expect((await ui.find({ key: 'send-answer' }) as { props?: { label?: string } } | undefined)?.props?.label).toBe('Отправить последний ответ Claude')
  await ui.press({ key: 'q4' })
  expect(downloads).toEqual(['/Users/t/.claude/tg-bridge/files/111/-100500/4-ТЗ_v2_final.docx'])
  expect(filled).toEqual(['@/Users/t/.claude/tg-bridge/files/111/-100500/4-ТЗ_v2_final.docx'])

  await ui.press({ key: 'send-answer' })
  const sent = calls.filter(c => c.method === 'sendMessage' && c.body.chat_id === GROUP.id)
  expect(sent[sent.length - 1]?.body).toEqual({ chat_id: GROUP.id, text: 'Готово: кнопка синяя.', parse_mode: 'HTML' })
  await ui.unmount()
})

test('Claude\'s Markdown becomes the HTML Telegram draws', async () => {
  expect(inlineHtml('**bold** and *it* and `a<b>` [site](https://x.io/?a=1&b=2) ~~old~~ snake_case_name 2*3*4'))
    .toBe('<b>bold</b> and <i>it</i> and <code>a&lt;b&gt;</code> <a href="https://x.io/?a=1&amp;b=2">site</a> <s>old</s> snake_case_name 2*3*4')

  const [piece] = telegramPieces([
    '## Итог',
    '',
    '- первый **пункт**',
    '  - вложенный',
    '1. по номеру',
    '',
    '> цитата',
    '',
    '```ts',
    'const a = 1 < 2',
    '```',
    '',
    '| Файл | Строк |',
    '|---|---|',
    '| `lib.ts` | 120 |',
  ].join('\n'))
  expect(piece?.html).toBe([
    '<b>Итог</b>',
    '',
    '• первый <b>пункт</b>',
    '   • вложенный',
    '1. по номеру',
    '',
    '<blockquote>цитата</blockquote>',
    '',
    '<pre><code class="language-ts">const a = 1 &lt; 2</code></pre>',
    '',
    '<pre>Файл    Строк\nlib.ts  120</pre>',
  ].join('\n'))
  expect(piece?.plain).toContain('const a = 1 < 2')
  // The plain twin (the pane's copy, and what goes if Telegram refuses the HTML) carries no Markdown marks.
  expect(piece?.plain).toContain('• первый пункт')

  // A long reply is cut between blocks, each piece whole HTML.
  const long = telegramPieces(Array.from({ length: 300 }, (_, i) => `**строка ${i}** текст текст текст`).join('\n'))
  expect(long.length).toBeGreaterThan(1)
  for (const one of long) expect(one.html.split('<b>').length).toBe(one.html.split('</b>').length)
})

test('a reply Telegram cannot parse as HTML goes as plain text', { options: { botToken: '111:AAA' } }, async ($, on) => {
  const rounds: unknown[][] = []
  const bodies: Record<string, unknown>[] = []
  on('http.fetch', ($, e) => {
    const method = e.url.split('/').pop() ?? ''
    const body = JSON.parse(String(e.init?.body ?? '{}')) as Record<string, unknown>
    if (method === 'sendMessage') bodies.push(body)
    let answer: unknown = { ok: true, result: true }
    if (method === 'getMe') answer = { ok: true, result: { id: 111, is_bot: true, username: 'demo_bot' } }
    if (method === 'getUpdates') answer = { ok: true, result: rounds.shift() ?? [] }
    if (method === 'sendMessage') {
      answer = body.parse_mode
        ? { ok: false, error_code: 400, description: "Bad Request: can't parse entities" }
        : { ok: true, result: { message_id: 950, date: 1_700_000_000 } }
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(answer) } } as never
  })
  const clock = stubs(on)
  on('session.messages', () => ({ value: [{ role: 'assistant' as const, text: '**Готово**', toolUses: [] }] }) as never)
  await $.session.start({ cwd: '/p/alpha', surface: 'desktop', isInteractive: true } as never)
  const asked = await $.command.run({ command: 'tg-link', args: '' } as never)
  const code = /Link code: (\w{6})/.exec(asked.text ?? '')?.[1]
  rounds.push([update(1, `/link ${code}`)])
  await clock.advance(3000)

  const done = await $.command.run({ command: 'tg-send', args: '' } as never)
  expect(done.text).toBe('Sent to Telegram.')
  // The bot's own word on the link aside.
  const toGroup = bodies.filter(b => b.chat_id === GROUP.id).slice(1)
  expect(toGroup.map(b => [b.text, b.parse_mode])).toEqual([['<b>Готово</b>', 'HTML'], ['Готово', undefined]])
})
