import { createServer } from 'node:http';
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url === '/second') return res.end('<!doctype html><title>Browser second page</title><h1>Navigation succeeded</h1><a href="/">First page</a>');
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Neon Violet Browser QA</title><style>
  body { margin: 0; background: #130a1f; color: #ece4ff; font: 20px system-ui; padding: 32px; }
  main { max-width: 700px; padding: 28px; border: 2px solid #c33cf0; border-radius: 20px; }
  h1 { color: #c33cf0; } input, button { font: inherit; padding: 12px; border-radius: 8px; }
  button { background: #39e6a2; color: #130a1f; } output { display: block; margin: 20px 0; color: #39e6a2; } a { color: #1fd1c9; }
  </style></head><body><main><h1>Interactive browser</h1><label>Name <input id="name" aria-label="Name"></label>
  <button id="apply">Apply</button><output id="result">Waiting for input</output><a href="/second">Next page</a>
  <p>Real CSS, JavaScript, input and navigation.</p></main><div style="height:900px"></div><footer id="footer">Scroll reached the footer</footer>
  <script>document.querySelector('#apply').onclick=()=>{document.querySelector('#result').textContent='Hello, '+document.querySelector('#name').value;}; document.body.dataset.ready='yes';</script></body></html>`);
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}` })));
