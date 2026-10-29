import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReasoningSelector } from './ReasoningSelector'

vi.mock('@/lib/hooks/use-models', () => ({
  useModels: () => ({ data: [
    { id: 'model:known', supported_reasoning_efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'model:unknown', supported_reasoning_efforts: [] },
  ] }),
  useModelDefaults: () => ({ data: { default_chat_model: 'model:known' } }),
}))

describe('native reasoning selector', () => {
  it('offers six levels but disables unknown or unsupported ones', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ReasoningSelector onChange={onChange} />)
    expect(screen.getByRole('option', { name: 'ultra' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'max' })).not.toBeDisabled()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'high' } })
    expect(onChange).toHaveBeenCalledWith('high')
    rerender(<ReasoningSelector modelId="model:unknown" onChange={onChange} />)
    expect(screen.getByRole('option', { name: 'low' })).toBeDisabled()
    expect(screen.getByRole('option', { name: 'max' })).toBeDisabled()
  })
})
