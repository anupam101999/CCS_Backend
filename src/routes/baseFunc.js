const router = require("express").Router();
const {
  register,
  login,
  update,
  supportTicket,
  listAppointments,
  bookAppointment,
  rescheduleAppointment,
  getMyTickets,
  deleteNotification,
  clearNotifications,
  confirmedAppointments,
  signOut,
  validateSession,
} = require("../controllers/baseFunctionalityController");
const { requireSession } = require("../middleware/requireSession");

// ── Public ─────────────────────────────────────────────────────────
router.post("/register", register);
router.post("/login", login);
router.post("/signout", signOut);
router.post("/validate-session", validateSession);

// ── Protected ──────────────────────────────────────────────────────
router.put("/update", requireSession, update);
router.post("/support/ticket", requireSession, supportTicket);
router.get("/appointments/:userId", requireSession, listAppointments);
router.post("/appointments", requireSession, bookAppointment);
router.put(
  "/appointments/:bookingId/reschedule",
  requireSession,
  rescheduleAppointment,
);
router.get("/myNotifications/:userId", requireSession, getMyTickets);
router.delete(
  "/myNotifications/:userId/:ticketId",
  requireSession,
  deleteNotification,
);
router.get(
  "/myConfirmedAppointments/:userId",
  requireSession,
  confirmedAppointments,
);
router.delete("/myNotifications/:userId", requireSession, clearNotifications);

module.exports = router;
