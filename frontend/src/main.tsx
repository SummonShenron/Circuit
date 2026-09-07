import { StrictMode, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider, SignInButton, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react'
import './index.css'
import App from './App.tsx'

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

function TokenFetchBridge({ children }: { children: ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const originalFetch = window.fetch.bind(window)
    const getTokenWithRetry = async (skipCache = false) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const token = await getToken({ skipCache })
        if (token) return token
        await new Promise((resolve) => window.setTimeout(resolve, 150 * (attempt + 1)))
        skipCache = true
      }
      return null
    }
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
      const isLocalApi = url.startsWith('http://127.0.0.1:8010/') || url.startsWith('http://localhost:8010/')
      if (!isLocalApi) return originalFetch(input, init)
      const requestWithToken = async (token: string | null) => {
        const headers = new Headers(init?.headers)
        if (token) headers.set('Authorization', `Bearer ${token}`)
        return originalFetch(input, { ...init, headers })
      }
      const cachedToken = await getTokenWithRetry()
      const firstResponse = await requestWithToken(cachedToken)
      if (firstResponse.status !== 401) return firstResponse
      const refreshedToken = await getTokenWithRetry(true)
      return refreshedToken ? requestWithToken(refreshedToken) : firstResponse
    }
    setReady(true)
    return () => { window.fetch = originalFetch }
  }, [getToken])
  return ready && isLoaded && isSignedIn ? <>{children}</> : null
}

function AuthenticatedApp() {
  if (!clerkPublishableKey) return <App />
  return <ClerkProvider publishableKey={clerkPublishableKey}><SignedIn><TokenFetchBridge><App /></TokenFetchBridge></SignedIn><SignedOut><main className="auth-screen"><section><h1>Circuit</h1><p>Build visual agent workflows with connected AI, API, and control-flow blocks.</p><SignInButton mode="modal"><button className="auth-button">Sign in to continue</button></SignInButton></section></main></SignedOut></ClerkProvider>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthenticatedApp />
  </StrictMode>,
)
