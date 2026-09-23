/**
 * F4 -- the consultation page (BUILD_ROADMAP C4).
 *
 * NEXT 16: `params` is a Promise, and `PageProps<'/consultations/[id]'>`
 * types the awaited shape against the generated route union.
 */
import type { Metadata } from 'next'
import { ConsultationView } from '@/components/consultation/consultation-view'

export const metadata: Metadata = { title: 'Consultation' }

export default async function ConsultationPage({
  params,
}: PageProps<'/consultations/[id]'>) {
  const { id } = await params

  return <ConsultationView consultationId={id} />
}
