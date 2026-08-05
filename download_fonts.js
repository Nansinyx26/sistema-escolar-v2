import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream';

const streamPipeline = promisify(pipeline);

async function download() {
    const assets = [
        {
            url: 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff2',
            dest: 'js/libs/fonts/bootstrap-icons.woff2'
        },
        {
            url: 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff',
            dest: 'js/libs/fonts/bootstrap-icons.woff'
        },
        {
            url: 'https://cdn.jsdelivr.net/fontsource/fonts/plus-jakarta-sans@latest/latin-400-normal.woff2',
            dest: 'js/libs/fonts/PlusJakartaSans-Regular.woff2'
        },
        {
            url: 'https://cdn.jsdelivr.net/fontsource/fonts/plus-jakarta-sans@latest/latin-700-normal.woff2',
            dest: 'js/libs/fonts/PlusJakartaSans-Bold.woff2'
        },
        {
            url: 'https://cdn.jsdelivr.net/fontsource/fonts/plus-jakarta-sans@latest/latin-800-normal.woff2',
            dest: 'js/libs/fonts/PlusJakartaSans-ExtraBold.woff2'
        },
        {
            url: 'https://unpkg.com/react@18/umd/react.production.min.js',
            dest: 'js/libs/react.min.js'
        },
        {
            url: 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
            dest: 'js/libs/react-dom.min.js'
        }
    ];

    for (const asset of assets) {
        console.log(`Downloading ${asset.url}...`);
        const response = await fetch(asset.url);
        if (!response.ok) throw new Error(`unexpected response ${response.statusText}`);
        await streamPipeline(response.body, fs.createWriteStream(asset.dest));
        console.log(`Saved to ${asset.dest}`);
    }
}

download().catch(console.error);
