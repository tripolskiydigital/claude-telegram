/** The languages of the interface; another desktop language reads English. */
export type Lang = 'en' | 'ru'

/** A picture a message carries: Telegram's file ids for it and a small copy. */
export type TgPhoto = {
  fileId: string
  /** A copy about 320px wide, for the pane; absent when Telegram made none. */
  thumbId?: string
  width: number
  height: number
}

/** A file a message carries that is no picture (md, docx, pdf, ...). */
export type TgFile = { fileId: string; name: string; size?: number }

/** One message of the linked group as the pane shows it. */
export type TgMessage = {
  /** Telegram's message_id, unique within the chat. */
  id: number
  /** Who wrote it: the person's name, or the bot's for what the pane sent. */
  from: string
  text: string
  /** Seconds since the epoch, as Telegram dates it. */
  date: number
  /** Sent by the bot (from this pane). */
  isOwn: boolean
  photo?: TgPhoto
  file?: TgFile
}

/** The group a project folder is linked to. */
export type TgLink = { chatId: number; title: string }

/** A link code waiting for the group to answer it. */
export type TgPending = { code: string; url: string; command: string }

declare module 'claude-code' {
  interface PluginState {
    'tg-bridge': {
      messages: TgMessage[]
      link: TgLink | null
      pending: TgPending | null
      lastAnswer: string
      status: string
      composeRev: number
      /** The bot's @username once its token answered; '' with no working token. */
      bot: string
      editingToken: boolean
      /** Previews of the linked group's pictures, as data URIs, by message id. */
      thumbs: Record<string, string>
      lang: Lang
    }
  }
}
