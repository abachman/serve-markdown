const EventEmitter = require('events'),
      express = require('express'),
      ws = require('express-ws'),
      marked = require('marked'),
      fs = require('fs');

marked.setOptions({
  renderer: new marked.Renderer(),
  pedantic: false,
  gfm: true,
  tables: true,
  breaks: false,
  sanitize: false,
  smartLists: true,
  smartypants: false,
  xhtml: false
});

class ChangeMonitor extends EventEmitter {}

class Server {
  constructor(config={}) {
    this.port = config.port
    this.filename = config.filename
    this.formatted = ''
    this.changes = new ChangeMonitor()

    this.update()
    this.server = this.serve()
  }

  // reopen, read, and markdown format the original file
  update() {
    this.formatted = marked(fs.readFileSync(this.filename, 'utf8'))
  }

  // just enough HTML
  _handleIndex(req, res) {
    console.log("_handleIndex")
    res.send(`
      <!doctype html>
      <html>
        <head>
          <style>
            body{font-family:Helvetica,Arial,Freesans,clean,sans-serif;padding:1em;margin:auto;max-width:42em;background:#fefefe}h1,h2,h3,h4,h5,h6{font-weight:700}h1{color:#000;font-size:28px}h2{border-bottom:1px solid #ccc;color:#000;font-size:24px}h3{font-size:18px}h4{font-size:16px}h5{font-size:14px}h6{color:#777;background-color:inherit;font-size:14px}hr{height:.2em;border:0;color:#ccc;background-color:#ccc}blockquote,dl,li,ol,p,pre,table,ul{margin:15px 0}code,pre{border-radius:3px;background-color:#f8f8f8;color:inherit}code{border:1px solid #eaeaea;margin:0 2px;padding:0 5px}pre{border:1px solid #ccc;line-height:1.25em;overflow:auto;padding:6px 10px}pre>code{border:0;margin:0;padding:0}a,a:visited{color:#4183c4;background-color:inherit;text-decoration:none}
            .wrapper { margin: 0 auto; width: 826px; }
            .contents { margin: 12px; }
          </style>
          <script>
            var exampleSocket = new WebSocket("ws://localhost:${this.port}/changes")
            exampleSocket.onmessage = reload
            function reload() {
              fetch(window.location.href + 'html')
              .then(function (response) {
                return response.json()
              }).then(function (data) {
                console.log("loaded", data.contents.length, "bytes at", data.ts)
                document.getElementById('contents').innerHTML = data.contents
                document.getElementById('ts').innerHTML = data.ts
              })
            }
            reload()
          </script>
        </head>
        <body>
          <div class="wrapper">
            <button onclick="reload(); return false">reload</button> <span id="ts"></span>
            <div id="contents"></div>
          </div>
        </body>
      </html>
    `)
  }

  // serve the formatted markdown file
  _handleHtml(req, res) {
    console.log("serving", this.formatted.length, "bytes")

    res.send(JSON.stringify({
      contents: this.formatted,
      ts: new Date().toISOString()
    }))
  }

  // handle incoming websocket connection
  _handleSocket(ws, req) {
    console.log("websocket connected")

    this.changes.on('change', function pinger() {
      console.log("app.ws got change event")
      try {
        ws.send('change')
      } catch (ex) {
        console.error("error publishing on socket")
        this.changes.removeListener('change', pinger)
      }
    })
  }

  serve() {
    const app = express();
    const expressWs = ws(app);

    fs.watch(this.filename, (evt, fn) => {
      console.log("fs.watch event detected (", evt, fn, ")")

      if (evt === 'change') {
        this.update()
      }

      this.changes.emit('change')
    })

    app.ws('/changes', this._handleSocket.bind(this))
    app.get('/', this._handleIndex.bind(this))
    app.get('/html', this._handleHtml.bind(this))

    const listener = app.listen(this.port, () => {
      console.log("listening for changes to", this.filename,
                  "serving at http://localhost:" + this.port)
    })

    return listener
  }
}

module.exports = Server
