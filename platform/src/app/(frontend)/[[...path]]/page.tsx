import Script from 'next/script'
import { redirect } from 'next/navigation'

export default async function OpenAppsPage({
  params,
}: {
  params: Promise<{ path?: string[] }>
}) {
  const { path } = await params

  if (!path?.length) {
    redirect('/login')
  }

  return (
    <>
      <div id="root" />
      <Script src="/config.js" strategy="beforeInteractive" />
      <Script src="/legacy/assets/openapps.js" strategy="afterInteractive" type="module" />
    </>
  )
}
