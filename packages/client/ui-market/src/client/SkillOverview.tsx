/**
 * Overview of an installed skill: its SKILL.md instructions rendered as
 * Markdown (frontmatter removed by the Host), with a search box that marks
 * every match in the rendered text and steps through them.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular, IconCloseOutlineRegular, IconSearchOutlineRegular, Input,
  MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillDetailProps } from './SkillDetail.tsx'
import css from './SkillDetail.module.css'

type Loaded = { readonly status: 'loading' } | { readonly status: 'ready'; readonly content: string } | { readonly status: 'failed'; readonly reason: string }

/** Props of the overview: the dialog's props plus the section heading the search box shares a row with. */
export type SkillOverviewProps = SkillDetailProps & { heading: ReactNode }

/**
 * Render the overview of one installed skill.
 * @param props - the skill name, the document reader, copy and the section heading.
 * @returns the heading with the rendered instructions, a loading line, or the failure.
 */
export function SkillOverview(props: SkillOverviewProps): ReactNode {
  const { skill, t, heading } = props
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  useEffect(() => {
    let live = true
    setLoaded({ status: 'loading' })
    void props.readSkillDocument(skill).then((result) => {
      if (!live) return
      setLoaded(result.ok ? { status: 'ready', content: result.value.content } : { status: 'failed', reason: reasonOf(result.error) })
    })
    return () => { live = false }
  }, [skill, props.readSkillDocument])
  const labels = useMemo((): MarkdownLabels => ({
    code: {
      copyLabel: t('copy'), copiedLabel: t('copied'),
      toolbarLabels: { codeLabel: t('codeBlock'), wrapLabel: t('wrap'), unwrapLabel: t('unwrap') },
    },
    footnotes: t('footnotes'),
  }), [t])

  if (loaded.status === 'loading') return <>{heading}<p className={css.muted}>{t('overviewLoading')}</p></>
  if (loaded.status === 'failed') {
    return <>{heading}<p className={css.muted} role="alert">{t('overviewFailed', { reason: loaded.reason })}</p></>
  }
  return <SearchableDocument {...props} content={loaded.content} labels={labels} />
}

function SearchableDocument({ t, content, labels, heading }: SkillOverviewProps & { content: string; labels: MarkdownLabels }): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState(0)
  const [current, setCurrent] = useState(0)
  // Marks are DOM-only decorations over the rendered Markdown; they are rebuilt whenever the query or the document changes.
  useLayoutEffect(() => {
    const root = host.current
    if (root === null) return
    clearMarks(root)
    const needle = searching ? query.trim().toLowerCase() : ''
    const count = needle === '' ? 0 : markMatches(root, needle)
    setHits(count)
    setCurrent(0)
    return () => { clearMarks(root) }
  }, [searching, query, content])
  useLayoutEffect(() => {
    const marks = host.current?.querySelectorAll<HTMLElement>('mark[data-overview-hit]') ?? []
    marks.forEach((mark, index) => { mark.toggleAttribute('data-current', index === current) })
    marks[current]?.scrollIntoView({ block: 'nearest' })
  }, [current, hits])
  const step = (delta: number): void => {
    if (hits === 0) return
    setCurrent(value => (value + delta + hits) % hits)
  }
  return (
    <div className={css.overview}>
      <div className={css.overviewTools}>
        {heading}
        {searching
          ? (
            <div className={css.overviewSearch}>
              <Input className={css.overviewSearchInput ?? ''} type="search" autoFocus value={query}
                icon={<IconSearchOutlineRegular size={14} />} placeholder={t('overviewSearch')} aria-label={t('overviewSearch')}
                onChange={(event) => { setQuery(event.currentTarget.value) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1) }
                  if (event.key === 'Escape') { event.stopPropagation(); setSearching(false); setQuery('') }
                }} />
              <span className={css.overviewCount} aria-live="polite">
                {t('overviewSearchCount', { current: String(hits === 0 ? 0 : current + 1), total: String(hits) })}
              </span>
              <Button variant="ghost" size="sm" aria-label={t('overviewSearchPrevious')} disabled={hits === 0} onClick={() => { step(-1) }}>
                <IconChevronUpOutlineRegular size={14} />
              </Button>
              <Button variant="ghost" size="sm" aria-label={t('overviewSearchNext')} disabled={hits === 0} onClick={() => { step(1) }}>
                <IconChevronDownOutlineRegular size={14} />
              </Button>
              <Button variant="ghost" size="sm" aria-label={t('overviewSearchClose')}
                onClick={() => { setSearching(false); setQuery('') }}>
                <IconCloseOutlineRegular size={14} />
              </Button>
            </div>
          )
          : (
            <Button variant="ghost" size="sm" aria-label={t('overviewSearch')} title={t('overviewSearch')} onClick={() => { setSearching(true) }}>
              <IconSearchOutlineRegular size={14} />
            </Button>
          )}
      </div>
      <div ref={host} className={css.document}>
        <MarkdownText text={content} labels={labels} variant="compact" />
      </div>
    </div>
  )
}

/** Wrap every case-insensitive occurrence of `needle` in text outside code blocks; returns how many were wrapped. */
function markMatches(root: HTMLElement, needle: string): number {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement?.closest('pre') === null ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  })
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node as Text)
  let count = 0
  for (const node of nodes) {
    const value = node.data
    const lower = value.toLowerCase()
    let at = lower.indexOf(needle)
    if (at < 0) continue
    const fragment = root.ownerDocument.createDocumentFragment()
    let cursor = 0
    while (at >= 0) {
      fragment.append(value.slice(cursor, at))
      const mark = root.ownerDocument.createElement('mark')
      mark.setAttribute('data-overview-hit', '')
      mark.textContent = value.slice(at, at + needle.length)
      fragment.append(mark)
      count += 1
      cursor = at + needle.length
      at = lower.indexOf(needle, cursor)
    }
    fragment.append(value.slice(cursor))
    node.replaceWith(fragment)
  }
  return count
}

function clearMarks(root: HTMLElement): void {
  for (const mark of root.querySelectorAll('mark[data-overview-hit]')) mark.replaceWith(...mark.childNodes)
  root.normalize()
}

function reasonOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return String(error)
}
