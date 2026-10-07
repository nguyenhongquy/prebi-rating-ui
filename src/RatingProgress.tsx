import { Check, Circle, CircleDot } from 'lucide-react'
import { answerError, evaluationSteps } from './ratingValidation'
import type { Draft, Packet } from './ratingTypes'
import './RatingProgress.css'

export default function RatingProgress({ packet, draft, activeIndex, onNavigate }: {
  packet: Packet
  draft: Draft
  activeIndex: number
  onNavigate: (index: number) => void
}) {
  const steps = evaluationSteps(packet)
  const complete = steps.filter((_, index) => !answerError(packet, draft, index)).length
  return <div className="rating-stepper">
    <p className="draft-progress">{complete} / {steps.length} Kriterien vollständig bewertet</p>
    <nav aria-label="Bewertungskriterien"><ol>
      {steps.map((step, index) => {
        const answered = !answerError(packet, draft, index)
        const Icon = answered ? Check : index === activeIndex ? CircleDot : Circle
        return <li key={step.id}><button aria-current={index === activeIndex ? 'step' : undefined} onClick={() => onNavigate(index)} title={answered ? 'Bewertung vollständig' : 'Bewertung unvollständig'}>
          <Icon size={18} aria-hidden="true" /><span>{index + 1}. {step.label}</span><small>{answered ? 'Bewertet' : 'Offen'}</small>
        </button></li>
      })}
    </ol></nav>
  </div>
}