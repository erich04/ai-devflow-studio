import { redirect } from 'next/navigation'

// Keep existing bookmarks usable after retiring the duplicate management shell.
export default async function LegacyShell({ searchParams }: {
  searchParams?: Promise<{ projectId?: string }>
}) {
  const projectId = (await searchParams)?.projectId
  redirect(`/?view=team${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`)
}
