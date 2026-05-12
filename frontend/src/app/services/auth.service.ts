import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom, Observable, tap } from 'rxjs';
import { enviroment } from '../environments/enviroment';
import { AuthTokens, LoginRequest, RegisterRequest, UserProfile } from '../model/user.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private base = enviroment.apiBaseUrl; // http://localhost:8000/api
  private collabTokenUrl = 'http://localhost:8083/dev-token';
  private readonly anonStorageKey = 'collab-anon-identity';

  constructor(private http: HttpClient, private router: Router) {}

  login(data: LoginRequest): Observable<AuthTokens> {
    return this.http.post<AuthTokens>(`${this.base}/auth/login/`, data).pipe(
      tap(tokens => {
        localStorage.setItem('access', tokens.access);
        localStorage.setItem('refresh', tokens.refresh);
      })
    );
  }

  register(data: RegisterRequest): Observable<UserProfile> {
    return this.http.post<UserProfile>(`${this.base}/auth/register/`, data);
  }

  me(): Observable<UserProfile> {
    return this.http.get<UserProfile>(`${this.base}/auth/me/`);
  }

  logout(): void {
    localStorage.removeItem('access');
    localStorage.removeItem('refresh');
    this.router.navigate(['/auth']);
  }

  getToken(): string | null {
    return localStorage.getItem('access');
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
  async getCollabToken(): Promise<{ token: string; username: string; userId: string }> {
    let userId = 'anon';
    let username = 'Anónimo';

    try {
      const profile = await firstValueFrom(this.me());
      userId = String(profile.id);
      username = profile.username || username;
    } catch {
      // Usuario no autenticado o backend no disponible: generar identidad
      // anónima estable por pestaña para que awareness/collab no colapse
      // todos los tabs como si fueran el mismo usuario.
      const anonIdentity = this.getOrCreateAnonymousIdentity();
      userId = anonIdentity.userId;
      username = anonIdentity.username;
    }

    const resp = await firstValueFrom(
      this.http.post<{ token: string }>(this.collabTokenUrl, { userId, username }),
    );
    return { token: resp.token, username, userId };
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
}
