/**
 * CONFIGURACIÓN DE SERVIDORES LSP
 * 
 * Estructura del array de servidores para el multiplexor LSP.
 * Cada objeto define un servidor de lenguaje diferente que puede ser instanciado.
 * 
 * @property {string} name - Nombre descriptivo del servidor (uso humano/logs)
 * @property {string} endpoint - Identificador único para enrutamiento WebSocket (ej: 'python', 'cpp')
 * @property {string} command - Comando ejecutable del servidor LSP (debe estar en PATH)
 * @property {string[]} args - Argumentos de línea de comandos para el servidor
 * @property {string} [workDir] - Directorio de trabajo del proceso (default: directorio actual)
 * @property {boolean} [translatePaths] - Si true, convierte rutas entre URI file:// y path del sistema
 * @property {Object<string, string>} [env] - Variables de entorno adicionales para el servidor
 */

export const servers = [
    {
        name: 'Python LSP',
        endpoint: 'python',
        command: 'pylsp',
        args: [],
        workDir: '/workspace',
        translatePaths: true,
        env: {
            PYTHONPATH: '/workspace'
        }
    },
    {
        name: 'C++ Clangd',
        endpoint: 'cpp',
        command: 'clangd',
        args: [
            '--compile-commands-dir=/workspace',
            '--background-index',
            '--clang-tidy',
            '--all-scopes-completion',
            '--completion-style=detailed',
            '--header-insertion=iwyu'
        ],
        workDir: '/workspace',
        translatePaths: true,
        env: {}
    },
    {
        name: 'TypeScript/JavaScript',
        endpoint: 'typescript',
        command: 'typescript-language-server',
        args: ['--stdio'],
        workDir: '/workspace',
        translatePaths: true,
        env: {}
    }
];
