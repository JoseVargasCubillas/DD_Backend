/**
 * Seed users: crea (o reactualiza) un admin y un usuario de prueba.
 *
 * Uso: npm run seed:users
 *
 * Credenciales por defecto (sobreescribibles con env vars):
 *   ADMIN_EMAIL    admin@diegodiaz.mx        / ADMIN_PASSWORD    Admin#2025
 *   TEST_EMAIL     cliente@diegodiaz.mx      / TEST_PASSWORD     Cliente#2025
 */
import 'dotenv/config';
import { User } from '../atomic/molecules/models/user.model.js';
import { hashPassword } from '../atomic/atoms/helpers/hash.helper.js';
import { connectDB } from '../config/database.js';

interface SeedUser {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'user';
}

const SEEDS: SeedUser[] = [
  {
    name: 'Administrador Diego Díaz',
    email: process.env.ADMIN_EMAIL ?? 'admin@diegodiaz.mx',
    password: process.env.ADMIN_PASSWORD ?? 'Admin#2025',
    role: 'admin',
  },
  {
    name: 'Cliente de Prueba',
    email: process.env.TEST_EMAIL ?? 'cliente@diegodiaz.mx',
    password: process.env.TEST_PASSWORD ?? 'Cliente#2025',
    role: 'user',
  },
];

async function upsertUser(seed: SeedUser): Promise<'created' | 'updated'> {
  const existing = await User.findOne({ email: seed.email });
  const hashed = await hashPassword(seed.password);

  if (existing) {
    existing.name = seed.name;
    existing.password = hashed;
    existing.role = seed.role;
    existing.isActive = true;
    existing.isEmailVerified = true;
    await existing.save();
    return 'updated';
  }

  await User.create({
    name: seed.name,
    email: seed.email,
    password: hashed,
    role: seed.role,
    isActive: true,
    isEmailVerified: true,
  });
  return 'created';
}

async function main(): Promise<void> {
  console.log('🌱  Seeding users…');
  await connectDB();

  for (const seed of SEEDS) {
    const status = await upsertUser(seed);
    console.log(
      `  ${status === 'created' ? '✓ creado    ' : '↻ actualizado'}  ${seed.role.padEnd(5)}  ${seed.email}  →  ${seed.password}`,
    );
  }

  console.log('\n✅  Listo. Inicia sesión en http://localhost:5173/iniciar-sesion');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌  Seed falló:', err);
  process.exit(1);
});
