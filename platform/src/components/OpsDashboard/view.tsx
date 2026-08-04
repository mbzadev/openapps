'use client'

import { useCallback, useEffect, useState } from 'react'
import type { OpsSummary } from './types'

type Tab = 'overview' | 'sources' | 'runs' | 'errors' | 'creatives' | 'settings'

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Vue globale' },
  { id: 'sources', label: 'Connecteurs' },
  { id: 'runs', label: 'Exécutions' },
  { id: 'errors', label: 'Erreurs et DLQ' },
  { id: 'creatives', label: 'Créatifs' },
  { id: 'settings', label: 'Réglages' },
]

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Jamais'

export function OpsDashboardClient() {
  const [summary, setSummary] = useState<OpsSummary | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const refresh = useCallback(async () => {
    const response = await fetch('/payload-api/ops/summary', { credentials: 'include', cache: 'no-store' })
    if (!response.ok) throw new Error(`Chargement impossible (${response.status})`)
    setSummary(await response.json() as OpsSummary)
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => {
      refresh().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
    }, 0)
    const timer = window.setInterval(() => refresh().catch(() => undefined), 15_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [refresh])

  const action = async (body: Record<string, unknown>) => {
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/payload-api/ops/actions', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      const result = await response.json().catch(() => ({})) as { message?: string }
      if (!response.ok) throw new Error(result.message ?? `Action refusée (${response.status})`)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="openapps-ops">
      <header className="openapps-ops__header">
        <div><h1>Collecte et synchronisation</h1><div className="openapps-ops__muted">État réel des Workers, connecteurs et files OpenApps</div></div>
        <div className="openapps-ops__actions">
          <button disabled={pending} onClick={() => refresh().catch((cause) => setError(String(cause)))}>Actualiser</button>
          <button className="primary" disabled={pending} onClick={() => action({ action: 'dispatch-creatives' })}>Lancer la collecte due</button>
        </div>
      </header>

      <nav className="openapps-ops__tabs" aria-label="Exploitation" role="tablist">
        {tabs.map((item) => <button aria-selected={tab === item.id} key={item.id} onClick={() => setTab(item.id)} role="tab">{item.label}</button>)}
      </nav>

      {error && <div className="openapps-ops__error" role="alert">{error}</div>}
      {!summary ? <p>Chargement des données opérationnelles…</p> : <DashboardTab summary={summary} tab={tab} action={action} pending={pending} />}
    </main>
  )
}

function DashboardTab({ action, pending, summary, tab }: { action: (body: Record<string, unknown>) => Promise<void>; pending: boolean; summary: OpsSummary; tab: Tab }) {
  if (tab === 'overview') return <Overview summary={summary} />
  if (tab === 'sources') return <Sources summary={summary} />
  if (tab === 'runs') return <Runs summary={summary} />
  if (tab === 'errors') return <Errors action={action} pending={pending} summary={summary} />
  if (tab === 'creatives') return <Creatives summary={summary} />
  return <Settings summary={summary} />
}

function Metrics({ summary }: { summary: OpsSummary }) {
  const metrics = [
    ['En file', summary.queues.queued],
    ['En cours', summary.queues.running],
    ['Réussies · 24 h', summary.queues.completed24h],
    ['Échecs · 24 h', summary.queues.failed24h],
  ]
  return <div className="openapps-ops__metrics">{metrics.map(([label, value]) => <div className="openapps-ops__metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
}

function Overview({ summary }: { summary: OpsSummary }) {
  return <><Metrics summary={summary} /><div className="openapps-ops__grid"><Sources summary={summary} compact /><Runs summary={summary} compact /></div></>
}

function Sources({ compact = false, summary }: { compact?: boolean; summary: OpsSummary }) {
  return <section><h2>Connecteurs</h2><table className="openapps-ops__table"><thead><tr><th>Source</th><th>État</th><th>Transport</th>{!compact && <th>Secret</th>}<th>Dernier succès</th></tr></thead><tbody>
    {summary.sources.map((source) => <tr key={source.source}><td><strong>{source.label}</strong><br /><span className="openapps-ops__muted">{source.source}</span></td><td><span className="openapps-ops__status"><i className={`openapps-ops__dot ${source.health === 'failing' ? 'danger' : source.health === 'limited' || source.health === 'unknown' ? 'warning' : ''}`} />{source.enabled ? source.health : 'disabled'}</span></td><td>{source.transport}</td>{!compact && <td>{source.secretStatus}</td>}<td>{formatDate(source.lastSuccessAt)}</td></tr>)}
  </tbody></table></section>
}

function Runs({ compact = false, summary }: { compact?: boolean; summary: OpsSummary }) {
  const runs = compact ? summary.recentRuns.slice(0, 5) : summary.recentRuns
  return <section><h2>Exécutions récentes</h2><table className="openapps-ops__table"><thead><tr><th>Source</th><th>État</th><th>Résultats</th>{!compact && <th>Motif</th>}<th>Démarrage</th></tr></thead><tbody>
    {runs.map((run) => <tr key={run.id}><td>{run.source}</td><td>{run.status}</td><td>{run.resultCount}</td>{!compact && <td>{run.reason}</td>}<td>{formatDate(run.startedAt)}</td></tr>)}
    {!runs.length && <tr><td colSpan={compact ? 4 : 5}>Aucune exécution enregistrée.</td></tr>}
  </tbody></table></section>
}

function Errors({ action, pending, summary }: { action: (body: Record<string, unknown>) => Promise<void>; pending: boolean; summary: OpsSummary }) {
  return <section><h2>Erreurs et dead letters</h2>{summary.deadLetters.map((item) => <div className="openapps-ops__row" key={item.id}><div><strong>{item.kind}</strong> · {item.source ?? 'interne'}<br /><span className="openapps-ops__muted">{item.errorMessage} · {formatDate(item.failedAt)}</span></div><button disabled={pending || item.status !== 'open'} onClick={() => action({ action: 'retry-dead-letter', id: item.id })}>Relancer</button></div>)}{!summary.deadLetters.length && <p>Aucune tâche en DLQ.</p>}</section>
}

function Creatives({ summary }: { summary: OpsSummary }) {
  const metrics = [['Publicités', summary.creatives.ads], ['Médias archivés', summary.creatives.assets], ['Associations apps', summary.creatives.linked], ['Candidats à vérifier', summary.creatives.candidates]]
  return <section><h2>Créatifs collectés</h2><div className="openapps-ops__metrics">{metrics.map(([label, value]) => <div className="openapps-ops__metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><p className="openapps-ops__muted">Les associations incertaines sont modifiables dans la collection « Associations publicités/apps ».</p></section>
}

function Settings({ summary }: { summary: OpsSummary }) {
  return <section><h2>Réglages et sécurité</h2><div className="openapps-ops__row"><div><strong>Rafraîchissement du dashboard</strong><br /><span className="openapps-ops__muted">Toutes les 15 secondes, sans lecture directe des secrets.</span></div><span>Actif</span></div><div className="openapps-ops__row"><div><strong>Dernière mesure</strong><br /><span className="openapps-ops__muted">{formatDate(summary.generatedAt)}</span></div><span>{summary.sources.length} sources</span></div></section>
}
