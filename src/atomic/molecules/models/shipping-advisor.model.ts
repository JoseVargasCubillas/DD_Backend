import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

// Asesor comercial con link propio para capturar envíos de libros sin
// iniciar sesión. El `token` va en la URL pública; desactivar o rotar el
// token corta el acceso de ese asesor sin afectar a los demás.
export interface IShippingAdvisorDocument extends SqlDocumentMethods<IShippingAdvisorDocument> {
  name: string;
  // WhatsApp del asesor: recibe el aviso cuando su envío se aprueba o rechaza.
  phone: string;
  // Correo del asesor: recibe el aviso de aprobado/rechazado (opcional).
  email: string;
  token: string;
  isActive: boolean;
  lastUsedAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const ShippingAdvisor = createSqlModel<IShippingAdvisorDocument>({
  table: 'shipping_advisors',
  defaults: () => ({
    phone: '',
    email: '',
    isActive: true,
    lastUsedAt: null,
  }),
});
