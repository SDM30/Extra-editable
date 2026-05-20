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
  samuel: 'User1234!',
  santiago: 'User1234!',
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

async function registerUser(username) {
  const password = 'User1234!';
  const email = `${username}@myide.com`;
  // Ensure loginUser can find the password for newly registered users
  PASSWORDS[username] = password;
  const request = await requestJson(`${API_BASE_URL}/auth/register/`, {
    method: 'POST',
    body: JSON.stringify({
      username,
      email,
      password,
      nombre: username,
    }),
  });

  assert(
    request.response.status === 200 || request.response.status === 201,
    `Register failed for ${username}: ${request.response.status} ${JSON.stringify(request.body)}`,
  );

  return loginUser(username);
}

async function createProject(owner, collaboratorNames, label, language = 'CPP') {
  const collaborators = collaboratorNames.map((name) => USER_CACHE.get(name)?.profile?.id).filter(Boolean);
  const request = await requestJson(`${API_BASE_URL}/projects/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${owner.access}` },
    body: JSON.stringify({
      nombre: `collab-ws-${label}-${Date.now()}`,
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
  const text = document.getText('codemirror');
  let provider = null;
  const client = {
    provider: null,
    document,
    text,
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
    provider = new HocuspocusProvider({
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
  });

  client.provider = provider;
  return client;
}

function awarenessUsers(provider) {
  const states = provider?.awareness?.getStates?.();
  if (!states) {
    return [];
  }

  return Array.from(states.values())
    .map((state) => state?.user)
    .filter(Boolean)
    .map((user) => ({
      id: String(user.id ?? 'anon'),
      name: String(user.name ?? 'Anónimo'),
      color: String(user.color ?? '#94a3b8'),
    }));
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

async function runTest(name, fn) {
  const startedAt = Date.now();
  try {
    await fn();
    const duration = Date.now() - startedAt;
    console.log(`PASS ${name} (${duration}ms)`);
    return true;
  } catch (error) {
    const duration = Date.now() - startedAt;
    console.error(`FAIL ${name} (${duration}ms)`);
    console.error(error?.stack ?? error?.message ?? error);
    return false;
  }
}

async function testConnectionAndAuthentication(users) {
  const project = await createProject(users.admin1, ['david'], 'connection');
  const tokenResult = await getCollabToken(users.admin1, project.id);
  assert.equal(tokenResult.response.status, 200, JSON.stringify(tokenResult.body));
  assert(tokenResult.body?.token, 'Expected collab token');

  const client = createProviderClient({
    token: tokenResult.body.token,
    room: String(project.id),
    user: users.admin1,
    color: '#4285f4',
  });

  try {
    await client.synced;
    assert(client.text.toString().length >= 0, 'Shared text should be readable');
  } finally {
    client.disconnect();
  }
}

async function testAuthenticationFailure() {
  const document = new Y.Doc();
  const failed = new Promise((resolve, reject) => {
    const provider = new HocuspocusProvider({
      url: WS_BASE_URL,
      name: 'auth-fail-room',
      document,
      token: 'this-is-not-a-valid-token',
      WebSocketPolyfill: WebSocket,
      // Don't treat low-level socket connect as successful authentication;
      // wait for explicit auth failure or unexpected sync instead.
      onConnect: () => {},
      onSynced: () => reject(new Error('Unexpected sync on invalid token')),
      onAuthenticationFailed: ({ reason }) => resolve(reason ?? 'authentication failed'),
    });

    setTimeout(() => {
      try {
        provider.destroy();
      } catch {
        // ignore
      }
      reject(new Error('Authentication failure was not reported in time'));
    }, 5000);
  });

  await failed;
  document.destroy();
}

async function testPersistence(users) {
  const project = await createProject(users.admin1, ['david'], 'persistence');
  const tokenResult = await getCollabToken(users.admin1, project.id);
  assert.equal(tokenResult.response.status, 200, JSON.stringify(tokenResult.body));

  const marker = `persistence-${Date.now()}`;
  const writer = createProviderClient({
    token: tokenResult.body.token,
    room: String(project.id),
    user: users.admin1,
    color: '#34a853',
  });

  try {
    await writer.synced;
    writer.text.insert(0, marker);
    await delay(400);
  } finally {
    writer.disconnect();
  }

  const verifierToken = await getCollabToken(users.admin1, project.id);
  assert.equal(verifierToken.response.status, 200, JSON.stringify(verifierToken.body));
  const reader = createProviderClient({
    token: verifierToken.body.token,
    room: String(project.id),
    user: users.admin1,
    color: '#4285f4',
  });

  try {
    await reader.synced;
    await waitFor(() => reader.text.toString().includes(marker), 6000);
    assert(reader.text.toString().includes(marker), 'Persisted text was not restored');
  } finally {
    reader.disconnect();
  }
}

async function testConcurrentEdits(users) {
  const project = await createProject(users.admin1, ['david'], 'concurrent');
  const ownerToken = await getCollabToken(users.admin1, project.id);
  const guestToken = await getCollabToken(users.david, project.id);
  assert.equal(ownerToken.response.status, 200, JSON.stringify(ownerToken.body));
  assert.equal(guestToken.response.status, 200, JSON.stringify(guestToken.body));

  const owner = createProviderClient({
    token: ownerToken.body.token,
    room: String(project.id),
    user: users.admin1,
    color: '#f28b82',
  });
  const guest = createProviderClient({
    token: guestToken.body.token,
    room: String(project.id),
    user: users.david,
    color: '#fbbc04',
  });

  const ownerMarker = `owner-${Date.now()}`;
  const guestMarker = `guest-${Date.now()}`;

  try {
    await Promise.all([owner.synced, guest.synced]);
    owner.text.insert(owner.text.length, ownerMarker);
    guest.text.insert(guest.text.length, guestMarker);

    await waitFor(
      () => owner.text.toString().includes(ownerMarker) && owner.text.toString().includes(guestMarker)
        && guest.text.toString().includes(ownerMarker) && guest.text.toString().includes(guestMarker),
      6000,
    );

    assert(owner.text.toString().includes(ownerMarker), 'Owner edit missing');
    assert(owner.text.toString().includes(guestMarker), 'Guest edit missing on owner');
    assert(guest.text.toString().includes(ownerMarker), 'Owner edit missing on guest');
    assert(guest.text.toString().includes(guestMarker), 'Guest edit missing');
  } finally {
    owner.disconnect();
    guest.disconnect();
  }
}

async function testAwareness(users) {
  const project = await createProject(users.admin1, ['david', 'samuel'], 'awareness');
  const ownerToken = await getCollabToken(users.admin1, project.id);
  const davidToken = await getCollabToken(users.david, project.id);
  const samuelToken = await getCollabToken(users.samuel, project.id);
  assert.equal(ownerToken.response.status, 200, JSON.stringify(ownerToken.body));
  assert.equal(davidToken.response.status, 200, JSON.stringify(davidToken.body));
  assert.equal(samuelToken.response.status, 200, JSON.stringify(samuelToken.body));

  const owner = createProviderClient({
    token: ownerToken.body.token,
    room: String(project.id),
    user: users.admin1,
    color: '#4285f4',
  });
  const david = createProviderClient({
    token: davidToken.body.token,
    room: String(project.id),
    user: users.david,
    color: '#34a853',
  });
  const samuel = createProviderClient({
    token: samuelToken.body.token,
    room: String(project.id),
    user: users.samuel,
    color: '#fbbc04',
  });

  try {
    await Promise.all([owner.synced, david.synced, samuel.synced]);
    await waitFor(() => {
      const ownerNames = awarenessUsers(owner.provider).map((user) => user.name).sort();
      const davidNames = awarenessUsers(david.provider).map((user) => user.name).sort();
      const samuelNames = awarenessUsers(samuel.provider).map((user) => user.name).sort();
      const expected = ['admin1', 'david', 'samuel'].sort();
      return JSON.stringify(ownerNames) === JSON.stringify(expected)
        && JSON.stringify(davidNames) === JSON.stringify(expected)
        && JSON.stringify(samuelNames) === JSON.stringify(expected);
    }, 6000);

    assert.deepEqual(awarenessUsers(owner.provider).map((user) => user.name).sort(), ['admin1', 'david', 'samuel']);
  } finally {
    owner.disconnect();
    david.disconnect();
    samuel.disconnect();
  }
}

async function testDisconnectCleanup(users) {
  const project = await createProject(users.admin1, ['david'], 'disconnect');
  const ownerToken = await getCollabToken(users.admin1, project.id);
  const davidToken = await getCollabToken(users.david, project.id);
  assert.equal(ownerToken.response.status, 200, JSON.stringify(ownerToken.body));
  assert.equal(davidToken.response.status, 200, JSON.stringify(davidToken.body));

  const owner = createProviderClient({
    token: ownerToken.body.token,
    room: String(project.id),
    user: users.admin1,
    color: '#4285f4',
  });
  const david = createProviderClient({
    token: davidToken.body.token,
    room: String(project.id),
    user: users.david,
    color: '#34a853',
  });

  try {
    await Promise.all([owner.synced, david.synced]);
    await waitFor(() => awarenessUsers(owner.provider).length === 2 && awarenessUsers(david.provider).length === 2, 6000);

    david.disconnect();

    await waitFor(() => awarenessUsers(owner.provider).length === 1, 6000);
    assert.deepEqual(awarenessUsers(owner.provider).map((user) => user.name), ['admin1']);
  } finally {
    owner.disconnect();
    david.disconnect();
  }
}

async function testMaxUsers(users) {
  const limitUser = await registerUser(`limit-${Date.now()}`);
  const project = await createProject(users.admin1, ['david', 'samuel', 'santiago', limitUser.username], 'limit');
  const joiners = [users.admin1, users.david, users.samuel, users.santiago];
  const tokens = [];

  for (const user of joiners) {
    const result = await getCollabToken(user, project.id);
    assert.equal(result.response.status, 200, `Expected join success for ${user.username}: ${JSON.stringify(result.body)}`);
    tokens.push(result.body.token);
  }

  const activeClients = joiners.map((user, index) => createProviderClient({
    token: tokens[index],
    room: String(project.id),
    user,
    color: ['#4285f4', '#34a853', '#fbbc04', '#f28b82'][index],
  }));

  try {
    await Promise.all(activeClients.map((client) => client.synced));

    const rejected = await getCollabToken(limitUser, project.id);
    assert.equal(rejected.response.status, 429, `Expected 429 for 5th user, got ${rejected.response.status}: ${JSON.stringify(rejected.body)}`);
  } finally {
    for (const client of activeClients) {
      client.disconnect();
    }
  }
}

async function main() {
  const users = await ensureUsers(['admin1', 'david', 'samuel', 'santiago']);

  const results = [];
  results.push(await runTest('1. authentication connection', () => testConnectionAndAuthentication(users)));
  results.push(await runTest('2. authentication failure', testAuthenticationFailure));
  results.push(await runTest('3. persistence', () => testPersistence(users)));
  results.push(await runTest('4. concurrent edits', () => testConcurrentEdits(users)));
  results.push(await runTest('5. awareness', () => testAwareness(users)));
  results.push(await runTest('6. disconnect cleanup', () => testDisconnectCleanup(users)));
  results.push(await runTest('7. max users', () => testMaxUsers(users)));

  await cleanupProjects();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/7 collaboration websocket tests passed`);

  if (passed !== 7) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(error?.stack ?? error?.message ?? error);
  await cleanupProjects();
  process.exitCode = 1;
});