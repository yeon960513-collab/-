// index.html + css + js 를 파일 1개로 합쳐 dist/nexus-autobattler.html 생성 (더블클릭만으로 실행)
const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/, (_, f) => `<style>\n${fs.readFileSync(f, 'utf8')}\n</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, f) => `<script>\n${fs.readFileSync(f, 'utf8')}\n</script>`);
fs.writeFileSync('dist/nexus-autobattler.html', html);
console.log('dist/nexus-autobattler.html', (html.length / 1024).toFixed(0) + 'KB');
