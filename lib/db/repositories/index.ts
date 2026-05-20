// Barrel for the repositories module. Each table has its own file under
// ./<table>.ts; this index re-exports the public surface and the
// makeRepositories factory used by transactions.
//
// Adding a new repository: create ./<name>.ts, export
// `create<Name>Repository`, then plug it into makeRepositories below.

import type { DbLike } from './types'
import { createCompaniesRepository } from './companies'
import { createContactsRepository } from './contacts'
import { createChatsRepository } from './chats'
import { createMessagesRepository } from './messages'

export type { DbLike, Scope } from './types'

export {
  createCompaniesRepository,
} from './companies'

export {
  createContactsRepository,
  type ContactAggregateRow,
  type ContactsSort,
  type ListAllContactsInput,
  type ListContactsInput,
  type UpsertContactInput,
} from './contacts'

export {
  createChatsRepository,
  type ChatDetailRow,
  type ChatListRow,
  type ListChatsInput,
  type UpsertChatInput,
} from './chats'

export {
  createMessagesRepository,
  type UpsertMessageInput,
} from './messages'

export function makeRepositories(db: DbLike) {
  return {
    companies: createCompaniesRepository(db),
    contacts: createContactsRepository(db),
    chats: createChatsRepository(db),
    messages: createMessagesRepository(db),
  }
}

export type Repositories = ReturnType<typeof makeRepositories>
