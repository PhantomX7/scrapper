import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ensureMigrated, getDb } from '../../../lib/db/client'
import {
  createChatsRepository,
  createMessagesRepository,
} from '../../../lib/db/repositories'
import { censorPhone } from '../../../lib/phone'
import { ChatBubble } from '../../_components/chat-bubble'
import { resolveScope } from '../../_lib/scope'

export const dynamic = 'force-dynamic'

export default async function ChatDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: idParam } = await params
  const id = Number(idParam)
  if (!Number.isInteger(id) || id <= 0) notFound()

  const scope = await resolveScope()
  if (!scope) notFound()

  ensureMigrated()
  const db = getDb()
  const chatsRepo = createChatsRepository(db)
  const messagesRepo = createMessagesRepository(db)

  const chat = chatsRepo.findById(
    { companyId: scope.company.id, service: scope.service },
    id,
  )
  if (!chat) notFound()

  const messages = messagesRepo.listByChat(chat.id)

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10 sm:px-8">
        <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/chats" className="hover:text-zinc-900 dark:hover:text-zinc-100">
            ← Back to chats
          </Link>
        </div>

        <header className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {chat.name}
              </h1>
              <p className="mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                #{chat.externalId}
                {(chat.contactPhoneRaw || chat.contactPhone) && (
                  <> · {censorPhone(chat.contactPhoneRaw ?? chat.contactPhone)}</>
                )}
              </p>
            </div>
          </div>

          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Created" value={formatDate(chat.createdAt)} />
            <Stat label="First response" value={formatDate(chat.firstResponseAt)} />
            <Stat label="First response wait" value={chat.firstResponseWait} />
            <Stat label="Resolved" value={formatDate(chat.resolvedAt)} />
            <Stat label="Case duration" value={chat.caseDuration} />
            <Stat label="Messages" value={chat.messageCount.toLocaleString()} />
            <Stat label="First seen" value={formatDate(chat.scrapedAt)} />
            <Stat label="Last updated" value={formatDate(chat.updatedAt)} />
          </dl>
        </header>

        <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Conversation
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {messages.length} message{messages.length === 1 ? '' : 's'}
            </p>
          </header>
          <div className="flex flex-col gap-2 bg-zinc-50 px-4 py-5 dark:bg-zinc-900 sm:px-6">
            {messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                No messages captured for this chat.
              </p>
            ) : (
              messages.map((m) => <ChatBubble key={`${m.chatId}-${m.messageId}`} message={m} />)
            )}
          </div>
        </section>
      </main>
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


function formatDate(d: Date | null) {
  if (!d) return null
  return d.toLocaleString()
}
