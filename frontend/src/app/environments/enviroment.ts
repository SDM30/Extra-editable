export const enviroment = {
  production: false,
  apiBaseUrl: 'http://localhost:8080/api',
  collabUrl: 'http://localhost:8080/collab',
  ejecutarUrl: 'ws://localhost:8081/ws/execute',
  // Se accede al Language Service a través del gateway (Nginx) en `/lsp/`
  apiUrlLanguageServer: 'http://localhost:8080',
};
