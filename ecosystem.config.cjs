module.exports = {
  apps: [
    {
      name: 'sentinel',
      script: 'node',
      args: 'dist/index.js',
      cwd: __dirname + '/server',
      env: {
        NODE_ENV: 'production',
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
