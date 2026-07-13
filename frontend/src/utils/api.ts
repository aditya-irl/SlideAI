export const API_BASE_URL = import.meta.env.VITE_API_URL || "https://slideai-05vk.onrender.com";

/**
 * Reusable wrapper around fetch to standardise headers, JSON parsing, 
 * and user-friendly error translations.
 */
export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  
  try {
    // Add default headers if none exists
    const headers = new Headers(options.headers || {});
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }
    
    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
      if (response.status === 500) {
        throw new Error("Internal Server Error (500) encountered. Please try again later.");
      }
      if (response.status === 404) {
        throw new Error("The requested resource was not found on the server (404).");
      }
      
      let errorMsg = `Server returned status ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData && errorData.error) {
          errorMsg = errorData.error;
        }
      } catch (jsonErr) {
        // fallback to default status text
      }
      
      throw new Error(errorMsg);
    }
    
    // Check if response is empty before parsing JSON
    const text = await response.text();
    if (!text) {
      return {} as T;
    }
    
    return JSON.parse(text) as T;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw error;
    }
    
    console.error(`[API Service Error] Request to ${url} failed:`, error);
    
    if (error.message && (error.message.includes('500') || error.message.includes('404') || error.message.includes('Server returned'))) {
      throw error;
    }
    
    throw new Error("Backend server is currently unavailable. Please verify your connection.");
  }
}
