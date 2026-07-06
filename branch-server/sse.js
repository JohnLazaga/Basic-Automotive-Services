/* Server-Sent Events hub — pushes record changes to every connected device,
   the LAN equivalent of Firestore onSnapshot. Clients POST their writes and
   receive everyone's changes here (including their own echo, tagged with an
   `origin` so the originating tab can ignore it). Built-in http only. */
const clients = new Set();

function addClient(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write('retry: 3000\n\n');          // tell EventSource to auto-reconnect
  clients.add(res);
  req.on('close', function () { clients.delete(res); });
}

function broadcast(event, data) {
  const payload = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const res of clients) { try { res.write(payload); } catch (e) { clients.delete(res); } }
}

// Heartbeat keeps intermediaries from dropping idle connections.
const timer = setInterval(function () {
  for (const res of clients) { try { res.write(': ping\n\n'); } catch (e) { clients.delete(res); } }
}, 25000);
if (timer.unref) timer.unref();

module.exports = { addClient, broadcast, count: function () { return clients.size; } };
