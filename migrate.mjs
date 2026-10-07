import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { realtime: { transport: ws } }
);

const { data, error } = await supabase.from('missing_items_log').select('id').limit(1);
if (error) {
  console.log('Error code:', error.code, '|', error.message);
} else {
  console.log('Table exists, rows:', data?.length);
}
