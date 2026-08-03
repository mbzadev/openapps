import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react'

export type Location = { pathname: string; search: string; hash: string; state: unknown; key: string }
type NavigateOptions = { replace?: boolean; state?: unknown }
type NavigateFunction = (to: string | number, options?: NavigateOptions) => void
type RouterContextValue = { location: Location; navigate: NavigateFunction }
type RouteProps = { path?: string; element?: ReactNode; children?: ReactNode }
type Branch = { path: string; elements: ReactNode[] }

const RouterContext = createContext<RouterContextValue | null>(null)
const OutletContext = createContext<ReactNode>(null)
const ParamsContext = createContext<Record<string, string>>({})

function browserLocation(): Location {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    state: window.history.state,
    key: String(window.history.state?.key ?? 'initial'),
  }
}

export function BrowserRouter({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(browserLocation)
  useEffect(() => {
    const update = () => setLocation(browserLocation())
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  const navigate = useCallback<NavigateFunction>((to, options = {}) => {
    if (typeof to === 'number') {
      window.history.go(to)
      return
    }
    const target = new URL(to, window.location.href)
    const state = { ...(options.state === undefined ? {} : { state: options.state }), key: crypto.randomUUID() }
    window.history[options.replace ? 'replaceState' : 'pushState'](state, '', `${target.pathname}${target.search}${target.hash}`)
    setLocation(browserLocation())
  }, [])
  return <RouterContext.Provider value={{ location, navigate }}>{children}</RouterContext.Provider>
}

export function Route(props: RouteProps) {
  void props
  return null
}

function collectBranches(children: ReactNode, parents: ReactNode[] = [], branches: Branch[] = []) {
  for (const child of Children.toArray(children)) {
    if (!isValidElement<RouteProps>(child)) continue
    const elements = child.props.element === undefined ? parents : [...parents, child.props.element]
    if (child.props.children !== undefined) collectBranches(child.props.children, elements, branches)
    if (child.props.path !== undefined) branches.push({ path: child.props.path, elements })
  }
  return branches
}

export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  if (pattern === '*') return {}
  const routeSegments = pattern.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  const pathSegments = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  if (routeSegments.length !== pathSegments.length) return null
  const params: Record<string, string> = {}
  for (let index = 0; index < routeSegments.length; index++) {
    const routeSegment = routeSegments[index]!
    const pathSegment = pathSegments[index]!
    if (routeSegment.startsWith(':')) {
      try { params[routeSegment.slice(1)] = decodeURIComponent(pathSegment) } catch { return null }
    } else if (routeSegment !== pathSegment) return null
  }
  return params
}

export function Routes({ children }: { children: ReactNode }) {
  const { location } = useRouter()
  const branches = useMemo(() => collectBranches(children), [children])
  const selected = branches.map((branch) => ({ branch, params: matchPath(branch.path, location.pathname) })).find(({ params }) => params !== null)
  if (!selected) return null
  let outlet: ReactNode = null
  for (const element of [...selected.branch.elements].reverse()) {
    outlet = <OutletContext.Provider value={outlet}>{element}</OutletContext.Provider>
  }
  return <ParamsContext.Provider value={selected.params!}>{outlet}</ParamsContext.Provider>
}

export function Outlet() {
  return useContext(OutletContext)
}

export function Navigate({ to, replace = false, state }: { to: string; replace?: boolean; state?: unknown }) {
  const navigate = useNavigate()
  useEffect(() => navigate(to, { replace, state }), [navigate, replace, state, to])
  return null
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string; replace?: boolean; state?: unknown }

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ to, replace, state, onClick, target, ...props }, ref) {
  const navigate = useNavigate()
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || target === '_blank') return
    const destination = new URL(to, window.location.href)
    if (destination.origin !== window.location.origin) return
    event.preventDefault()
    navigate(`${destination.pathname}${destination.search}${destination.hash}`, { replace, state })
  }
  return <a {...props} ref={ref} href={to} target={target} onClick={handleClick} />
})

function useRouter() {
  const value = useContext(RouterContext)
  if (!value) throw new Error('Router hooks must be used inside BrowserRouter')
  return value
}

export function useNavigate() {
  return useRouter().navigate
}

export function useLocation() {
  return useRouter().location
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>() {
  return useContext(ParamsContext) as T
}

type SearchParamsInit = string | string[][] | Record<string, string | string[]> | URLSearchParams
type SetSearchParams = (next: SearchParamsInit | ((previous: URLSearchParams) => SearchParamsInit), options?: NavigateOptions) => void

function toSearchParams(init: SearchParamsInit) {
  if (typeof init === 'string' || init instanceof URLSearchParams || Array.isArray(init)) return new URLSearchParams(init)
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(init)) {
    if (Array.isArray(value)) for (const item of value) params.append(key, item)
    else params.set(key, value)
  }
  return params
}

export function useSearchParams(): [URLSearchParams, SetSearchParams] {
  const { location, navigate } = useRouter()
  const params = useMemo(() => new URLSearchParams(location.search), [location.search])
  const setParams = useCallback<SetSearchParams>((next, options) => {
    const resolved = typeof next === 'function' ? next(new URLSearchParams(location.search)) : next
    const search = toSearchParams(resolved).toString()
    navigate(`${location.pathname}${search ? `?${search}` : ''}${location.hash}`, options)
  }, [location.hash, location.pathname, location.search, navigate])
  return [params, setParams]
}
