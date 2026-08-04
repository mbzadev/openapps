import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Search, Smartphone, Star, ArrowRight, GitCompare, BarChart3, KeyRound } from 'lucide-react'
import { useSearchApps } from '@/api/endpoints/apps/apps'
import { type AppSearchResultResourcePlatform, SearchAppsPlatform } from '@/api/models'
import { useDebounce } from '@/hooks/use-debounce'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import CountrySelect from '@/components/CountrySelect'
import FilterBar from '@/components/FilterBar'
import PlatformSwitcher from '@/components/PlatformSwitcher'

const modes = {
  '/aso/explorer': {
    title: 'Keyword Explorer',
    description: 'Find any store app and open its live ASO keyword analysis.',
    icon: KeyRound,
    action: 'Explore keywords',
  },
  '/aso/compare': {
    title: 'Keyword Compare',
    description: 'Choose a primary app, then compare its keywords with tracked competitors.',
    icon: GitCompare,
    action: 'Compare keywords',
  },
  '/aso/density': {
    title: 'Keyword Density',
    description: 'Analyze one-to-four-word phrases from the current store listing.',
    icon: BarChart3,
    action: 'Analyze density',
  },
} as const

export default function AsoIndex() {
  const { pathname } = useLocation()
  const mode = modes[pathname as keyof typeof modes] ?? modes['/aso/explorer']
  const Icon = mode.icon
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearch = useDebounce(searchTerm)
  const [platform, setPlatform] = useState<AppSearchResultResourcePlatform>(SearchAppsPlatform.ios)
  const [countryCode, setCountryCode] = useState('us')

  const { data: results, isFetching } = useSearchApps(
    { term: debouncedSearch, platform, country_code: countryCode },
    { query: { enabled: debouncedSearch.trim().length >= 2 } },
  )

  return (
    <div className="flex h-full flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{mode.title}</h1>
          <p className="text-sm text-muted-foreground">{mode.description}</p>
        </div>
      </div>

      <FilterBar>
        <FilterBar.Search
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search an app to analyze..."
        />
        <FilterBar.Controls>
          <PlatformSwitcher
            value={platform}
            onChange={(value) => setPlatform(value as AppSearchResultResourcePlatform)}
          />
          <CountrySelect value={countryCode} onChange={setCountryCode} className="w-full sm:w-[180px]" />
        </FilterBar.Controls>
      </FilterBar>

      {searchTerm.trim().length < 2 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Search className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <p className="font-medium">Search the App Store or Google Play</p>
          <p className="mt-1 text-sm text-muted-foreground">ASO analysis uses the latest live store listing.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {isFetching ? 'Searching stores…' : `${results?.length ?? 0} app${results?.length === 1 ? '' : 's'} found`}
          </h2>
          {results && results.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {results.map((app) => (
                <div key={app.external_id} className="flex items-center gap-4 rounded-xl border p-4">
                  {app.icon_url ? (
                    <img src={app.icon_url} alt={app.name} className="h-14 w-14 shrink-0 rounded-xl" />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-muted">
                      <Smartphone className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{app.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{app.publisher?.name ?? app.publisher_name ?? '—'}</p>
                    <div className="mt-1 flex items-center gap-2">
                      {app.category && <Badge variant="secondary" className="text-[10px]">{app.category.name}</Badge>}
                      {app.rating ? (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
                          {app.rating.toFixed(1)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Button size="sm" render={<Link to={`/apps/${platform}/${app.external_id}?tab=keywords`} />}>
                    <span className="hidden xl:inline">{mode.action}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : !isFetching ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">No apps found.</div>
          ) : null}
        </div>
      )}
    </div>
  )
}
