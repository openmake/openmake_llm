const { DashboardServer } = require('./dist/dashboard');

async function start() {
    console.log('Starting Dashboard Server explicitly...');
    try {
        const server = new DashboardServer({ port: 52416 });
        console.log('Server instance created.');

        await server.start();
        console.log('Server started successfully on port 52416');

        // Keep alive
        setInterval(() => { }, 1000);
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

start();
