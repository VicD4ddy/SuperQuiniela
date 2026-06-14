const { createClient } = require('@supabase/supabase-js');

// Configuración de Supabase
const supabaseUrl = 'https://dfkjztfztpayeznqrtrv.supabase.co';

// Argumentos del script
const args = process.argv.slice(2);
if (args.length < 3) {
  console.log('\n❌ Uso incorrecto.');
  console.log('Uso: node scratch/reset_password.js "<apodo_exacto>" "<nueva_contraseña>" "<supabase_service_role_key>"');
  console.log('Ejemplo: node scratch/reset_password.js "Goleador99" "NuevaContra123" "eyJhbGciOiJIUzI1Ni..."');
  process.exit(1);
}

const targetUsername = args[0];
const newPassword = args[1];
const serviceRoleKey = args[2];

// Regla de limpieza del apodo para el correo ficticio (idéntico al de AuthModal.tsx)
const cleanNick = targetUsername.toLowerCase().replace(/[^a-z0-9]/g, "");
const dummyEmail = `${cleanNick}@quiniela.local`;

// Inicializar Supabase con privilegios administrativos
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function resetPassword() {
  console.log(`\nIniciando proceso para cambiar la contraseña de "${targetUsername}"...`);
  console.log(`- Correo ficticio calculado: ${dummyEmail}`);

  // 1. Validar que el usuario existe en la tabla de perfiles
  console.log('- Buscando perfil en la base de datos...');
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, username')
    .ilike('username', targetUsername);

  if (profileError) {
    console.error('❌ Error al buscar el perfil:', profileError.message);
    process.exit(1);
  }

  if (!profiles || profiles.length === 0) {
    console.error(`❌ No se encontró ningún perfil con el apodo "${targetUsername}".`);
    console.log('Por favor, ejecuta "node scratch/list_profiles.js" para ver los apodos exactos.');
    process.exit(1);
  }

  const userProfile = profiles[0];
  console.log(`- Perfil encontrado: ${userProfile.username} (ID: ${userProfile.id})`);

  // 2. Actualizar el usuario en Supabase Auth usando la API de administración
  console.log('- Actualizando contraseña en Supabase Auth...');
  const { data, error: authError } = await supabase.auth.admin.updateUserById(
    userProfile.id,
    { 
      password: newPassword,
      email_confirm: true // Asegura que el email falso esté marcado como confirmado
    }
  );

  if (authError) {
    console.error('❌ Error al actualizar la contraseña:', authError.message);
    process.exit(1);
  }

  console.log('\n======================================================');
  console.log(`✅ ¡Contraseña restablecida con éxito para "${userProfile.username}"!`);
  console.log(`🔑 Nueva contraseña: ${newPassword}`);
  console.log(`📧 Correo de auth: ${dummyEmail}`);
  console.log('======================================================\n');
}

resetPassword();
