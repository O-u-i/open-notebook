'use client'

import { useModelDefaults, useModels } from '@/lib/hooks/use-models'
import { useTranslation } from '@/lib/hooks/use-translation'
import { ReasoningEffort } from '@/lib/types/api'

const levels: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']

export function ReasoningSelector({ modelId, effort, onChange, disabled }: {
  modelId?: string | null
  effort?: ReasoningEffort | null
  onChange: (effort: ReasoningEffort | null) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const { data: models = [] } = useModels()
  const { data: defaults } = useModelDefaults()
  const model = models.find(item => item.id === (modelId || defaults?.default_chat_model))
  const supported = model?.supported_reasoning_efforts ?? []
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {t('reader.reasoning')}
      <select aria-label={t('reader.reasoning')} value={effort ?? 'default'} disabled={disabled}
        onChange={event => onChange(event.target.value === 'default' ? null : event.target.value as ReasoningEffort)}
        className="max-w-36 rounded-md border bg-background px-2 py-1 text-foreground">
        <option value="default">{t('reader.modelDefault')}</option>
        {levels.map(level => <option key={level} value={level} disabled={!supported.includes(level)}
          title={!supported.includes(level) ? t('reader.reasoningUnavailable') : undefined}>{level}</option>)}
      </select>
    </label>
  )
}
