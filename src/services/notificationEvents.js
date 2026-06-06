const logger = require("../util/logger");
const pool = require("../config/db");

const clientsByUserId = new Map();

function writeEvent(res, event, payload = {}) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function addNotificationClient(userId, res) {
  const key = String(userId);
  if (!clientsByUserId.has(key)) clientsByUserId.set(key, new Set());

  const clients = clientsByUserId.get(key);
  clients.add(res);
  writeEvent(res, "connected", { ok: true });

  const heartbeat = setInterval(() => {
    try {
      writeEvent(res, "heartbeat", { at: Date.now() });
    } catch {
      clearInterval(heartbeat);
    }
  }, 30000);

  res.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (clients.size === 0) clientsByUserId.delete(key);
  });

  logger.info("notifications.stream_connected", {
    userId: key,
    connectionCount: clients.size,
  });
}

function sendToUser(userId, event, payload = {}) {
  const clients = clientsByUserId.get(String(userId));
  if (!clients?.size) return 0;

  let sent = 0;
  for (const res of clients) {
    try {
      writeEvent(res, event, payload);
      sent += 1;
    } catch (err) {
      logger.warn("notifications.stream_send_failed", {
        userId,
        event,
        errorMessage: err?.message,
      });
    }
  }

  return sent;
}

function sendNotificationToUser(userId, payload = {}) {
  const eventPayload = {
    title: "New update",
    message: "You have a new update.",
    ...payload,
  };
  const clientCount = sendToUser(userId, "notification.updated", eventPayload);

  logger.info("notifications.sent", {
    userId,
    clientCount,
    deliveredLive: clientCount > 0,
    type: eventPayload.type || "notification.updated",
    title: eventPayload.title,
  });

  return clientCount;
}

function sendSessionRevokedToUser(userId, payload = {}) {
  const eventPayload = {
    message: "Another device logged in. Please sign in again.",
    ...payload,
  };
  const clientCount = sendToUser(userId, "session.revoked", eventPayload);

  logger.info("notifications.session_revoked_sent", {
    userId,
    clientCount,
    deliveredLive: clientCount > 0,
  });

  return clientCount;
}

async function sendNotificationToStaff(payload = {}) {
  try {
    const { rows } = await pool.query(
      `SELECT id
       FROM users
       WHERE is_superadmin = TRUE OR is_admin = TRUE OR is_manager = TRUE`,
    );

    let deliveredClients = 0;
    rows.forEach((staff) => {
      deliveredClients += sendNotificationToUser(staff.id, {
        audience: "staff",
        ...payload,
      });
    });

    logger.info("notifications.staff_sent", {
      staffCount: rows.length,
      deliveredClients,
      type: payload.type || "notification.updated",
      ticketId: payload.ticketId,
    });

    return deliveredClients;
  } catch (err) {
    logger.error("notifications.staff_send_failed", err, {
      type: payload.type || "notification.updated",
      ticketId: payload.ticketId,
    });
    return 0;
  }
}

module.exports = {
  addNotificationClient,
  sendNotificationToStaff,
  sendNotificationToUser,
  sendSessionRevokedToUser,
  sendToUser,
};
