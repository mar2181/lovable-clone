import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const DEV_BYPASS = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1'

const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
  '/test-preview(.*)'
])

const clerkAuthMiddleware = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})

export default function middleware(...args: Parameters<typeof clerkAuthMiddleware>) {
  if (DEV_BYPASS) {
    return NextResponse.next()
  }

  return clerkAuthMiddleware(...args)
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
