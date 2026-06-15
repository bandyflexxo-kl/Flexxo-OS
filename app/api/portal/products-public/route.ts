import { fetchProductsCached } from '@/lib/products-api'

export const revalidate = false

export async function GET(_request: Request) {
  return Response.json(await fetchProductsCached('retail'), {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
