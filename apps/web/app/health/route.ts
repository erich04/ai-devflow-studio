import { NextResponse } from 'next/server'

const webHealth = Object.freeze({
  status: 'ok',
  service: '@ai-devflow/web',
})

export function GET() {
  return NextResponse.json(webHealth)
}
