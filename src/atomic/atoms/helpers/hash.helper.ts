import bcrypt from 'bcryptjs';

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, 12);
export const comparePassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);

// Genera una contraseña temporal segura (alfanumérica + símbolos seguros para email).
export const generateTempPassword = (length = 14): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};
