import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ensureMigrated, getDb } from '../../../lib/db/client'
import {
  createChatsRepository,
  createContactsRepository,
  createMessagesRepository,
} from '../../../lib/db/repositories'
import { censorPhone } from '../../../lib/phone'
import { ChatBubble } from '../../_components/chat-bubble'
import { resolveScope } from '../../_lib/scope'

export const dynamic = 'force-dynamic'

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: idParam } = await params
  const contactId = Number(idParam)
  if (!Number.isInteger(contactId) || contactId <= 0) notFound()

  const scope = await resolveScope()
  if (!scope) notFound()

  ensureMigrated()
  const db = getDb()
  const contactsRepo = createContactsRepository(db)
  const chatsRepo = createChatsRepository(db)
  const messagesRepo = createMessagesRepository(db)

  const contact = contactsRepo.findById(
    { companyId: scope.company.id, service: scope.service },
    contactId,
  )
  if (!contact) notFound()

  const [aggregate, chats, messages] = [
    contactsRepo.aggregateForContact(contactId),
    chatsRepo.listForContact(contactId),
    messagesRepo.listForContact(contactId),
  ]

  // Group consecutive messages by chat so we can draw a single separator per
  // chat boundary — cheaper than repeating the chat label on every bubble.
  const groups: Array<{
    chatId: number
    chatExternalId: string
    chatName: string
    chatCreatedAt: Date | null
    items: typeof messages
  }> = []
  for (const m of messages) {
    const last = groups[groups.length - 1]
    if (!last || last.chatId !== m.chatId) {
      groups.push({
        chatId: m.chatId,
        chatExternalId: m.chatExternalId,
        chatName: m.chatName,
        chatCreatedAt: m.chatCreatedAt,
        items: [m],
      })
    } else {
      last.items.push(m)
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10 sm:px-8">
        <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/contacts" className="hover:text-zinc-900 dark:hover:text-zinc-100">
            ← Back to contacts
          </Link>
        </div>

        <header className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {contact.displayName ?? (
                  <span className="italic text-zinc-400">no name</span>
                )}
              </h1>
              <p className="mt-1 font-mono text-sm text-zinc-600 dark:text-zinc-400">
                {censorPhone(contact.phone)}
              </p>
            </div>
          </div>

          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total chats" value={aggregate.chatCount.toLocaleString()} />
            <Stat label="Total messages" value={aggregate.messageCount.toLocaleString()} />
            <Stat label="First chat" value={formatDate(aggregate.firstChatAt)} />
            <Stat label="Last chat" value={formatDate(aggregate.lastChatAt)} />
            <Stat label="First seen" value={formatDate(contact.firstSeenAt)} />
            <Stat label="Last seen" value={formatDate(contact.lastSeenAt)} />
          </dl>
        </header>

        {chats.length > 0 && <ChatsStrip chats={chats} />}

        <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Merged conversation
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              All {aggregate.messageCount.toLocaleString()} message
              {aggregate.messageCount === 1 ? '' : 's'} from every chat, in chronological order.
            </p>
          </header>
          <div className="flex flex-col gap-2 bg-zinc-50 px-4 py-5 dark:bg-zinc-900 sm:px-6">
            {groups.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                No messages captured for this contact yet.
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.chatId} className="flex flex-col gap-2">
                  <ChatSeparator
                    chatId={g.chatId}
                    chatExternalId={g.chatExternalId}
                    chatName={g.chatName}
                    chatCreatedAt={g.chatCreatedAt}
                    messageCount={g.items.length}
                  />
                  {g.items.map((m) => (
                    <ChatBubble key={`${m.chatId}-${m.messageId}`} message={m} />
                  ))}
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

function ChatsStrip({
  chats,
}: {
  chats: Array<{
    id: number
    externalId: string
    name: string
    createdAt: Date | null
    resolvedAt: Date | null
    messageCount: number
  }>
}) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Chats ({chats.length})
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Oldest first · click to open the single chat view
        </p>
      </header>
      <ul className="mt-3 flex flex-wrap gap-2">
        {chats.map((c) => (
          <li key={c.id}>
            <Link
              href={`/chats/${c.id}`}
              className="group flex max-w-xs flex-col gap-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-left transition-colors hover:border-zinc-300 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-950"
            >
              <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {c.name}
              </span>
              <span className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                <span>{formatDate(c.createdAt) ?? '—'}</span>
                <span>·</span>
                <span>
                  {c.messageCount.toLocaleString()} msg
                  {c.messageCount === 1 ? '' : 's'}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ChatSeparator({
  chatId,
  chatExternalId,
  chatName,
  chatCreatedAt,
  messageCount,
}: {
  chatId: number
  chatExternalId: string
  chatName: string
  chatCreatedAt: Date | null
  messageCount: number
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 py-2">
      <span className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
      <Link
        href={`/chats/${chatId}`}
        className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:text-zinc-100"
        title={`#${chatExternalId}`}
      >
        <span className="truncate max-w-48">{chatName}</span>
        {chatCreatedAt && (
          <span className="text-zinc-400 dark:text-zinc-500">· {formatDate(chatCreatedAt)}</span>
        )}
        <span className="text-zinc-400 dark:text-zinc-500">
          · {messageCount.toLocaleString()} msg{messageCount === 1 ? '' : 's'}
        </span>
      </Link>
      <span className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="text-sm text-zinc-900 dark:text-zinc-100">
        {value ?? <span className="text-zinc-400">—</span>}
      </dd>
    </div>
  )
}

function formatDate(d: Date | null | undefined) {
  if (!d) return null
  return d.toLocaleString()
}
