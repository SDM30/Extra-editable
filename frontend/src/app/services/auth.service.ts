import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);

  getLocalUser(): { userId: string; username: string } {
    const stored = sessionStorage.getItem('collab-user-meta');
    if (stored) {
      return JSON.parse(stored);
    }

    const userId = 'user-' + Math.random().toString(36).slice(2, 8);
    const username = 'Dev ' + userId.slice(5).toUpperCase();
    const meta = { userId, username };
    sessionStorage.setItem('collab-user-meta', JSON.stringify(meta));
    return meta;
  }

  async getCollabToken(): Promise<{ token: string; username: string }> {
    const cached = sessionStorage.getItem('collab-token');
    if (cached) {
      return JSON.parse(cached);
    }

    const { userId, username } = this.getLocalUser();
    const resp = await firstValueFrom(
      this.http.post<{ token: string }>('http://localhost:1234/dev-token', {
        userId,
        username,
      }),
    );

    const data = { token: resp.token, username };
    sessionStorage.setItem('collab-token', JSON.stringify(data));
    return data;
  }
}
