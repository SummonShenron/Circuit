export function getApiUrl(): string {
  if (typeof window === 'undefined') return "http://127.0.0.1:8010/api";
  
  const hostname = window.location.hostname;
  
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://127.0.0.1:8010/api";
  }
  
  if (hostname === "circutbuilder.com" || hostname.endsWith(".circutbuilder.com")) {
    return "https://circut-1tw3.onrender.com/api";
  }
  
  return "http://127.0.0.1:8010/api";
}
