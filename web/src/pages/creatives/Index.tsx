import CreativeLibrary from '@/components/creatives/CreativeLibrary'

export default function CreativesIndex() {
  return <div className="flex flex-col gap-5 p-4 md:p-6"><div><h1 className="text-2xl font-semibold tracking-tight">Ad Creative Library</h1><p className="mt-1 text-sm text-muted-foreground">Public campaigns collected from Meta, Google and TikTok across OpenApps countries.</p></div><CreativeLibrary /></div>
}
