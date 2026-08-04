import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  serverExternalPackages: ['jose', 'pg-cloudflare'],
  transpilePackages: ['@openapps/core', '@openapps/web-worker'],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }
    return config
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
