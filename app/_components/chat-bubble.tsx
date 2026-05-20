// Shared WhatsApp-style message bubble used by every DB-fed conversation view.
// Kept as a server component so it renders without shipping any client JS.
export type BubbleMessage = {
  direction: 'in' | 'out' | 'info'
  senderName: string | null
  isAgent: boolean | null
  body: string | null
  imageUrl: string | null
  fileName: string | null
  caption: string | null
  replyToName: string | null
  replyToText: string | null
  timestampLabel: string | null
}

export function ChatBubble({ message: m }: { message: BubbleMessage }) {
  if (m.direction === 'info') {
    return (
      <div className="flex justify-center py-1">
        <span className="rounded-full bg-zinc-200 px-3 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
          {m.body ?? '—'}
        </span>
      </div>
    )
  }
  const isOut = m.direction === 'out'
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
          isOut
            ? 'bg-sky-500 text-white dark:bg-sky-600'
            : 'bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
        }`}
      >
        {m.senderName && (
          <p
            className={`text-xs font-semibold ${isOut ? 'text-sky-100' : 'text-zinc-500 dark:text-zinc-400'}`}
          >
            {m.isAgent ? `Agent · ${m.senderName}` : m.senderName}
          </p>
        )}
        {(m.replyToName || m.replyToText) && (
          <div
            className={`mt-1 rounded-md border-l-2 px-2 py-1 text-xs ${
              isOut
                ? 'border-sky-200 bg-sky-400/30 text-sky-50'
                : 'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300'
            }`}
          >
            {m.replyToName && <p className="font-semibold">{m.replyToName}</p>}
            {m.replyToText && <p className="whitespace-pre-wrap">{m.replyToText}</p>}
          </div>
        )}
        {m.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={m.imageUrl}
            alt=""
            className="mt-1 max-h-72 rounded-md object-contain"
            loading="lazy"
          />
        )}
        {m.fileName && (
          <div
            className={`mt-1 flex items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
              isOut ? 'bg-sky-400/40' : 'bg-zinc-100 dark:bg-zinc-900'
            }`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
            <span className="truncate">{m.fileName}</span>
          </div>
        )}
        {m.body && <p className="mt-1 whitespace-pre-wrap">{m.body}</p>}
        {m.caption && (
          <p
            className={`mt-1 whitespace-pre-wrap text-xs ${isOut ? 'text-sky-50' : 'text-zinc-600 dark:text-zinc-400'}`}
          >
            {m.caption}
          </p>
        )}
        {m.timestampLabel && (
          <p
            className={`mt-1 text-right text-[10px] ${isOut ? 'text-sky-100' : 'text-zinc-400 dark:text-zinc-500'}`}
          >
            {m.timestampLabel}
          </p>
        )}
      </div>
    </div>
  )
}
