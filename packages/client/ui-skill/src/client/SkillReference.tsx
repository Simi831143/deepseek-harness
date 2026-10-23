/** Skill-reference presentation with activation owned by this keyed entry's Session injection. */
import { useSyncExternalStore } from 'react'
import type { UserTextNodeProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ReferenceChip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { NO_SKILL_LABELS, type SkillLabels } from './presentation.ts'

/** Session-bound preview action; accepting a preview is not a completion promise. */
export interface SkillReferenceInjected {
  /**
   * Ask the skill source to preview a confirmed name in this entry's Session.
   * @param name - skill name without its slash.
   */
  readonly openSkill: (name: string) => void
  /** Display titles other plugins contribute; the chip shows the skill name without one. */
  readonly labels?: HostObservable<SkillLabels>
}

type SkillReferenceProps = UserTextNodeProps<'skill'> & SkillReferenceInjected

/**
 * Render a skill pill (glyph and display title); previews omit activation even when the entry has an injected action.
 * @param props - resolved node, raw token, interaction mode, Session-bound preview action, and display titles.
 * @returns an inline skill label or interactive chip.
 */
export function SkillReference({ node, raw, interactive, openSkill, labels = NO_SKILL_LABELS }: SkillReferenceProps) {
  const name = node.data.name
  const label = useSyncExternalStore(listener => labels.subscribe(listener), () => labels.getSnapshot().get(name))
  return <ReferenceChip
    appearance="skill"
    display="pill"
    label={label ?? name}
    title={raw}
    {...(interactive ? { onActivate: () => { openSkill(name) } } : {})}
  />
}
