const fs = require('fs');
const path = require('path');

const sourceDir = path.resolve(__dirname, '../../data');
const targetDir = path.resolve(__dirname, '../public/data');

fs.mkdirSync(targetDir, { recursive: true });

for (const file of fs.readdirSync(sourceDir)) {
    if (!file.startsWith('masters.oe.')) continue;

    fs.copyFileSync(
        path.join(sourceDir, file),
        path.join(targetDir, file)
    );
}

console.log('Copied masters.oe.* files.');