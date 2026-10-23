// @vitest-environment jsdom
/**
 * ReferenceChip visual face: icon selection per appearance, the trigger
 * marker fallback, label truncation container, and invalid styling.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ReferenceChip } from '../src/client/input/editor/ReferenceChip.tsx'

afterEach(cleanup)

describe('ReferenceChip', () => {
  it('renders the domain icon and the label', () => {
    const { container, getByTitle } = render(
      <ReferenceChip label="Research notes" appearance="session" invalid={false} />,
    )
    expect(getByTitle('Research notes')).toBeTruthy()
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).toBe('Research notes')
  })

  it('falls back to the trigger marker without an appearance', () => {
    const { container } = render(<ReferenceChip label="commit-helper" invalid={false} />)
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).toBe('@commit-helper')
  })

  it('renders a skill as an openable pill with the skill icon and its display title', () => {
    const { container } = render(<ReferenceChip label="飞书套件" appearance="skill" invalid={false} />)
    const chip = container.firstElementChild
    expect(container.textContent).toBe('飞书套件')
    expect(container.querySelector('svg')).not.toBeNull()
    expect([...(chip?.classList ?? [])].some(name => name.includes('skill'))).toBe(true)
  })

  it('applies the invalid styling bit', () => {
    const { container } = render(<ReferenceChip label="gone" appearance="folder" invalid />)
    const chip = container.firstElementChild
    expect(chip).not.toBeNull()
    expect([...(chip?.classList ?? [])].some(name => name.includes('invalid'))).toBe(true)
  })
})
