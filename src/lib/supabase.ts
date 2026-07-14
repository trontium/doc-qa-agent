import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_KEY!;

if (!url || !key) {
  console.warn('[supabase] SUPABASE_URL 或 SUPABASE_SERVICE_KEY 未设置');
}

// 服务端专用（走 service_role key，绕过 RLS）
export const supabase = createClient(url ?? '', key ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});
