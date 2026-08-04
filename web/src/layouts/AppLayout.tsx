import { Outlet, Link, useLocation, useParams } from 'react-router-dom'
import {
  Building2,
  TrendingUp,
  Compass,
  Key,
  Camera,
  Image as ImageIcon,
  Smartphone,
  Users,
  FileSearch,
  FileSearch2,
  GitCompare,
  ChartBar as BarIcon,
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import AppLogo from '@/components/AppLogo'
import NavUser from '@/components/NavUser'
import Breadcrumbs, { type BreadcrumbItemData } from '@/components/Breadcrumbs'
import { useShowApp } from '@/api/endpoints/apps/apps'
import type { AppDetailResource } from '@/api/models'
import { useEffect } from 'react'

function useAppData(): AppDetailResource | null {
  const params = useParams()
  const location = useLocation()
  const isAppPage = location.pathname.startsWith('/apps/') && !!params.platform && !!params.externalId

  const { data } = useShowApp(
    (params.platform ?? 'ios') as 'ios' | 'android',
    params.externalId ?? '',
    { query: { enabled: isAppPage } },
  )

  return isAppPage ? (data ?? null) : null
}

function usePageTitle(app: AppDetailResource | null) {
  const location = useLocation()

  useEffect(() => {
    const path = location.pathname
    let title = 'OpenApps'

    if (path === '/discovery/apps') title = 'Discover Apps — OpenApps'
    else if (path === '/discovery/publishers') title = 'Discover Publishers — OpenApps'
    else if (path === '/discovery/trending') title = 'Trending — OpenApps'
    else if (path === '/apps') title = 'Apps — OpenApps'
    else if (path === '/changes/apps') title = 'App Changes — OpenApps'
    else if (path === '/changes/competitors') title = 'Competitor Changes — OpenApps'
    else if (path === '/publishers' || path.startsWith('/publishers/')) title = 'Publishers — OpenApps'
    else if (path === '/competitors') title = 'Competitors — OpenApps'
    else if (path === '/explorer/screenshots') title = 'Screenshots — OpenApps'
    else if (path === '/explorer/icons') title = 'App Icons — OpenApps'
    else if (path.startsWith('/aso/')) title = 'ASO — OpenApps'
    else if (path === '/settings') title = 'Settings — OpenApps'
    else if (app?.name) title = `${app.name} — OpenApps`

    document.title = title
  }, [location.pathname, app?.name])
}

function useBreadcrumbs(app: AppDetailResource | null): BreadcrumbItemData[] {
  const location = useLocation()
  const path = location.pathname

  if (path === '/discovery/apps') {
    return [{ title: 'Discovery', href: '/discovery/apps' }, { title: 'Apps' }]
  }

  if (path === '/discovery/publishers') {
    return [{ title: 'Discovery', href: '/discovery/apps' }, { title: 'Publishers' }]
  }

  if (path === '/discovery/trending') {
    return [{ title: 'Discovery', href: '/discovery/apps' }, { title: 'Trending' }]
  }

  if (path === '/apps') {
    return [{ title: 'Apps', href: '/apps' }]
  }

  if (path === '/publishers') {
    return [{ title: 'Publishers', href: '/publishers' }]
  }

  if (path.startsWith('/publishers/')) {
    return [
      { title: 'Publishers', href: '/publishers' },
      { title: 'Publisher' },
    ]
  }

  if (path === '/competitors') {
    return [{ title: 'Competitors', href: '/competitors' }]
  }

  if (path === '/changes/apps') {
    return [{ title: 'App Changes', href: '/changes/apps' }]
  }

  if (path === '/changes/competitors') {
    return [{ title: 'Competitor Changes', href: '/changes/competitors' }]
  }

  if (path === '/explorer/screenshots') {
    return [{ title: 'Explorer' }, { title: 'Screenshots', href: '/explorer/screenshots' }]
  }

  if (path === '/explorer/icons') {
    return [{ title: 'Explorer' }, { title: 'App Icons', href: '/explorer/icons' }]
  }

  if (path.startsWith('/aso/')) {
    const title = asoItems.find((item) => item.href === path)?.title ?? 'ASO'
    return [{ title: 'ASO' }, { title, href: path }]
  }

  if (path === '/settings') {
    return [{ title: 'Settings', href: '/settings' }]
  }

  if (path.startsWith('/apps/') && app) {
    const items: BreadcrumbItemData[] = [
      { title: 'Apps', href: '/apps' },
    ]
    if (app.publisher?.name && app.publisher.external_id) {
      const pubPlatform = app.publisher.platform ?? app.platform ?? 'ios'
      items.push({
        title: app.publisher.name,
        href: `/publishers/${pubPlatform}/${encodeURIComponent(app.publisher.external_id)}?name=${encodeURIComponent(app.publisher.name)}`,
      })
    } else if (app.publisher?.name) {
      items.push({ title: app.publisher.name })
    }
    items.push({ title: app.name ?? 'Loading...' })
    return items
  }

  if (path.startsWith('/apps/')) {
    return [
      { title: 'Apps', href: '/apps' },
      { title: 'Loading...' },
    ]
  }

  return []
}

interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

const discoveryItems: NavItem[] = [
  { title: 'Trending', href: '/discovery/trending', icon: TrendingUp },
  { title: 'Apps', href: '/discovery/apps', icon: Compass },
  { title: 'Publishers', href: '/discovery/publishers', icon: Building2 },
]

const trackingItems: NavItem[] = [
  { title: 'Apps', href: '/apps', icon: Smartphone },
  { title: 'Competitors', href: '/competitors', icon: Users },
  { title: 'App Changes', href: '/changes/apps', icon: FileSearch },
  { title: 'Competitor Changes', href: '/changes/competitors', icon: FileSearch2 },
]

const asoItems: NavItem[] = [
  { title: 'Keyword Explorer', href: '/aso/explorer', icon: Key },
  { title: 'Keyword Density', href: '/aso/density', icon: BarIcon },
  { title: 'Keyword Compare', href: '/aso/compare', icon: GitCompare },
]

const explorerItems: NavItem[] = [
  { title: 'App Icons', href: '/explorer/icons', icon: ImageIcon },
  { title: 'Screenshots', href: '/explorer/screenshots', icon: Camera },
]

function isNavItemActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavGroup({ label, items, pathname }: { label: string; items: NavItem[]; pathname: string }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                render={<Link to={item.href} />}
                tooltip={item.title}
                isActive={isNavItemActive(item.href, pathname)}
              >
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export default function AppLayout() {
  const location = useLocation()
  const app = useAppData()
  const breadcrumbs = useBreadcrumbs(app)
  usePageTitle(app)

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip="OpenApps" render={<Link to="/discovery/trending" />}>
                <AppLogo />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <NavGroup label="Discovery" items={discoveryItems} pathname={location.pathname} />
          <NavGroup label="Tracking" items={trackingItems} pathname={location.pathname} />
          <NavGroup label="ASO" items={asoItems} pathname={location.pathname} />
          <NavGroup label="Explorer" items={explorerItems} pathname={location.pathname} />
        </SidebarContent>
        <SidebarFooter>
          <NavUser />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/70 backdrop-blur-lg px-4">
          <SidebarTrigger className="-ml-1 shrink-0" />
          <Separator orientation="vertical" className="mr-1 h-4 shrink-0" />
          <div className="min-w-0 flex-1 overflow-hidden">
            <Breadcrumbs items={breadcrumbs} />
          </div>
        </header>
        <main className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
