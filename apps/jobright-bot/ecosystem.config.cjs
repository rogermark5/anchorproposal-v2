module.exports = { apps: [{ name: 'anchor-jobright-bot', cwd: __dirname, script: 'src/main.cjs', interpreter: 'node',
  instances: 1, exec_mode: 'fork', autorestart: true, restart_delay: 10000, kill_timeout: 15000, max_memory_restart: '750M',
  env: { NODE_ENV: 'production' } }] };
