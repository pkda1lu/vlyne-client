import net from 'net';

export function tcpPing(host: string, port: number, timeout = 3000): Promise<number> {
    return new Promise((resolve) => {
        const start = Date.now();
        const socket = new net.Socket();

        socket.setTimeout(timeout);

        socket.on('connect', () => {
            const duration = Date.now() - start;
            socket.destroy();
            resolve(duration);
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve(-1); // Timeout
        });

        socket.on('error', (err) => {
            socket.destroy();
            // console.error(`Ping error for ${host}:${port}:`, err.message);
            resolve(-1); // Error
        });

        socket.connect(port, host);
    });
}

