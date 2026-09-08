export function getApiUrl(): string {
  if (typeof window === 'undefined') return "http://127.0.0.1:8010/api";
  
  const hostname = window.location.hostname;
  
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://127.0.0.1:8010/api";
  }
  
  // Support both www.circuitworkflow.com and circuitworkflow.com
  if (hostname.includes("circuitworkflow.com")) {
    return "https://circut-1tw3.onrender.com/api";
  }
  
  return "http://127.0.0.1:8010/api";
}

export function isCircuitApiUrl(url: string): boolean {
  // Check if URL is a Circuit backend API URL (needs Bearer token)
  return url.startsWith('http://127.0.0.1:8010/') || 
         url.startsWith('http://localhost:8010/') ||
         url.startsWith('https://circut-1tw3.onrender.com/') ||
         url.startsWith('https://circut-1tw3.onrender.com')
}

