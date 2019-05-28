const EventEmitter = require('events'),
      http = require('http'),
      express = require('express'),
      ws = require('express-ws'),
      marked = require('marked'),
      fs = require('fs'),
      path = require('path'),
      template = require('lodash.template')

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

class Templates {
  constructor() {
    this.cache = {}
  }

  load(view) {
    const fpath = path.join(__dirname, 'views', `${view}.html`)
    this.cache[view] = template(fs.readFileSync(fpath))
  }

  render(view, ctx) {
    if (!this.cache[view]) { this.load(view) }
    return this.cache[view](ctx)
  }
}

class Server {
  constructor(config={}) {
    this.port = config.port
    this.filename = config.filename
    this.formatted = ''
    this.changes = new ChangeMonitor()
    this.templates = new Templates()
    this._failure_to_bind = 0

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
    res.send(this.templates.render('index', { port: this.port, title: this.filename }))
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

  listen(server) {
    server.listen(this.port)
    console.log("listening for changes to", this.filename,
                "serving at http://localhost:" + this.port)
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

    const server = http.createServer(app)
    server.on('error', (err) => {
      const nextPort = parseInt(this.port) + 1
      console.error("failed to bind to", this.port, "trying", nextPort, `err: "${err.message}"`)

      this._failure_to_bind += 1
      this.port = nextPort

      if (this._failure_to_bind < 10) {
        this.listen(app)
      } else {
        console.error("FAILED TO BIND TO ANY PORT")
      }
    })
    return this.listen(server)
  }
}

module.exports = Server
