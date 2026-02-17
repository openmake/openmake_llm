const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { DashboardServer } = require('./dist/dashboard');

async function start() {
    const port = parseInt(process.env.PORT, 10) || undefined;
    console.log(`Starting Dashboard Server on port ${port || '(default from config)'}...`);
    try {
        const server = new DashboardServer(port ? { port } : undefined);
        console.log('Server instance created.');

        await server.start();
        console.log(`Server started successfully at ${server.url}`);

        // Keep alive
        setInterval(() => { }, 1000);
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

start();
