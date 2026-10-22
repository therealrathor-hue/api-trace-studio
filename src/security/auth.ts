import * as crypto from 'crypto';
import { DashboardAuthConfig } from '../config/types';

export function timingSafeCompare(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, 'utf-8');
    const bBuf = Buffer.from(b, 'utf-8');

    if (aBuf.length !== bBuf.length) {
      // Prevent timing leak on length difference by hashing both with SHA-256 first
      const hashA = crypto.createHash('sha256').update(aBuf).digest();
      const hashB = crypto.createHash('sha256').update(bBuf).digest();
      crypto.timingSafeEqual(hashA, hashB);
      return false;
    }

    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

export function parseBasicAuthHeader(header: string | undefined): { username: string; password: string } | null {
  if (!header || !header.startsWith('Basic ')) {
    return null;
  }

  try {
    const base64Part = header.slice(6).trim();
    const decoded = Buffer.from(base64Part, 'base64').toString('utf-8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
      return null;
    }
    return {
      username: decoded.slice(0, colonIndex),
      password: decoded.slice(colonIndex + 1),
    };
  } catch {
    return null;
  }
}

export function verifyDashboardAuth(
  authConfig: DashboardAuthConfig,
  reqHeaders: Record<string, any>,
  reqQuery?: Record<string, any>
): boolean {
  if (!authConfig.enabled) {
    return true;
  }

  // Token auth support via header or query
  if (authConfig.token) {
    const authHeader = reqHeaders['authorization'];
    if (authHeader && typeof authHeader === 'string') {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match && timingSafeCompare(match[1].trim(), authConfig.token)) {
        return true;
      }
    }

    const customTokenHeader = reqHeaders['x-api-trace-token'];
    if (typeof customTokenHeader === 'string' && timingSafeCompare(customTokenHeader.trim(), authConfig.token)) {
      return true;
    }

    if (reqQuery && reqQuery.token && typeof reqQuery.token === 'string') {
      if (timingSafeCompare(reqQuery.token.trim(), authConfig.token)) {
        return true;
      }
    }
  }

  // Basic auth support
  if (authConfig.username && authConfig.password) {
    const basic = parseBasicAuthHeader(reqHeaders['authorization']);
    if (basic) {
      const isUserMatch = timingSafeCompare(basic.username, authConfig.username);
      const isPassMatch = timingSafeCompare(basic.password, authConfig.password);
      if (isUserMatch && isPassMatch) {
        return true;
      }
    }
  }

  return false;
}
