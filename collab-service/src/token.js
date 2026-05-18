import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';

// Genera un token firmado de verdad para un userId dado.
// El frontend lo llama una vez al cargar el editor.
export function generateDevToken(userId, username) {
  return jwt.sign(
    { sub: userId, username },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}