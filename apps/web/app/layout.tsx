import './globals.css'
import type { Metadata } from 'next'
import { themeInitializationScript } from './theme-preference'

export const metadata: Metadata = {
  title: 'AI DevFlow Studio',
  description: 'Team overview for AI development workflow runs.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} /></head>
      <body>{children}</body>
    </html>
  )
}
