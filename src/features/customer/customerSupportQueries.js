const TICKET_FIELDS = `
  nt.ticket_id, nt.user_id, nt.category, nt.subject, nt.query,
  nt.reply, nt.type, nt.status, nt.is_visible_in_updates,
  nt.is_visible_in_home, nt.is_read, nt.read_at,
  nt.home_dismissed_at, nt.updates_cleared_at,
  nt.photo_urls, nt.created_at, nt.updated_at
`;

const TICKET_RETURNING_FIELDS = `
  ticket_id, user_id, category, subject, query, reply, type, status,
  is_visible_in_updates, is_visible_in_home, is_read, read_at,
  home_dismissed_at, updates_cleared_at, photo_urls,
  created_at, updated_at
`;

const APPOINTMENT_FIELDS = `
  ab.booking_id, ab.appointment_type, ab.appointment_address
`;

function addSearchFilter(filters, values, search) {
  if (!search) return;

  values.push(`%${search}%`);
  const index = values.length;
  filters.push(
    `(nt.ticket_id ILIKE $${index}
      OR nt.category ILIKE $${index}
      OR nt.subject ILIKE $${index}
      OR nt.query ILIKE $${index}
      OR COALESCE(nt.reply, '') ILIKE $${index}
      OR COALESCE(nt.type, '') ILIKE $${index}
      OR nt.status ILIKE $${index}
      OR EXISTS (
        SELECT 1
        FROM notification_ticket_messages ntm
        WHERE ntm.ticket_id = nt.ticket_id
          AND ntm.is_internal = FALSE
          AND ntm.message_body ILIKE $${index}
      ))`,
  );
}

function buildTicketListFilter({ userId, search, type, read }) {
  const values = [userId];
  const filters = [
    "nt.user_id = $1",
    "nt.is_visible_in_updates = TRUE",
  ];

  addSearchFilter(filters, values, search);

  if (type && type !== "all") {
    values.push(type);
    filters.push(`COALESCE(nt.type, '') = $${values.length}`);
  }

  if (read && read !== "all") {
    values.push(read === "read");
    filters.push(`nt.is_read = $${values.length}`);
  }

  return {
    values,
    whereClause: `WHERE ${filters.join(" AND ")}`,
  };
}

function buildHomeNotificationFilter(userId) {
  return {
    values: [userId],
    whereClause: `
      WHERE nt.user_id = $1
        AND nt.is_visible_in_updates = TRUE
        AND nt.is_visible_in_home = TRUE
        AND nt.is_read = FALSE
    `,
  };
}

async function countTickets(db, whereClause, values) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::INT AS total,
            COUNT(*) FILTER (WHERE nt.is_read = FALSE)::INT AS unread_total
     FROM notification_tickets nt
     ${whereClause}`,
    values,
  );

  return {
    total: rows[0]?.total || 0,
    unreadTotal: rows[0]?.unread_total || 0,
  };
}

async function listTickets(db, whereClause, values, limit, offset) {
  const listValues = [...values, limit, offset];

  const { rows } = await db.query(
    `SELECT ${TICKET_FIELDS}, ${APPOINTMENT_FIELDS}
     FROM notification_tickets nt
     LEFT JOIN appointment_bookings ab
       ON ab.notification_ticket_id = nt.ticket_id
     ${whereClause}
     ORDER BY nt.updated_at DESC
     LIMIT $${listValues.length - 1}
     OFFSET $${listValues.length}`,
    listValues,
  );

  return rows;
}

async function findTicketForMessage(db, { ticketId, isAdmin, userId }) {
  const { rows } = await db.query(
    `SELECT ${TICKET_FIELDS}
     FROM notification_tickets nt
     WHERE nt.ticket_id = $1
       AND ($2::BOOLEAN OR nt.user_id = $3)
       AND COALESCE(nt.type, '') <> 'Appointment'
     FOR UPDATE`,
    [ticketId, isAdmin, userId],
  );

  return rows[0] || null;
}

async function insertTicketMessage(db, { ticketId, userId, authorRole, messageBody }) {
  await db.query(
    `INSERT INTO notification_ticket_messages
      (ticket_id, author_user_id, author_role, message_body)
     VALUES ($1, $2, $3, $4)`,
    [ticketId, userId, authorRole, messageBody],
  );
}

async function makeTicketVisibleInUpdates(db, ticketId) {
  const { rows } = await db.query(
    `UPDATE notification_tickets
     SET is_visible_in_updates = TRUE,
         updated_at = NOW()
     WHERE ticket_id = $1
     RETURNING ${TICKET_RETURNING_FIELDS}`,
    [ticketId],
  );

  return rows[0] || null;
}

module.exports = {
  TICKET_RETURNING_FIELDS,
  buildTicketListFilter,
  buildHomeNotificationFilter,
  countTickets,
  listTickets,
  findTicketForMessage,
  insertTicketMessage,
  makeTicketVisibleInUpdates,
};
