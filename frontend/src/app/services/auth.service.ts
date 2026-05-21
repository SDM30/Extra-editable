import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom, Observable, tap } from 'rxjs';
import { enviroment } from '../environments/enviroment';
import { AuthTokens, LoginRequest, RegisterRequest, UserProfile } from '../model/user.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private base = enviroment.apiBaseUrl;
  // Tokens are stored per-tab so two tabs can represent two different users.
  // sessionStorage keeps a stable tab id; localStorage holds the tab-scoped tokens.
  private readonly authTabKey = 'collab-auth-tab-id';
  private readonly anonStorageKey = 'collab-anon-identity';

  constructor(private http: HttpClient, private router: Router) {}

  login(data: LoginRequest): Observable<AuthTokens> {
    return this.http.post<AuthTokens>(`${this.base}/auth/login/`, data).pipe(
      tap(tokens => {
        console.log('[AuthService] Login successful, storing tokens');
        localStorage.setItem(this.getAuthStorageKey('access'), tokens.access);
        localStorage.setItem(this.getAuthStorageKey('refresh'), tokens.refresh);
        console.log('[AuthService] Token stored. Access prefix:', tokens.access.substring(0, 20));
      })
    );
  }

  register(data: RegisterRequest): Observable<UserProfile> {
    return this.http.post<UserProfile>(`${this.base}/auth/register/`, data);
  }

  me(): Observable<UserProfile> {
    const token = this.getToken();
    const headers = token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : undefined;
    return this.http.get<UserProfile>(`${this.base}/auth/me/`, { headers });
  }

  logout(): void {
    localStorage.removeItem(this.getAuthStorageKey('access'));
    localStorage.removeItem(this.getAuthStorageKey('refresh'));
    document.cookie = 'collab_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    this.router.navigate(['/auth']);
  }

  getToken(): string | null {
    return localStorage.getItem(this.getAuthStorageKey('access'));
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  /**
   * Obtiene un token JWT para el servicio colaborativo (Hocuspocus).
   *
   * Si el usuario está autenticado, intenta usar `me()` para poblar `userId/username`.
   * Si no, usa valores por defecto.
   */
  async getCollabToken(projectId: number, archivoId?: number): Promise<{ token: string; username: string; userId: string; room?: string }> {
    let userId = 'anon';
    let username = 'Anónimo';
    const token = this.getToken();
    console.log('[AuthService] getCollabToken - has access token:', !!token);

    try {
      const profile = await firstValueFrom(this.me());
      userId = String(profile.id);
      username = profile.username || username;
      console.log('[AuthService] Got user profile:', { userId, username });
    } catch (err) {
      console.warn('[AuthService] Could not fetch user profile, using anonymous:', err);
      // Usuario no autenticado o backend no disponible: generar identidad
      // anónima estable por pestaña para que awareness/collab no colapse
      // todos los tabs como si fueran el mismo usuario.
      const anonIdentity = this.getOrCreateAnonymousIdentity();
      userId = anonIdentity.userId;
      username = anonIdentity.username;
    }

    const url = `${this.base}/projects/${projectId}/collab/join/`;
    const headers: any = {};
    const access = this.getToken();
    if (access) {
      headers['Authorization'] = `Bearer ${access}`;
    }

    try {
      const resp = await firstValueFrom(
        this.http.post<{ token: string; room?: string }>(url, { userId, username, archivo_id: archivoId }, { headers }),
      );
      document.cookie = `collab_token=${encodeURIComponent(resp.token)}; path=/; SameSite=Lax`;
      console.log('[AuthService] Got collab token for room:', resp.room);
      return { token: resp.token, username, userId, room: resp.room };
    } catch (err) {
      console.error('[AuthService] Error getting collab token:', err);
      throw err;
    }
  }

  /**
   * Renueva la marca de actividad de una sesión colaborativa abierta.
   * No recrea la conexión WebSocket; solo evita que el backend marque la sala
   * como inactiva mientras el editor sigue en uso.
   */
  async refreshCollabSession(projectId: number, archivoId?: number): Promise<void> {
    const access = this.getToken();
    if (!access) {
      return;
    }

    const headers = new HttpHeaders({ Authorization: `Bearer ${access}` });
    await firstValueFrom(
      this.http.post(
        `${this.base}/projects/${projectId}/collab/heartbeat/`,
        archivoId ? { archivo_id: archivoId } : {},
        { headers },
      ),
    );
  }

  private getOrCreateAnonymousIdentity(): { userId: string; username: string } {
    const windowLike = window as Window & { name: string };

    if (windowLike.name.startsWith('collab-')) {
      const existingName = windowLike.name.slice('collab-'.length);
      return {
        userId: existingName,
        username: `Anónimo-${existingName.slice(-8)}`,
      };
    }

    const existing = sessionStorage.getItem(this.anonStorageKey);
    if (existing) {
      try {
        const parsed = JSON.parse(existing) as { userId?: string; username?: string };
        if (parsed.userId && parsed.username) {
          windowLike.name = `collab-${parsed.userId}`;
          return { userId: parsed.userId, username: parsed.username };
        }
      } catch {
        // Si el valor está corrupto, regenerarlo.
      }
    }

    const randomPart =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);

    const identity = {
      userId: `anon-${randomPart}`,
      username: `Anónimo-${randomPart}`,
    };

    windowLike.name = `collab-${identity.userId}`;
    sessionStorage.setItem(this.anonStorageKey, JSON.stringify(identity));
    return identity;
  }

  private getTabId(): string {
    const existing = sessionStorage.getItem(this.authTabKey);
    if (existing) {
      return existing;
    }

    const randomPart =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().slice(0, 12)
        : Math.random().toString(36).slice(2, 14);

    sessionStorage.setItem(this.authTabKey, randomPart);
    return randomPart;
  }

  private getAuthStorageKey(kind: 'access' | 'refresh'): string {
    return `${kind}:${this.getTabId()}`;
  }
}
