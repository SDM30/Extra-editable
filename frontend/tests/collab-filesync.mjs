import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { WebSocket } from 'ws';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8000/api';
const WS_BASE_URL = process.env.COLLAB_WS_URL ?? 'ws://localhost:1234';

const PASSWORDS = {
  admin1: 'Admin1234!',
  david: 'User1234!',
};

const USER_CACHE = new Map();
const activeProjects = [];

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

  const rawBody = await response.text();
  let body = null;
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = rawBody;
    }
  }

  return { response, body };
}

async function loginUser(username) {
  if (USER_CACHE.has(username)) {
    return USER_CACHE.get(username);
  }

  const password = PASSWORDS[username];
  assert(password, `No password configured for ${username}`);

  const login = await requestJson(`${API_BASE_URL}/auth/login/`, {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  assert.equal(login.response.status, 200, `Login failed for ${username}: ${JSON.stringify(login.body)}`);
  assert(login.body?.access, `Missing access token for ${username}`);

  const me = await requestJson(`${API_BASE_URL}/auth/me/`, {
    headers: { Authorization: `Bearer ${login.body.access}` },
  });

  assert.equal(me.response.status, 200, `me() failed for ${username}: ${JSON.stringify(me.body)}`);

  const session = {
    username,
    password,
    access: login.body.access,
    refresh: login.body.refresh,
    profile: me.body,
  };

  USER_CACHE.set(username, session);
  return session;
}

async function ensureUsers(usernames) {
  const entries = await Promise.all(usernames.map(async (username) => [username, await loginUser(username)]));
  return Object.fromEntries(entries);
}

async function createProject(owner, collaboratorNames, label, language = 'CPP') {
  const collaborators = collaboratorNames.map((name) => USER_CACHE.get(name)?.profile?.id).filter(Boolean);
  const request = await requestJson(`${API_BASE_URL}/projects/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${owner.access}` },
    body: JSON.stringify({
      nombre: `collab-filesync-${label}-${Date.now()}`,
      descripcion: `test ${label}`,
      lenguaje: language,
      colaboradores: collaborators,
    }),
  });

  assert(
    request.response.status === 201 || request.response.status === 200,
    `Project creation failed: ${request.response.status} ${JSON.stringify(request.body)}`,
  );
  assert(request.body?.id, 'Project id missing in create response');
  activeProjects.push({ id: request.body.id, owner });
  return request.body;
}

async function deleteProject(project) {
  if (!project?.id || !project.owner?.access) {
    return;
  }

  await requestJson(`${API_BASE_URL}/projects/${project.id}/`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${project.owner.access}` },
  });
}

async function cleanupProjects() {
  while (activeProjects.length > 0) {
    const project = activeProjects.pop();
    try {
      await deleteProject(project);
    } catch {
      // Best effort cleanup.
    }
  }
}

async function getCollabToken(user, projectId, archivoId) {
  const request = await requestJson(`${API_BASE_URL}/projects/${projectId}/collab/join/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${user.access}` },
    body: JSON.stringify(archivoId ? { archivo_id: archivoId } : {}),
  });

  return request;
}

function createProviderClient({ token, room, user, color, url = WS_BASE_URL }) {
  const document = new Y.Doc();
  const client = {
    provider: null,
    document,
    files: document.getArray('files'),
    synced: null,
    disconnect() {
      try {
        client.provider?.destroy();
      } catch {
        // ignore
      }
      try {
        client.document.destroy();
      } catch {
        // ignore
      }
    },
  };

  client.synced = new Promise((resolve, reject) => {
    const provider = new HocuspocusProvider({
      url,
      name: room,
      document,
      token,
      WebSocketPolyfill: WebSocket,
      onConnect: () => {
        try {
          provider?.setAwarenessField('user', {
            id: String(user.profile.id),
            name: user.profile.username,
            color,
          });
        } catch {
          // Ignore awareness bootstrap errors in tests.
        }
      },
      onSynced: () => resolve(provider),
      onDisconnect: () => {
        // No-op: cleanup is handled by the test runner.
      },
      onAuthenticationFailed: ({ reason }) => {
        reject(new Error(reason ?? 'authentication failed'));
      },
    });

    client.provider = provider;
  });

  return client;
}

async function waitFor(predicate, timeoutMs = 8000, intervalMs = 100) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await predicate();
    if (result) {
      return result;
    }
    await delay(intervalMs);
  }
  throw new Error(`Timeout after ${timeoutMs}ms`);
}

async function testFilesSync(users) {
  const project = await createProject(users.admin1, ['david'], 'filesync');
  const ownerToken = await getCollabToken(users.admin1, project.id);
  const guestToken = await getCollabToken(users.david, project.id);
  assert.equal(ownerToken.response.status, 200, JSON.stringify(ownerToken.body));
  assert.equal(guestToken.response.status, 200, JSON.stringify(guestToken.body));

  const owner = createProviderClient({
    token: ownerToken.body.token,
    room: String(project.id),
    user: users.admin1,
    color: '#4285f4',
  });
  const guest = createProviderClient({
    token: guestToken.body.token,
    room: String(project.id),
    user: users.david,
    color: '#34a853',
  });

  try {
    await Promise.all([owner.synced, guest.synced]);

    const fileRecord = new Y.Map();
    fileRecord.set('id', `file-${Date.now()}`);
    fileRecord.set('name', 'main.py');
    fileRecord.set('language', 'python');
    owner.files.insert(0, [fileRecord]);

    await waitFor(() => {
      const guestFirst = guest.files.get(0);
      return guest.files.length === 1 && guestFirst instanceof Y.Map && guestFirst.get('name') === 'main.py';
    }, 6000);

    assert.equal(guest.files.length, 1, 'Guest did not receive the shared file list');
    assert.equal(guest.files.get(0).get('language'), 'python', 'Guest received an incomplete file record');

    guest.files.get(0).set('language', 'cpp');

    await waitFor(() => owner.files.get(0)?.get('language') === 'cpp', 6000);
    assert.equal(owner.files.get(0).get('language'), 'cpp', 'Owner did not receive the file update');
  } finally {
    owner.disconnect();
    guest.disconnect();
  }
}

async function main() {
  const users = await ensureUsers(['admin1', 'david']);

  try {
    await testFilesSync(users);
    console.log('PASS filesync propagation');
  } finally {
    await cleanupProjects();
  }
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error?.stack ?? error?.message ?? error);
  await cleanupProjects();
  process.exitCode = 1;
});