const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
async function openGame(options = {}) {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer(async (req, res) => {
    try {
      const name = new URL(req.url, 'http://localhost').pathname;
      const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
      if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
      let body = await fs.readFile(file);
      if (name === '/app.js') body += '\nwindow.__hudTest = source => eval(source);';
      const mime = {'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.mp3':'audio/mpeg'}[path.extname(file)];
      res.writeHead(200, {'Content-Type':mime || 'application/octet-stream'}).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'});
  const context = await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844},...options});
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !!window.__hudTest);
  return {page,context,browser,run:code=>page.evaluate(source=>window.__hudTest(source),code),
    close:async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));}};
}
module.exports = {openGame};
