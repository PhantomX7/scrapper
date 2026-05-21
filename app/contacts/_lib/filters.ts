// Shared parser for the /contacts list filters. Both the page and the
// /contacts/export route use this so the export always matches what the user
// sees on screen — keeping the two parsers in sync by hand was a tripwire.

export type ContactsSortKey =
  | 'first_chat_desc'
  | 'most_chats'
  | 'most_messages'
  | 'recent'
  | 'oldest'
  | 'name'

export const CONTACTS_DEFAULT_PAGE_SIZE = 25
export const CONTACTS_DEFAULT_SORT: ContactsSortKey = 'first_chat_desc'
export const CONTACTS_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const
const VALID_SORTS: ContactsSortKey[] = [
  'first_chat_desc',
  'most_chats',
  'most_messages',
  'recent',
  'oldest',
  'name',
]

export type ContactsFilterValues = {
  page: number
  size: number
  q: string
  sort: ContactsSortKey
  dateFrom: string
  dateTo: string
  dateFromDate: Date | null
  dateToDate: Date | null
  // Raw comma-separated string as the user typed it — kept verbatim so the
  // input can be re-populated. `keywords` is the cleaned list used for matching.
  kw: string
  keywords: string[]
}

type GetParam = (key: string) => string | undefined

export function parseContactsFilters(get: GetParam): ContactsFilterValues {
  const page = Math.max(1, Number(get('page')) || 1)
  const sizeRaw = Number(get('size'))
  const size = (CONTACTS_PAGE_SIZE_OPTIONS as readonly number[]).includes(sizeRaw)
    ? sizeRaw
    : CONTACTS_DEFAULT_PAGE_SIZE
  const q = (get('q') ?? '').trim()
  const sortRaw = get('sort') as ContactsSortKey | undefined
  const sort: ContactsSortKey = VALID_SORTS.includes(sortRaw as ContactsSortKey)
    ? (sortRaw as ContactsSortKey)
    : CONTACTS_DEFAULT_SORT

  const dateFrom = (get('dateFrom') ?? '').trim()
  const dateTo = (get('dateTo') ?? '').trim()

  // dateFrom starts the day at 00:00:00, dateTo ends it at 23:59:59.999 so
  // the range is inclusive on both ends in local time.
  const dateFromDate = parseLocalDate(dateFrom, 'start')
  const dateToDate = parseLocalDate(dateTo, 'end')

  const kw = (get('kw') ?? 'Preview I').trim()
  const keywords = kw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  return {
    page,
    size,
    q,
    sort,
    dateFrom,
    dateTo,
    dateFromDate,
    dateToDate,
    kw,
    keywords,
  }
}

// Adapter for the Server Component shape `Record<string, string | string[] | undefined>`.
export function fromRawSearchParams(
  raw: Record<string, string | string[] | undefined>,
): GetParam {
  return (key) => {
    const v = raw[key]
    return Array.isArray(v) ? v[0] : v
  }
}

function parseLocalDate(value: string, edge: 'start' | 'end'): Date | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  const [, y, mo, d] = m
  const year = Number(y)
  const month = Number(mo) - 1
  const day = Number(d)
  return edge === 'start'
    ? new Date(year, month, day, 0, 0, 0, 0)
    : new Date(year, month, day, 23, 59, 59, 999)
}

// Builds the query-string portion (without leading "?") from a filter set,
// omitting defaults so URLs stay tidy.
export function buildContactsQuery(values: {
  page?: number
  size?: number
  q?: string
  sort?: ContactsSortKey
  dateFrom?: string
  dateTo?: string
  kw?: string
}): string {
  const sp = new URLSearchParams()
  if (values.page && values.page !== 1) sp.set('page', String(values.page))
  if (values.size && values.size !== CONTACTS_DEFAULT_PAGE_SIZE) {
    sp.set('size', String(values.size))
  }
  if (values.dateFrom) sp.set('dateFrom', values.dateFrom)
  if (values.dateTo) sp.set('dateTo', values.dateTo)
  if (values.q) sp.set('q', values.q)
  if (values.sort && values.sort !== CONTACTS_DEFAULT_SORT) {
    sp.set('sort', values.sort)
  }
  if (values.kw) sp.set('kw', values.kw)
  return sp.toString()
}
