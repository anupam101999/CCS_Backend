const userRoute = require("express").Router();
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
userRoute.post("/register", register);
userRoute.post("/login", login);
userRoute.post("/signout", signOut);
userRoute.post("/validate-session", validateSession);

// ── Protected ──────────────────────────────────────────────────────
userRoute.put("/update", requireSession, update);
userRoute.post("/support/ticket", requireSession, supportTicket);
userRoute.get("/appointments/:userId", requireSession, listAppointments);
userRoute.post("/appointments", requireSession, bookAppointment);
userRoute.put(
  "/appointments/:bookingId/reschedule",
  requireSession,
  rescheduleAppointment,
);
userRoute.get("/myNotifications/:userId", requireSession, getMyTickets);
userRoute.delete(
  "/myNotifications/:userId/:ticketId",
  requireSession,
  deleteNotification,
);
userRoute.get(
  "/myConfirmedAppointments/:userId",
  requireSession,
  confirmedAppointments,
);
userRoute.delete("/myNotifications/:userId", requireSession, clearNotifications);

module.exports = userRoute;
