// Configurazione: destinatario delle mail e progetto Supabase per la sincronizzazione.

export const DESTINATARIO = "lcsoon93@gmail.com";
// Lascia le stringhe vuote per usare l'app solo su questo telefono.
// Riempile con i dati del tuo progetto Supabase per condividere l'archivio
// tra piu' telefoni. Istruzioni nel README (sezione "Supabase: messa in produzione")
export const SUPABASE_URL = "https://kdzgtvnimqvxfweomxdo.supabase.co";      // es. "https://abcdefgh.supabase.co"
export const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtkemd0dm5pbXF2eGZ3ZW9teGRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0OTg3NzgsImV4cCI6MjEwNTA3NDc3OH0.bXPzy48u_NVmQ6AO5Z0hBRQpirR_6cDt8eUf6fPHXr8";      // la chiave "anon public"
export const SINC_ATTIVA = () => SUPABASE_URL !== "" && SUPABASE_KEY !== "";

// Notifiche push: chiave PUBBLICA VAPID (la privata e' solo nei secret della Edge Function "notifiche")
export const VAPID_PUBLIC_KEY = "BPItmGE7YNuJThrWemZnM2GzGsG4I6TvNBuUMkTb0BKPf1il6Algn4JrUPqqvPNEwt5y9GKvSqa9GpEBmrfDLYk";
