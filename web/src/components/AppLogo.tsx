export default function AppLogo() {
  return (
    <>
      <img
        src="/openapps-icon.png"
        alt="OpenApps"
        className="aspect-square size-8 shrink-0 rounded-lg object-cover"
      />
      <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate font-semibold">OpenApps</span>
        <span className="truncate text-xs text-muted-foreground">App intelligence</span>
      </div>
    </>
  )
}
