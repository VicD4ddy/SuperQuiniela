const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://dfkjztfztpayeznqrtrv.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRma2p6dGZ6dHBheWV6bnFydHJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNjM2NDcsImV4cCI6MjA5NTgzOTY0N30.iuvC52JHU7ttofkueVzBLrWKIEzC4COm0RVySGbPXrk';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function listUsers() {
  console.log('Obteniendo perfiles registrados...');
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, is_admin');

  if (error) {
    console.error('Error al obtener perfiles:', error);
    return;
  }

  console.log(`\nSe encontraron ${data.length} perfiles:`);
  console.table(data);
}

listUsers();
