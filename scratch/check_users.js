const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://dfkjztfztpayeznqrtrv.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRma2p6dGZ6dHBheWV6bnFydHJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjM2NDcsImV4cCI6MjA5NTgzOTY0N30.iuvC52JHU7ttofkueVzBLrWKIEzC4COm0RVySGbPXrk';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function check() {
  console.log('--- DIAGNÓSTICO DE QUINIELAS ---');
  
  const { data: quinielas, error: qError } = await supabase
    .from('user_quinielas')
    .select(`
      user_id,
      status,
      alias_name,
      profiles (username)
    `);
    
  if (qError) {
    console.error('Error al obtener quinielas:', qError);
  } else {
    console.log(`Total quinielas registradas: ${quinielas.length}`);
    quinielas.forEach((q, idx) => {
      console.log(`${idx + 1}. User: ${q.profiles?.username || 'N/A'} | Alias: ${q.alias_name || 'N/A'} | Status: ${q.status}`);
    });
  }
}

check();
