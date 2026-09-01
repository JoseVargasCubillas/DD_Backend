import { RequestHandler } from 'express';
import { redeemWhatsappInvite } from '../../organisms/services/whatsapp-invite.service.js';

const page = (title: string, message: string): string => `
  <!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}</title>
      <style>
        body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#f3efe7; color:#15120f; font-family:Georgia,'Times New Roman',serif; padding:24px; box-sizing:border-box; }
        .card { max-width:440px; text-align:center; }
        h1 { font-weight:400; font-size:28px; margin:0 0 16px; }
        p { font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.6; color:#5f574f; margin:0; }
        a { color:#15120f; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>${title}</h1>
        <p>${message}</p>
      </div>
    </body>
  </html>
`;

export const joinWhatsappGroup: RequestHandler = async (req, res) => {
  const result = await redeemWhatsappInvite(String(req.params.token || ''));

  if (result.status === 'ok') {
    res.redirect(302, result.url);
    return;
  }

  const message =
    result.status === 'used'
      ? 'Este enlace ya fue usado. Si necesitas ayuda para unirte al grupo, escribe a <a href="mailto:servicios@diegodiaz.mx">servicios@diegodiaz.mx</a>.'
      : 'Este enlace no es válido. Si necesitas ayuda para unirte al grupo, escribe a <a href="mailto:servicios@diegodiaz.mx">servicios@diegodiaz.mx</a>.';

  res.status(410).send(page('Enlace no disponible', message));
};
