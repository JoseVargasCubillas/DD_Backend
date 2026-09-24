// One-shot: recorre TODOS los cursos publicados y los agrega a cada paquete
// activo que aun no los contenga. Se usa cuando se subieron cursos nuevos
// antes de que el auto-sync (course.service) existiera, o para reparar
// paquetes desalineados. Idempotente: correr varias veces no duplica.
//
// Uso local:   npm run sync:courses-packages
// Uso en VPS:  pm2 stop dd-academia-backend && npm run sync:courses-packages && pm2 start dd-academia-backend
//              (o simplemente correrlo con el backend arriba, es solo lectura + escritura de paquetes)

import '../config/load-env.js';
import { connectDB } from '../config/database.js';
import { Course } from '../atomic/molecules/models/course.model.js';
import { Package } from '../atomic/molecules/models/package.model.js';
import { COURSE_STATUS } from '../atomic/atoms/constants/status.constant.js';

const main = async (): Promise<void> => {
  await connectDB();

  const [courses, packages] = await Promise.all([Course.find({}), Package.find({})]);
  const publishedIds = courses
    .filter((c) => c.status === COURSE_STATUS.PUBLISHED)
    .map((c) => String(c._id));
  const activePackages = packages.filter((p) => p.isActive);

  console.log(`→ ${publishedIds.length} cursos publicados`);
  console.log(`→ ${activePackages.length} paquetes activos`);

  let updates = 0;
  for (const pkg of activePackages) {
    const current = new Set((pkg.courseIds ?? []).map(String));
    const missing = publishedIds.filter((id) => !current.has(id));
    if (!missing.length) {
      console.log(`  ✓ ${pkg.name} — al día (${current.size} cursos)`);
      continue;
    }
    for (const id of missing) current.add(id);
    pkg.courseIds = Array.from(current);
    await pkg.save();
    updates += 1;
    console.log(`  + ${pkg.name} — agregados ${missing.length} curso(s) [total ${current.size}]`);
  }

  console.log(`\nListo. Paquetes actualizados: ${updates}/${activePackages.length}`);
  process.exit(0);
};

main().catch((err) => {
  console.error('Error sincronizando cursos → paquetes:', err);
  process.exit(1);
});
