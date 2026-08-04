import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, ImageOff, Loader2, RefreshCw, Search } from 'lucide-react'
import axios from '@/lib/axios'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useCountries } from '@/components/CountrySelect'

type CreativeItem = {
  id: number
  source: 'meta' | 'google' | 'tiktok'
  source_ad_id: string
  source_url: string | null
  status: string
  advertiser: { id: number; name: string; domain: string | null } | null
  headline: string | null
  body: string | null
  call_to_action: string | null
  preview: { url: string; type: 'image' | 'video' | 'thumbnail'; mime_type: string } | null
  variants_count: number
  started_at: string | null
  ended_at: string | null
  last_collected_at: string
}

type CreativeResponse = {
  data: CreativeItem[]
  meta: { current_page: number; last_page: number; per_page: number; total: number }
  coverage: Record<string, { status: string; last_collected_at: string | null }>
}

type CreativeParams = {
  page: number
  per_page: number
  search?: string
  source?: 'meta' | 'google' | 'tiktok'
  country?: string
  format?: 'image' | 'video' | 'carousel' | 'text'
}

const sourceLabels = { meta: 'Meta', google: 'Google', tiktok: 'TikTok' }

function date(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

export default function CreativeLibrary({ platform, externalId, compact = false }: {
  platform?: 'ios' | 'android'
  externalId?: string
  compact?: boolean
}) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<'all' | 'meta' | 'google' | 'tiktok'>('all')
  const [format, setFormat] = useState<'all' | 'image' | 'video' | 'carousel' | 'text'>('all')
  const [country, setCountry] = useState('all')
  const { data: countries } = useCountries()
  const queryClient = useQueryClient()
  const appMode = Boolean(platform && externalId)
  const params = useMemo<CreativeParams>(() => ({
    page, per_page: compact ? 12 : 24,
    ...(search && !appMode ? { search } : {}),
    ...(source !== 'all' ? { source } : {}),
    ...(format !== 'all' ? { format } : {}),
    ...(country !== 'all' ? { country } : {}),
  }), [appMode, compact, country, format, page, search, source])
  const query = useQuery({
    queryKey: ['creative-library', platform, externalId, params],
    queryFn: async () => (await axios.get<CreativeResponse>(appMode
      ? `/apps/${platform!}/${encodeURIComponent(externalId!)}/creatives`
      : '/creatives', { params })).data,
  })
  const sync = useMutation({ mutationFn: () => axios.post(`/apps/${platform!}/${encodeURIComponent(externalId!)}/creatives/sync`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['creative-library', platform, externalId] }) })
  const items = (query.data?.data ?? []).filter((item) => !appMode || !search || `${item.headline ?? ''} ${item.body ?? ''} ${item.advertiser?.name ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search ads or advertisers" className="pl-8" />
        </div>
        <select aria-label="Source" value={source} onChange={(event) => { setSource(event.target.value as typeof source); setPage(1) }} className="h-8 rounded-lg border bg-background px-2 text-sm">
          <option value="all">All sources</option><option value="meta">Meta</option><option value="google">Google</option><option value="tiktok">TikTok</option>
        </select>
        <select aria-label="Format" value={format} onChange={(event) => { setFormat(event.target.value as typeof format); setPage(1) }} className="h-8 rounded-lg border bg-background px-2 text-sm">
          <option value="all">All formats</option><option value="image">Images</option><option value="video">Videos</option><option value="carousel">Carousels</option><option value="text">Text</option>
        </select>
        <select aria-label="Country" value={country} onChange={(event) => { setCountry(event.target.value); setPage(1) }} className="h-8 rounded-lg border bg-background px-2 text-sm">
          <option value="all">All countries</option>
          {countries?.filter((item) => item.code !== 'zz').slice(0, 30).map((item) => <option key={item.code} value={item.code}>{item.emoji} {item.name}</option>)}
        </select>
        {appMode && (
          <Button size="sm" variant="outline" disabled={sync.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}Refresh
          </Button>
        )}
      </div>

      {!compact && query.data?.coverage && (
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {(['meta', 'google', 'tiktok'] as const).map((item) => <Badge key={item} variant="outline">{sourceLabels[item]} · {query.data!.coverage[item]?.status ?? 'not collected'}</Badge>)}
        </div>
      )}

      {query.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="aspect-[4/5] rounded-xl" />)}</div>
      ) : query.isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center"><p>Unable to load ad creatives.</p><Button className="mt-3" variant="outline" onClick={() => query.refetch()}>Try again</Button></div>
      ) : items.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
          <ImageOff className="mb-3 h-8 w-8 text-muted-foreground" />
          <h3 className="font-medium">No public ads collected yet</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">Coverage is progressive and depends on public availability from Meta, Google and TikTok.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {items.map((item) => (
            <Card key={item.id} className="gap-3 pt-0">
              <div className="aspect-video overflow-hidden bg-muted">
                {item.preview?.type === 'video' ? (
                  <video src={item.preview.url} controls preload="metadata" className="h-full w-full object-contain" />
                ) : item.preview ? (
                  <img src={item.preview.url} alt={item.headline ?? `${sourceLabels[item.source]} ad`} loading="lazy" className="h-full w-full object-contain" />
                ) : <div className="flex h-full items-center justify-center"><ImageOff className="h-7 w-7 text-muted-foreground" /></div>}
              </div>
              <CardHeader>
                <div className="flex items-center gap-2"><Badge variant="outline">{sourceLabels[item.source]}</Badge><Badge variant="secondary">{item.status}</Badge></div>
                <CardTitle className="line-clamp-2">{item.headline || item.advertiser?.name || 'Untitled creative'}</CardTitle>
                <p className="text-xs text-muted-foreground">{item.advertiser?.name}</p>
              </CardHeader>
              <CardContent className="flex-1"><p className="line-clamp-4 text-sm text-muted-foreground">{item.body || 'No public ad copy supplied.'}</p></CardContent>
              <CardFooter className="justify-between gap-3 text-xs text-muted-foreground">
                <span>{date(item.started_at)} · {item.variants_count} variant{item.variants_count === 1 ? '' : 's'}</span>
                {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground hover:underline">Source <ExternalLink className="h-3 w-3" /></a>}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {query.data && query.data.meta.last_page > 1 && (
        <div className="flex items-center justify-center gap-3"><Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span className="text-sm text-muted-foreground">{page} / {query.data.meta.last_page}</span><Button variant="outline" disabled={page >= query.data.meta.last_page} onClick={() => setPage((value) => value + 1)}>Next</Button></div>
      )}
    </section>
  )
}
