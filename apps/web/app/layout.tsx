import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { AppHeader } from '@/components/app-header'
import { Toaster } from '@/components/ui/sonner'
import { Providers } from './providers'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  /**
   * A template, so every page contributes its own half (C10).
   *
   * Without it each route shows the same string, and a doctor with three
   * tabs open -- a patient, a consultation, the day's list -- cannot tell
   * them apart from the tab strip, which is exactly when it matters.
   */
  title: {
    template: '%s · Consultation Workspace',
    default: 'Consultation Workspace',
  },
  description: 'AI-assisted consultation notes for outpatient clinics.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <Providers>
          <AppHeader />
          {/* `flex-1` so short pages still push the viewport height. */}
          <div className="flex-1">{children}</div>
          {/*
            Toasts confirm actions that leave no visible trace -- a saved
            consultation navigates away, so without this the doctor has no
            acknowledgement it worked. C7 uses it for exactly that.
          */}
          <Toaster position="bottom-right" />
        </Providers>
      </body>
    </html>
  )
}
