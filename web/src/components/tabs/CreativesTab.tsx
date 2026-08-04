import CreativeLibrary from '@/components/creatives/CreativeLibrary'

export default function CreativesTab({ platform, externalId }: { platform: 'ios' | 'android'; externalId: string }) {
  return <CreativeLibrary platform={platform} externalId={externalId} compact />
}
