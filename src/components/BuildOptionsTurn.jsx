import OptionsCard from './OptionsCard'

const AGENT_NAMES = { claude: 'Claude', gpt: 'ChatGPT', gemini: 'Gemini', grok: 'Grok', deepseek: 'DeepSeek' }

function ConsensusMeter({ score }) {
  return (
    <span className="bo-meter" title={`${score}/4 of the panel endorse this`} aria-label={`Consensus ${score} of 4`}>
      {[1, 2, 3, 4].map(i => <span key={i} className={i <= score ? 'on' : ''}>●</span>)}
    </span>
  )
}

/**
 * Renders the panel-debated build options as a chooser. The panel already
 * debated (those turns are above); this turns the debate into 3-4 concrete
 * directions. Picking one runs that plan; "something different" re-prompts.
 */
export default function BuildOptionsTurn({ options = [], onBuild, onSomethingDifferent }) {
  const cardOptions = options.map(o => ({
    title: o.name,
    description: o.description,
    accent: '#6fa1ff',
    badge: <ConsensusMeter score={o.consensus} />,
    meta: (
      <span className="bo-meta">
        {o.est_cost && <span>{o.est_cost}</span>}
        {o.est_time && <span> · {o.est_time}</span>}
        {o.champions?.length > 0 && <span> · Championed by {o.champions.map(a => AGENT_NAMES[a] || a).join(' + ')}</span>}
      </span>
    ),
    detail: o.arguments || null,
  }))

  return (
    <div className="ai-turn bo-turn">
      <div className="bo-head">The panel debated it — pick a direction.</div>
      <OptionsCard
        title="Build options"
        options={cardOptions}
        onSelect={(_, i) => onBuild?.(options[i])}
        somethingDifferent={{ onSubmit: (t) => onSomethingDifferent?.(t) }}
      />
    </div>
  )
}
