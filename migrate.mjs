import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const supabase = createClient(
  'https://dxtbuiicrdkjxkwdjdwq.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4dGJ1aWljcmRranhrd2RqZHdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4OTM1OTYsImV4cCI6MjA5MzQ2OTU5Nn0.ewyJW3UjkajSVyUKuWJkIGjTs-3lNT45e3S_ZrU_PI8',
  { realtime: { transport: ws } }
);

const { data, error } = await supabase.from('missing_items_log').select('id').limit(1);
if (error) {
  console.log('Error code:', error.code, '|', error.message);
} else {
  console.log('Table exists, rows:', data?.length);
}
