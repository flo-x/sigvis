// Low-level WebSocket connection manager.
// Maintains a single connection to the server, auto-reconnects on disconnect,
// and replays the last subscribe message after reconnect.

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30000;

let socket = null;
let reconnectAttempt = 0;
let reconnectTimer = null;
let lastSubscribeMessage = null; // Most recent subscribe payload (always overwritten)
let messageHandler = null; // Single handler for incoming data messages

function getWsUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

function connect() {
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    return;
  }

  socket = new WebSocket(getWsUrl());

  socket.addEventListener("open", () => {
    reconnectAttempt = 0;
    // Replay the current subscription so the server resets state and sends a snapshot.
    if (lastSubscribeMessage) {
      socket.send(JSON.stringify(lastSubscribeMessage));
    }
  });

  socket.addEventListener("message", (event) => {
    if (!messageHandler) return;
    let parsed;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    messageHandler(parsed);
  });

  socket.addEventListener("close", () => {
    socket = null;
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    // close event fires after error, so just let that handle reconnect.
  });
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

/**
 * Send a message to the server. If the socket is not open, store it and it will
 * be sent on (re)connect (only applies to subscribe messages stored via sendSubscribe).
 * @param {object} message
 */
function sendMessage(message) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

/**
 * Send a subscribe message. Always overwrites the stored last-subscribe so reconnects
 * replay the current state. Initiates the WebSocket connection on first call.
 * @param {object} message
 */
function sendSubscribe(message) {
  lastSubscribeMessage = message;
  connect(); // lazy-connect: establish the socket on first subscription
  sendMessage(message);
}

/**
 * Register the single handler for incoming snapshot/delta/error messages.
 * @param {function} handler
 */
function setMessageHandler(handler) {
  messageHandler = handler;
}

function getReadyState() {
  return socket ? socket.readyState : WebSocket.CLOSED;
}

export { sendMessage, sendSubscribe, setMessageHandler, getReadyState };
