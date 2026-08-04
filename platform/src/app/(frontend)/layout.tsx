import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './styles.css'

export const metadata: Metadata = {
  title: 'OpenApps',
  description: 'App store intelligence and public advertising creatives.',
}

export default function FrontendLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head><link href="/legacy/assets/openapps.css" rel="stylesheet" /></head>
      <body>{children}</body>
    </html>
  )
}
