import type { Lang } from '../types'

type Strings = {
  cmdPane: string
  cmdLink: string
  cmdUnlink: string
  cmdSend: string
  cmdSendHint: string
  paneOpened: string
  linkCode: string
  linkByUrl: string
  linkByCommand: string
  sent: string
  noToken: string
  botSilent: string
  noAnswer: string
  webhook: string
  error: string
  codeUnknown: string
  linkedGroupSays: string
  linkedToast: string
  notToken: string
  tokenRefused: string
  botConnected: string
  notLinked: string
  unlinked: string
  notLinkedSend: string
  nothingToSend: string
  notSent: string
  bot: string
  noReplyYet: string
  replySent: string
  downloadFailed: string
  connectBot: string
  otherBot: string
  tokenHelp: string
  tokenElsewhere: string
  tokenSubmit: string
  privacyHelp: string
  cancel: string
  changeBot: string
  groupNotLinked: string
  addByLink: string
  orSendThere: string
  linkGroup: string
  messagePlaceholder: string
  send: string
  sendReply: string
  noMessages: string
  toPrompt: string
  picture: string
  file: string
  bytes: string
  kb: string
  mb: string
}

const STRINGS: Record<Lang, Strings> = {
  en: {
    cmdPane: "Open the pane of the project's Telegram group",
    cmdLink: 'Link a Telegram group to this project',
    cmdUnlink: 'Unlink the Telegram group from this project',
    cmdSend: "Send text to the Telegram group, or with none Claude's last reply",
    cmdSendHint: '[text]',
    paneOpened: 'The Telegram pane is open.',
    linkCode: 'Link code: {code} (valid for 30 minutes).',
    linkByUrl: 'Add the bot to the group with the link {url}',
    linkByCommand: 'or, if the bot is in the group already, send there: {command}',
    sent: 'Sent to Telegram.',
    noToken: 'No bot token: open the pane with /tg and paste it.',
    botSilent: 'The bot does not answer: {error}',
    noAnswer: 'no answer',
    webhook: 'The bot has a webhook set, or another program polls it: getUpdates is not available',
    error: 'error',
    codeUnknown: 'Code {code} is unknown or expired. Run /tg-link in Claude again.',
    linkedGroupSays: 'This group is linked to the project “{project}”.',
    linkedToast: 'Telegram: linked the group “{title}”',
    notToken: 'That does not look like a bot token: 123456789:AA…',
    tokenRefused: 'Telegram did not accept the token: {error}',
    botConnected: 'Telegram: connected the bot @{bot}',
    notLinked: 'This project is not linked to a group.',
    unlinked: 'The project is unlinked from the group “{title}”.',
    notLinkedSend: 'The project is not linked to a group: /tg-link',
    nothingToSend: 'Nothing to send.',
    notSent: 'Not sent: {error}',
    bot: 'bot',
    noReplyYet: 'Claude has not replied in this session yet',
    replySent: "Claude's reply is sent to Telegram",
    downloadFailed: 'Could not download the file from Telegram (bots get files up to 20 MB)',
    connectBot: 'Connect a bot',
    otherBot: 'Another bot',
    tokenHelp:
      'Paste the token @BotFather gave your bot. It is kept on this computer and serves every project; each bot keeps its own group links.',
    tokenElsewhere: 'The token can be pasted in Claude on a computer.',
    tokenSubmit: 'connect',
    privacyHelp: 'For the bot to see every message of the group, in @BotFather: /setprivacy → Disable.',
    cancel: 'Cancel',
    changeBot: '@{bot} · change bot',
    groupNotLinked: 'No group is linked to the project “{project}”',
    addByLink: 'Add the bot to the group with the link:',
    orSendThere: 'or, if the bot is in the group already, send there:',
    linkGroup: 'Link a group',
    messagePlaceholder: 'Message to the group',
    send: 'send',
    sendReply: "Send Claude's last reply",
    noMessages: 'No messages yet. New ones show up here.',
    toPrompt: '→ to prompt',
    picture: 'picture',
    file: 'file',
    bytes: 'B',
    kb: 'KB',
    mb: 'MB',
  },
  ru: {
    cmdPane: 'Открыть панель Telegram-группы проекта',
    cmdLink: 'Привязать Telegram-группу к этому проекту',
    cmdUnlink: 'Отвязать Telegram-группу от этого проекта',
    cmdSend: 'Отправить в Telegram-группу текст, а без текста — последний ответ Claude',
    cmdSendHint: '[текст]',
    paneOpened: 'Панель Telegram открыта.',
    linkCode: 'Код привязки: {code} (действует 30 минут).',
    linkByUrl: 'Добавьте бота в группу по ссылке {url}',
    linkByCommand: 'или, если бот уже в группе, отправьте там: {command}',
    sent: 'Отправлено в Telegram.',
    noToken: 'Не задан токен бота: откройте панель /tg и вставьте его.',
    botSilent: 'Бот не отвечает: {error}',
    noAnswer: 'нет ответа',
    webhook: 'У бота включён webhook или его опрашивает другая программа: getUpdates недоступен',
    error: 'ошибка',
    codeUnknown: 'Код {code} не найден или устарел. Запустите /tg-link в Claude ещё раз.',
    linkedGroupSays: 'Группа привязана к проекту «{project}».',
    linkedToast: 'Telegram: привязана группа «{title}»',
    notToken: 'Это не похоже на токен бота: 123456789:AA…',
    tokenRefused: 'Telegram не принял токен: {error}',
    botConnected: 'Telegram: подключён бот @{bot}',
    notLinked: 'Этот проект не привязан к группе.',
    unlinked: 'Проект отвязан от группы «{title}».',
    notLinkedSend: 'Проект не привязан к группе: /tg-link',
    nothingToSend: 'Нечего отправлять.',
    notSent: 'Не отправлено: {error}',
    bot: 'бот',
    noReplyYet: 'В этой сессии пока нет ответа Claude',
    replySent: 'Ответ Claude отправлен в Telegram',
    downloadFailed: 'Не удалось скачать файл из Telegram (боту доступны файлы до 20 МБ)',
    connectBot: 'Подключите бота',
    otherBot: 'Другой бот',
    tokenHelp:
      'Вставьте токен бота от @BotFather. Он хранится на этом компьютере и общий для всех проектов; привязки групп у каждого бота свои.',
    tokenElsewhere: 'Ввести токен можно в Claude на компьютере.',
    tokenSubmit: 'подключить',
    privacyHelp: 'Чтобы бот видел все сообщения группы, в @BotFather: /setprivacy → Disable.',
    cancel: 'Отмена',
    changeBot: '@{bot} · сменить бота',
    groupNotLinked: 'Группа не привязана к проекту «{project}»',
    addByLink: 'Добавьте бота в группу по ссылке:',
    orSendThere: 'или, если бот уже в группе, отправьте там:',
    linkGroup: 'Привязать группу',
    messagePlaceholder: 'Сообщение в группу',
    send: 'отправить',
    sendReply: 'Отправить последний ответ Claude',
    noMessages: 'Сообщений пока нет. Новые появятся здесь.',
    toPrompt: '→ в промпт',
    picture: 'картинка',
    file: 'файл',
    bytes: 'Б',
    kb: 'КБ',
    mb: 'МБ',
  },
}

export type Key = keyof Strings

export const LANGS = Object.keys(STRINGS) as Lang[]

/** The interface language for a desktop locale (`ru-RU`, `en`): one of LANGS, English otherwise. */
export function langOf(locale: string | undefined): Lang {
  const prefix = locale?.toLowerCase().split(/[-_]/)[0]
  return LANGS.find(lang => lang === prefix) ?? 'en'
}

/** A string of the interface in `lang`, its `{name}` slots filled. */
export function t(lang: Lang, key: Key, vars: Record<string, string | number> = {}): string {
  return STRINGS[lang][key].replace(/\{(\w+)\}/g, (slot, name: string) => (name in vars ? String(vars[name]) : slot))
}

/** `12 KB`, `3.4 MB`: a file's size as the pane shows it, in `lang`'s units. */
export function sizeOf(bytes: number, lang: Lang): string {
  if (bytes < 1024) return `${bytes} ${t(lang, 'bytes')}`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ${t(lang, 'kb')}`
  return `${(bytes / 1024 / 1024).toFixed(1)} ${t(lang, 'mb')}`
}
