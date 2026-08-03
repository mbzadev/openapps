import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, Bot, Cloud, Code2, Database, Globe2, Layers3, ShieldCheck } from 'lucide-react'

const features = [
  { icon: BarChart3, title: 'Store intelligence', text: 'Classements, notes, mots-clés, versions et changements pour iOS et Android.' },
  { icon: Layers3, title: 'Suivi concurrentiel', text: 'Organisez vos apps, dossiers et concurrents dans un espace isolé par compte.' },
  { icon: Bot, title: '29 outils MCP', text: 'Un endpoint Streamable HTTP OAuth 2.1 et un client stdio compatible.' },
  { icon: Database, title: 'Données Cloudflare', text: 'D1, KV, R2, Queues et Durable Objects sans serveur à administrer.' },
  { icon: ShieldCheck, title: 'Sécurisé par défaut', text: 'Sessions HttpOnly, tokens opaques, PBKDF2 et quotas Cloudflare natifs.' },
  { icon: Globe2, title: 'Déploiement global', text: 'La SPA, l’API, la documentation et le MCP sont servis depuis le réseau Cloudflare.' },
]

export default function Landing() {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <Link to="/" className="flex items-center gap-3 font-semibold">
          <img src="/openapps-icon.png" alt="" className="h-9 w-9 rounded-xl" />
          <span>OpenApps <span className="text-emerald-400">by MBZA</span></span>
        </Link>
        <nav className="flex items-center gap-5 text-sm text-slate-300">
          <a href="/docs" className="hover:text-white">Documentation</a>
          <a href="https://github.com/mbzadev/openapps" className="hover:text-white" aria-label="GitHub"><Code2 className="h-5 w-5" /></a>
          <Link to="/login" className="hover:text-white">Connexion</Link>
          <Link to="/register" className="rounded-lg bg-emerald-400 px-4 py-2 font-semibold text-emerald-950 hover:bg-emerald-300">Créer un compte</Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl gap-14 px-6 pb-24 pt-20 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-300">
              <Cloud className="h-4 w-4" /> 100 % Cloudflare-native
            </div>
            <h1 className="max-w-4xl text-5xl font-bold tracking-tight sm:text-7xl">
              Comprenez les stores. <span className="text-emerald-400">Agissez plus vite.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300">
              OpenApps by MBZA centralise la recherche, le suivi et l’analyse des applications App Store et Google Play dans une plateforme mondiale, automatisée et ouverte aux agents MCP.
            </p>
            <div className="mt-10 flex flex-wrap gap-4">
              <Link to="/register" className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-6 py-3 font-semibold text-emerald-950 hover:bg-emerald-300">Commencer gratuitement <ArrowRight className="h-4 w-4" /></Link>
              <a href="/docs" className="rounded-xl border border-slate-700 px-6 py-3 font-semibold hover:border-slate-500">Voir la documentation</a>
            </div>
          </div>
          <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-emerald-950/30">
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 font-mono text-sm">
              <p className="text-slate-500"># Connecter un client MCP distant</p>
              <p className="mt-4 text-emerald-300">https://apps.mbza.dev/mcp</p>
              <div className="my-6 h-px bg-slate-800" />
              <p className="text-slate-500"># Client stdio compatible</p>
              <p className="mt-4 text-slate-200">OPENAPPS_API_URL=https://apps.mbza.dev/api/v1</p>
              <p className="text-slate-200">OPENAPPS_API_TOKEN=&lt;token&gt;</p>
              <p className="mt-4 text-emerald-300">npm start -w @openapps/mcp</p>
            </div>
          </div>
        </section>

        <section className="border-y border-slate-800 bg-slate-900/40">
          <div className="mx-auto grid max-w-7xl gap-5 px-6 py-24 md:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, text }) => (
              <article key={title} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-7">
                <Icon className="h-6 w-6 text-emerald-400" />
                <h2 className="mt-5 text-xl font-semibold">{title}</h2>
                <p className="mt-3 leading-7 text-slate-400">{text}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-10 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 OpenApps by MBZA · MIT</p>
        <div className="flex gap-5"><a href="/docs">Docs</a><a href="https://github.com/mbzadev/openapps">GitHub</a><a href="/api/v1/health">API</a></div>
      </footer>
    </div>
  )
}
