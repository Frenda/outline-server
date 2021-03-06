// Copyright 2018 The Outline Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as digitalocean_api from '../cloud/digitalocean_api';
import {InMemoryStorage} from '../infrastructure/memory_storage';
import {sleep} from '../infrastructure/sleep';
import * as server from '../model/server';

import {App} from './app';
import {TokenManager} from './digitalocean_oauth';
import {DisplayServerRepository, makeDisplayServer} from './display_server';
import {AppRoot} from './ui_components/app-root.js';

const TOKEN_WITH_NO_SERVERS = 'no-server-token';
const TOKEN_WITH_ONE_SERVER = 'one-server-token';

// Define functions from preload.ts.

// tslint:disable-next-line:no-any
(global as any).onUpdateDownloaded = () => {};
// tslint:disable-next-line:no-any
(global as any).bringToFront = () => {};

// Inject app-root element into DOM once before the test suite runs.
beforeAll(async () => {
  // It seems like AppRoot class is not fully loaded/initialized until the
  // constructor, so we invoke it directly.
  const loadAppRoot = new AppRoot();

  document.body.innerHTML = "<app-root id='appRoot' language='en'></app-root>";
});

describe('App', () => {
  it('shows intro when starting with no manual servers or DigitalOcean token', async () => {
    const appRoot = document.getElementById('appRoot') as unknown as AppRoot;
    const app = createTestApp(appRoot, new InMemoryDigitalOceanTokenManager());
    await app.start();
    expect(appRoot.currentPage).toEqual('intro');
  });

  it('will not create a manual server with invalid input', async () => {
    // Create a new app with no existing servers or DigitalOcean token.
    const appRoot = document.getElementById('appRoot') as unknown as AppRoot;
    const app = createTestApp(appRoot, new InMemoryDigitalOceanTokenManager());
    await app.start();
    expect(appRoot.currentPage).toEqual('intro');
    await expectAsync(app.createManualServer('bad input')).toBeRejectedWithError();
  });

  it('creates a manual server with valid input', async () => {
    // Create a new app with no existing servers or DigitalOcean token.
    const appRoot = document.getElementById('appRoot') as unknown as AppRoot;
    const app = createTestApp(appRoot, new InMemoryDigitalOceanTokenManager());
    await app.start();
    expect(appRoot.currentPage).toEqual('intro');
    await app.createManualServer(JSON.stringify({certSha256: 'cert', apiUrl: 'url'}));
    await sleep(2000);  // TODO: refactor test to remove
    expect(appRoot.currentPage).toEqual('serverView');
  });

  it('initially shows and stores server display metadata', async (done) => {
    // Create fake servers and simulate their metadata being cached before creating the app.
    const tokenManager = new InMemoryDigitalOceanTokenManager();
    tokenManager.token = TOKEN_WITH_NO_SERVERS;
    const managedServerRepo = new FakeManagedServerRepository();
    const managedServer = await managedServerRepo.createServer();
    managedServer.apiUrl = 'fake-managed-server-api-url';
    const managedDisplayServer = await makeDisplayServer(managedServer);
    const manualServerRepo = new FakeManualServerRepository();
    const manualServer1 = await manualServerRepo.addServer(
        {certSha256: 'cert', apiUrl: 'fake-manual-server-api-url-1'});
    const manualServer2 = await manualServerRepo.addServer(
        {certSha256: 'cert', apiUrl: 'fake-manual-server-api-url-2'});
    const manualDisplayServer1 = await makeDisplayServer(manualServer1);
    const manualDisplayServer2 = await makeDisplayServer(manualServer2);

    const displayServerRepo = new DisplayServerRepository(new InMemoryStorage());
    const appRoot = document.getElementById('appRoot') as unknown as AppRoot;
    const app = createTestApp(
        appRoot, tokenManager, manualServerRepo, displayServerRepo, managedServerRepo);

    await app.start();
    // Validate that server metadata is shown.
    const managedServers = await managedServerRepo.listServers();
    const manualServers = await manualServerRepo.listServers();
    const serverList = appRoot.serverList;
    expect(serverList.length).toEqual(manualServers.length + managedServers.length);
    expect(serverList).toContain(manualDisplayServer1);
    expect(serverList).toContain(manualDisplayServer2);
    expect(serverList).toContain(managedDisplayServer);

    // Validate that display servers are stored.
    const displayServers = await displayServerRepo.listServers();
    for (const displayServer of displayServers) {
      expect(serverList).toContain(displayServer);
    }
    done();
  });

  it('initially shows stored server display metadata', async (done) => {
    // Create fake servers without caching their display metadata.
    const tokenManager = new InMemoryDigitalOceanTokenManager();
    tokenManager.token = TOKEN_WITH_NO_SERVERS;
    const managedServerRepo = new FakeManagedServerRepository();
    const managedServer = await managedServerRepo.createServer();
    managedServer.apiUrl = 'fake-managed-server-api-url';
    const managedDisplayServer = await makeDisplayServer(managedServer);
    const manualServerRepo = new FakeManualServerRepository();
    const manualServer1 = await manualServerRepo.addServer(
        {certSha256: 'cert', apiUrl: 'fake-manual-server-api-url-1'});
    const manualServer2 = await manualServerRepo.addServer(
        {certSha256: 'cert', apiUrl: 'fake-manual-server-api-url-2'});
    const manualDisplayServer1 = await makeDisplayServer(manualServer1);
    const manualDisplayServer2 = await makeDisplayServer(manualServer2);
    const store = new Map([[
      DisplayServerRepository.SERVERS_STORAGE_KEY,
      JSON.stringify([manualDisplayServer1, manualDisplayServer2, managedDisplayServer])
    ]]);
    const displayServerRepo = new DisplayServerRepository(new InMemoryStorage(store));
    const appRoot = document.getElementById('appRoot') as unknown as AppRoot;
    const app = createTestApp(
        appRoot, tokenManager, manualServerRepo, displayServerRepo, managedServerRepo);

    await app.start();
    const managedServers = await managedServerRepo.listServers();
    const manualServers = await manualServerRepo.listServers();
    const serverList = appRoot.serverList;
    expect(serverList.length).toEqual(manualServers.length + managedServers.length);
    expect(serverList).toContain(manualDisplayServer1);
    expect(serverList).toContain(manualDisplayServer2);
    expect(serverList).toContain(managedDisplayServer);
    done();
  });

  it('initially shows the last selected server', async () => {
    const tokenManager = new InMemoryDigitalOceanTokenManager();
    tokenManager.token = TOKEN_WITH_ONE_SERVER;

    const LAST_DISPLAYED_SERVER_ID = 'fake-manual-server-api-url-1';
    const manualServerRepo = new FakeManualServerRepository();
    const lastDisplayedServer =
        await manualServerRepo.addServer({certSha256: 'cert', apiUrl: LAST_DISPLAYED_SERVER_ID});
    const manualServer = await manualServerRepo.addServer(
        {certSha256: 'cert', apiUrl: 'fake-manual-server-api-url-2'});
    const manualDisplayServer1 = await makeDisplayServer(lastDisplayedServer);
    const manualDisplayServer2 = await makeDisplayServer(manualServer);
    const store = new Map([[
      DisplayServerRepository.SERVERS_STORAGE_KEY,
      JSON.stringify([manualDisplayServer1, manualDisplayServer2])
    ]]);
    const displayServerRepo = new DisplayServerRepository(new InMemoryStorage(store));
    displayServerRepo.storeLastDisplayedServerId(LAST_DISPLAYED_SERVER_ID);

    const appRoot = document.getElementById('appRoot') as unknown as AppRoot;
    const app = createTestApp(appRoot, tokenManager, manualServerRepo, displayServerRepo);
    await app.start();
    await sleep(2000);  // TODO: refactor test to remove
    expect(appRoot.currentPage).toEqual('serverView');
    expect(appRoot.selectedServer.id).toEqual(lastDisplayedServer.getManagementApiUrl());
  });

  it('shows progress screen once DigitalOcean droplets are created', async () => {
    // Start the app with a fake DigitalOcean token.
    const appRoot = document.getElementById('appRoot') as unknown as AppRoot;
    const tokenManager = new InMemoryDigitalOceanTokenManager();
    tokenManager.token = TOKEN_WITH_NO_SERVERS;
    const app = createTestApp(appRoot, tokenManager);
    await app.start();
    await app.createDigitalOceanServer('fakeRegion');
    expect(appRoot.currentPage).toEqual('serverProgressStep');
  });

  it('shows progress screen when starting with DigitalOcean servers still being created',
     async () => {
       const appRoot = document.getElementById('appRoot') as unknown as AppRoot;
       const tokenManager = new InMemoryDigitalOceanTokenManager();
       tokenManager.token = TOKEN_WITH_NO_SERVERS;
       const managedSeverRepository = new FakeManagedServerRepository();
       // Manually create the server since the DO repository server factory function is synchronous.
       await managedSeverRepository.createUninstalledServer();
       const app = createTestApp(appRoot, tokenManager, null, null, managedSeverRepository);
       await app.start();
       expect(appRoot.currentPage).toEqual('serverProgressStep');
     });
});

function createTestApp(
    appRoot: AppRoot, digitalOceanTokenManager: InMemoryDigitalOceanTokenManager,
    manualServerRepo?: server.ManualServerRepository,
    displayServerRepository?: FakeDisplayServerRepository,
    managedServerRepository?: FakeManagedServerRepository) {
  const VERSION = '0.0.1';
  const fakeDigitalOceanSessionFactory = (accessToken: string) => {
    return new FakeDigitalOceanSession(accessToken);
  };
  const fakeDigitalOceanServerRepositoryFactory =
      (session: digitalocean_api.DigitalOceanSession) => {
        const repo = managedServerRepository || new FakeManagedServerRepository();
        if (session.accessToken === TOKEN_WITH_ONE_SERVER) {
          repo.createServer();  // OK to ignore promise as the fake implementation is synchronous.
        }
        return repo;
      };
  if (!manualServerRepo) {
    manualServerRepo = new FakeManualServerRepository();
  }
  if (!displayServerRepository) {
    displayServerRepository = new FakeDisplayServerRepository();
  }
  return new App(
      appRoot, VERSION, fakeDigitalOceanSessionFactory, fakeDigitalOceanServerRepositoryFactory,
      manualServerRepo, displayServerRepository, digitalOceanTokenManager);
}

class FakeServer implements server.Server {
  private name = 'serverName';
  private metricsEnabled = false;
  private id: string;
  apiUrl: string;
  constructor() {
    this.id = Math.random().toString();
  }
  getName() {
    return this.name;
  }
  setName(name: string) {
    this.name = name;
    return Promise.resolve();
  }
  getVersion() {
    return '1.2.3';
  }
  listAccessKeys() {
    return Promise.resolve([]);
  }
  getMetricsEnabled() {
    return this.metricsEnabled;
  }
  setMetricsEnabled(metricsEnabled: boolean) {
    this.metricsEnabled = metricsEnabled;
    return Promise.resolve();
  }
  getServerId() {
    return this.id;
  }
  isHealthy() {
    return Promise.resolve(true);
  }
  getCreatedDate() {
    return new Date();
  }
  getDataUsage() {
    return Promise.resolve({bytesTransferredByUserId: {}});
  }
  addAccessKey() {
    return Promise.reject(new Error('FakeServer.addAccessKey not implemented'));
  }
  renameAccessKey(accessKeyId: server.AccessKeyId, name: string) {
    return Promise.reject(new Error('FakeServer.renameAccessKey not implemented'));
  }
  removeAccessKey(accessKeyId: server.AccessKeyId) {
    return Promise.reject(new Error('FakeServer.removeAccessKey not implemented'));
  }
  setHostnameForAccessKeys(hostname: string) {
    return Promise.reject(new Error('FakeServer.setHostname not implemented'));
  }
  getHostnameForAccessKeys() {
    return 'fake-server';
  }
  getManagementApiUrl() {
    return this.apiUrl || Math.random().toString();
  }
  getPortForNewAccessKeys(): number|undefined {
    return undefined;
  }
  setPortForNewAccessKeys(): Promise<void> {
    return Promise.reject(new Error('FakeServer.setPortForNewAccessKeys not implemented'));
  }
  setAccessKeyDataLimit(limit: server.DataLimit): Promise<void> {
    return Promise.reject(new Error('FakeServer.setAccessKeyDataLimit not implemented'));
  }
  removeAccessKeyDataLimit(): Promise<void> {
    return Promise.resolve();
  }
  getAccessKeyDataLimit(): server.DataLimit|undefined {
    return undefined;
  }
}

class FakeManualServer extends FakeServer implements server.ManualServer {
  constructor(public manualServerConfig: server.ManualServerConfig) {
    super();
  }
  getManagementApiUrl() {
    return this.manualServerConfig.apiUrl;
  }
  forget() {
    return Promise.reject(new Error('FakeManualServer.forget not implemented'));
  }
  getCertificateFingerprint() {
    return this.manualServerConfig.certSha256;
  }
}

class FakeManualServerRepository implements server.ManualServerRepository {
  private servers: server.ManualServer[] = [];

  addServer(config: server.ManualServerConfig) {
    const newServer = new FakeManualServer(config);
    this.servers.push(newServer);
    return Promise.resolve(newServer);
  }

  findServer(config: server.ManualServerConfig) {
    return this.servers.find(server => server.getManagementApiUrl() === config.apiUrl);
  }

  listServers() {
    return Promise.resolve(this.servers);
  }
}

class InMemoryDigitalOceanTokenManager implements TokenManager {
  public token: string;
  getStoredToken(): string {
    return this.token;
  }
  removeTokenFromStorage() {
    this.token = null;
  }
  writeTokenToStorage(token: string) {
    this.token = token;
  }
}

class FakeDigitalOceanSession implements digitalocean_api.DigitalOceanSession {
  constructor(public accessToken: string) {}

  // Return fake account data.
  getAccount() {
    return Promise.resolve(
        {email: 'fake@email.com', uuid: 'fake', email_verified: true, status: 'active'});
  }

  // Return an empty list of droplets by default.
  getDropletsByTag = (tag: string) => Promise.resolve([]);

  // Return an empty list of regions by default.
  getRegionInfo = () => Promise.resolve([]);

  // Other methods do not yet need implementations for tests to pass.
  createDroplet =
      (displayName: string, region: string, publicKeyForSSH: string,
       dropletSpec: digitalocean_api.DigitalOceanDropletSpecification) =>
          Promise.reject(new Error('createDroplet not implemented'));
  deleteDroplet = (dropletId: number) => Promise.reject(new Error('deleteDroplet not implemented'));
  getDroplet = (dropletId: number) => Promise.reject(new Error('getDroplet not implemented'));
  getDropletTags = (dropletId: number) =>
      Promise.reject(new Error('getDropletTags not implemented'));
  getDroplets = () => Promise.reject(new Error('getDroplets not implemented'));
}

class FakeManagedServer extends FakeServer implements server.ManagedServer {
  constructor(private isInstalled = true) {
    super();
  }
  waitOnInstall(resetTimeout: boolean) {
    // Return a promise which does not yet fulfill, to simulate long
    // shadowbox install time.
    return new Promise<void>((fulfill, reject) => {});
  }
  getHost() {
    return {
      getMonthlyOutboundTransferLimit: () => ({terabytes: 1}),
      getMonthlyCost: () => ({usd: 5}),
      getRegionId: () => 'fake-region',
      delete: () => Promise.resolve(),
      getHostId: () => 'fake-host-id',
    };
  }
  isInstallCompleted() {
    return this.isInstalled;
  }
}

class FakeManagedServerRepository implements server.ManagedServerRepository {
  private servers: server.ManagedServer[] = [];
  listServers() {
    return Promise.resolve(this.servers);
  }
  getRegionMap() {
    return Promise.resolve({'fake': ['fake1', 'fake2']});
  }
  createServer() {
    const newServer = new FakeManagedServer();
    this.servers.push(newServer);
    return Promise.resolve(newServer);
  }

  createUninstalledServer() {
    const newServer = new FakeManagedServer(false);
    this.servers.push(newServer);
    return Promise.resolve(newServer);
  }
}

class FakeDisplayServerRepository extends DisplayServerRepository {
  constructor() {
    super(new InMemoryStorage());
  }
}
