/**
 * F1 -- the appointments dashboard route.
 *
 * A server component so it can export `metadata` (C10); the dashboard
 * itself is a client component because it owns filter and date state.
 */
import type { Metadata } from 'next'
import { AppointmentsDashboard } from '@/components/appointments/appointments-dashboard'

/**
 * Spelled out rather than relying on the layout's `%s` template.
 *
 * Next deliberately does not apply a title template to a page in the SAME
 * segment as the layout that declares it -- only to nested segments. So the
 * root route has to carry its own suffix, which is easy to miss and shows
 * up as one tab reading differently from every other.
 */
export const metadata: Metadata = {
  title: "Today's appointments · Consultation Workspace",
}

export default function Page() {
  return <AppointmentsDashboard />
}
