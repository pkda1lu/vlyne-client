import { app, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';

export class Store {
    private path: string;
    private data: Record<string, any>;

    constructor(opts: { configName: string; defaults: Record<string, any> }) {
        const userDataPath = app.getPath('userData');
        this.path = path.join(userDataPath, opts.configName + '.json');
        this.data = parseDataFile(this.path, opts.defaults);
    }

    get(key: string) {
        return this.data[key];
    }

    set(key: string, val: any) {
        this.data[key] = val;
        fs.writeFileSync(this.path, JSON.stringify(this.data, null, 4)); // Pretty print for debuggability
    }
}

function parseDataFile(filePath: string, defaults: Record<string, any>) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (error) {
        return defaults;
    }
}
