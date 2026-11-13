// @vitest-environment jsdom
/** Local skill uploads retain the selected file on failure and prevent repeated installation. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SkillImportValue } from '@deepseek-ai/dsh-market-skills/types'
import { en, zh } from '../src/client/locales.ts'
import type { MarketResult } from '../src/client/market-store.ts'
import type { MarketPageProps } from '../src/client/MarketPage.tsx'
import { UploadSkillDialog, type UploadSkillDialogProps } from '../src/client/UploadSkillDialog.tsx'

function translate(copy: Readonly<Record<keyof typeof en, string>>): MarketPageProps['t'] {
  return (key, params) => {
    const template: string = key in copy ? copy[key as keyof typeof copy] : key
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] as string | number | undefined ?? ''))
  }
}

function propsOf(copy: Readonly<Record<keyof typeof en, string>> = zh): UploadSkillDialogProps {
  return {
    t: translate(copy), onClose: vi.fn(), onInstalled: vi.fn(),
    onImport: vi.fn(() => Promise.resolve({ ok: true as const, value: { name: 'my-skill' } })),
  }
}

function choose(file: File, label: string = zh.uploadFile): HTMLInputElement {
  const input = screen.getByLabelText<HTMLInputElement>(label)
  fireEvent.change(input, { target: { files: [file] } })
  return input
}

afterEach(() => { cleanup() })

it('shows the file picker immediately and keeps installation disabled until a file is chosen', () => {
  const props = propsOf()
  render(<UploadSkillDialog {...props} />)
  expect(screen.getByLabelText(zh.uploadFile)).toBeTruthy()
  expect(screen.getByRole('button', { name: zh.uploadChoose }).hasAttribute('disabled')).toBe(false)
  expect(screen.getByRole('button', { name: zh.install }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
  expect(props.onClose).toHaveBeenCalledOnce()
})

it('opens the file picker when the drop area is clicked', () => {
  render(<UploadSkillDialog {...propsOf()} />)
  const input = screen.getByLabelText<HTMLInputElement>(zh.uploadFile)
  const click = vi.spyOn(input, 'click')
  fireEvent.click(screen.getByRole('button', { name: zh.uploadChoose }))
  expect(click).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: zh.uploadBrowse }))
  expect(click).toHaveBeenCalledTimes(2)
  expect(screen.getByText(zh.uploadDropHint)).toBeTruthy()
  expect(screen.getByRole('region', { name: zh.uploadRequirements }).textContent).toContain(zh.uploadArchiveRequirement)
  expect(screen.getByRole('region', { name: zh.uploadRequirements }).textContent).toContain(zh.uploadMetadataRequirement)
})

it.each(['skill.MD', 'skill.zip'])('selects dropped %s without importing until Install is clicked', async (name) => {
  const props = propsOf()
  render(<UploadSkillDialog {...props} />)
  const area = screen.getByRole('button', { name: zh.uploadChoose })
  const file = new File(['skill'], name)
  const dataTransfer = { types: ['Files'], files: [file], items: [], dropEffect: 'none' }
  const documentDrop = vi.fn()
  document.addEventListener('drop', documentDrop)
  try {
    expect(fireEvent.dragEnter(area, { dataTransfer })).toBe(false)
    expect(area.dataset.dragging).toBe('true')
    expect(fireEvent.dragOver(area, { dataTransfer })).toBe(false)
    expect(dataTransfer.dropEffect).toBe('copy')
    expect(fireEvent.drop(area, { dataTransfer })).toBe(false)
    expect(area.dataset.dragging).toBeUndefined()
    expect(screen.getByText(name)).toBeTruthy()
    expect(documentDrop).not.toHaveBeenCalled()
    expect(props.onImport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: zh.install }))
    await vi.waitFor(() => { expect(props.onInstalled).toHaveBeenCalledOnce() })
    expect(props.onImport).toHaveBeenCalledExactlyOnceWith(file)
  } finally { document.removeEventListener('drop', documentDrop) }
})

it('keeps nested file drags highlighted until the pointer leaves the whole area', () => {
  render(<UploadSkillDialog {...propsOf()} />)
  const area = screen.getByRole('button', { name: zh.uploadChoose })
  const hint = screen.getByText(zh.uploadDropHint)
  const dataTransfer = { types: ['Files'], files: [], items: [], dropEffect: 'none' }
  const textTransfer = { types: ['text/plain'], files: [], items: [], dropEffect: 'none' }
  expect(fireEvent.dragEnter(area, { dataTransfer: textTransfer })).toBe(true)
  expect(fireEvent.dragOver(area, { dataTransfer: textTransfer })).toBe(true)
  expect(fireEvent.drop(area, { dataTransfer: textTransfer })).toBe(true)
  expect(area.dataset.dragging).toBeUndefined()
  fireEvent.dragEnter(area, { dataTransfer })
  fireEvent.dragEnter(hint, { dataTransfer })
  fireEvent.dragLeave(hint, { dataTransfer })
  expect(area.dataset.dragging).toBe('true')
  fireEvent.dragLeave(area, { dataTransfer })
  expect(area.dataset.dragging).toBeUndefined()
  fireEvent.dragEnter(area, { dataTransfer })
  fireEvent.dragEnd(area, { dataTransfer })
  expect(area.dataset.dragging).toBeUndefined()
})

it('contains file drops outside the area while open and restores document handling when closed', () => {
  const documentDrop = vi.fn()
  document.addEventListener('drop', documentDrop)
  try {
    const view = render(<UploadSkillDialog {...propsOf()} />)
    const area = screen.getByRole('button', { name: zh.uploadChoose })
    const transfer = { types: ['Files'], files: [new File(['skill'], 'skill.md')], items: [], dropEffect: 'copy' }
    fireEvent.dragEnter(area, { dataTransfer: transfer })
    expect(area.dataset.dragging).toBe('true')
    expect(fireEvent.dragEnter(document.body, { dataTransfer: transfer })).toBe(false)
    expect(area.dataset.dragging).toBeUndefined()
    expect(fireEvent.dragOver(document.body, { dataTransfer: transfer })).toBe(false)
    expect(transfer.dropEffect).toBe('none')
    expect(fireEvent.drop(document.body, { dataTransfer: transfer })).toBe(false)
    expect(documentDrop).not.toHaveBeenCalled()
    expect(screen.queryByText('skill.md')).toBeNull()
    const hint = screen.getByText(zh.uploadHint)
    expect(fireEvent.dragEnter(hint, { dataTransfer: transfer })).toBe(false)
    expect(fireEvent.drop(hint, { dataTransfer: transfer })).toBe(false)
    expect(documentDrop).not.toHaveBeenCalled()
    view.unmount()
    expect(fireEvent.dragOver(document.body, { dataTransfer: transfer })).toBe(true)
    expect(fireEvent.drop(document.body, { dataTransfer: transfer })).toBe(true)
    expect(documentDrop).toHaveBeenCalledOnce()
  } finally { document.removeEventListener('drop', documentDrop) }
})

it('validates dropped files, retains the prior selection for multi-file and folder drops, and can recover', () => {
  const props = propsOf()
  render(<UploadSkillDialog {...props} />)
  const area = screen.getByRole('button', { name: zh.uploadChoose })
  const drop = (files: File[], items: object[] = []): void => {
    fireEvent.drop(area, { dataTransfer: { types: ['Files'], files, items, dropEffect: 'none' } })
  }
  drop([new File(['invalid'], 'skill.txt')])
  expect(screen.getByRole('alert').textContent).toBe(zh.uploadInvalidType)
  drop([new File([], 'skill.md')])
  expect(screen.getByRole('alert').textContent).toBe(zh.uploadEmpty)
  const file = new File(['skill'], 'keep.md')
  drop([file])
  drop([new File(['a'], 'a.md'), new File(['b'], 'b.md')])
  expect(screen.getByText('keep.md')).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toBe(zh.uploadSingleFile)
  drop([new File([], 'folder.zip')], [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }])
  expect(screen.getByText('keep.md')).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toBe(zh.uploadInvalidType)
  drop([])
  expect(screen.getByText('keep.md')).toBeTruthy()
  drop([file])
  expect(screen.queryByRole('alert')).toBeNull()
  expect(props.onImport).not.toHaveBeenCalled()
})

it.each([
  { file: new File(['content'], 'skill.txt'), expected: zh.uploadInvalidType },
  { file: new File([], 'skill.md'), expected: zh.uploadEmpty },
])('keeps $file.name visible and prevents importing it when invalid', ({ file, expected }) => {
  const props = propsOf()
  render(<UploadSkillDialog {...props} />)
  const input = choose(file)
  expect(input.accept).toBe('.zip,.md')
  expect(input.value).toBe('')
  expect(screen.getByText(file.name)).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toBe(expected)
  fireEvent.click(screen.getByRole('button', { name: zh.install }))
  expect(props.onImport).not.toHaveBeenCalled()
  choose(new File(['valid'], 'skill.md'))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('button', { name: zh.install }).hasAttribute('disabled')).toBe(false)
})

it('allows a file larger than 10 MiB and still displays its size', async () => {
  const props = propsOf()
  render(<UploadSkillDialog {...props} />)
  const file = new File(['skill'], 'large.zip')
  Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 })
  choose(file)
  expect(screen.getByText('11MB')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.install }))
  await vi.waitFor(() => { expect(props.onInstalled).toHaveBeenCalledOnce() })
  expect(props.onImport).toHaveBeenCalledExactlyOnceWith(file)
})

it('retains the chosen file after a duplicate-name refusal and can import it again', async () => {
  const file = new File(['skill'], 'my-skill.zip')
  const props = propsOf()
  const onImport = vi.fn()
    .mockResolvedValueOnce({ ok: false, error: { code: 'market-skills/import-conflict', details: { name: 'my-skill', source: 'user' } } })
    .mockResolvedValueOnce({ ok: true, value: { name: 'my-skill' } })
  render(<UploadSkillDialog {...props} onImport={onImport} />)
  choose(file)
  fireEvent.click(screen.getByRole('button', { name: zh.install }))
  await vi.waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('已存在名为 my-skill 的技能，请修改上传技能的 name，或先移除已有技能') })
  expect(screen.getByText(file.name)).toBeTruthy()
  expect(props.onInstalled).not.toHaveBeenCalled()
  expect(props.onClose).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: zh.install }))
  await vi.waitFor(() => { expect(props.onInstalled).toHaveBeenCalledOnce() })
  expect(onImport).toHaveBeenNthCalledWith(1, file)
  expect(onImport).toHaveBeenNthCalledWith(2, file)
})

it('blocks duplicate submission, file changes, Escape and close while the import is pending', async () => {
  let finish: (result: MarketResult<SkillImportValue>) => void = () => { throw new Error('Import was not started') }
  const pending = new Promise<MarketResult<SkillImportValue>>((resolve) => { finish = resolve })
  const props = propsOf()
  const onImport = vi.fn(() => pending)
  render(<UploadSkillDialog {...props} onImport={onImport} />)
  const file = new File(['skill'], 'skill.MD')
  const input = choose(file)
  fireEvent.click(screen.getByRole('button', { name: zh.install }))
  expect(screen.getByRole('button', { name: zh.installing }).hasAttribute('disabled')).toBe(true)
  expect(input.disabled).toBe(true)
  expect(screen.getByRole('button', { name: zh.uploadChange }).hasAttribute('disabled')).toBe(true)
  const area = screen.getByRole('button', { name: zh.uploadChange })
  const transfer = { types: ['Files'], files: [new File(['other'], 'other.zip')], items: [], dropEffect: 'copy' }
  fireEvent.dragEnter(area, { dataTransfer: transfer })
  fireEvent.dragOver(area, { dataTransfer: transfer })
  expect(transfer.dropEffect).toBe('none')
  fireEvent.drop(area, { dataTransfer: transfer })
  expect(screen.queryByText('other.zip')).toBeNull()
  expect(screen.getByText('skill.MD')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.installing }))
  fireEvent.click(screen.getByRole('button', { name: zh.close }))
  fireEvent.click(screen.getByRole('button', { name: zh.cancel }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onImport).toHaveBeenCalledExactlyOnceWith(file)
  expect(props.onClose).not.toHaveBeenCalled()
  finish({ ok: true, value: { name: 'my-skill' } })
  await vi.waitFor(() => { expect(props.onInstalled).toHaveBeenCalledOnce() })
})

it.each([
  { error: { code: 'client-market/file-read-failed' }, expected: zh.uploadInvalidData },
  { error: { code: 'market-skills/import-invalid', details: { reason: 'invalid-archive' } }, expected: zh.uploadInvalidArchive },
  { error: { code: 'market-skills/import-invalid', details: { reason: 'invalid-skill' } }, expected: zh.uploadInvalidSkill },
  { error: { code: 'market-skills/import-invalid', details: { reason: 'unsafe-path' } }, expected: zh.uploadUnsafeArchive },
  { error: { code: 'market-skills/import-failed', details: { reason: 'private diagnostic' } }, expected: zh.uploadFailed },
  { error: { code: 'gateway/disconnected' }, expected: zh.uploadUnknown },
])('shows localized feedback for $error.code without exposing diagnostics', async ({ error, expected }) => {
  const props = propsOf()
  render(<UploadSkillDialog {...props} onImport={() => Promise.resolve({ ok: false, error })} />)
  choose(new File(['skill'], 'skill.zip'))
  fireEvent.click(screen.getByRole('button', { name: zh.install }))
  await vi.waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(expected) })
  expect(props.onInstalled).not.toHaveBeenCalled()
  expect(props.onClose).not.toHaveBeenCalled()
})

it('contains a rejected call and shows the English unknown-outcome recovery step', async () => {
  const props = propsOf(en)
  render(<UploadSkillDialog {...props} onImport={() => Promise.reject(new Error('transport failed'))} />)
  choose(new File(['skill'], 'skill.zip'), en.uploadFile)
  fireEvent.click(screen.getByRole('button', { name: en.install }))
  await vi.waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en.uploadUnknown) })
  expect(screen.getByRole('button', { name: en.install }).hasAttribute('disabled')).toBe(false)
})
