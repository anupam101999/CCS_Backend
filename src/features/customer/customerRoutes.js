const userRoute = require("express").Router();
const {
  register,
  verifyRegistrationEmail,
  login,
  requestEmailChange,
  verifyEmailChange,
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
  tokenRefresh,
  requestPasswordReset,
  resetPassword,
} = require("./customerController");
const { requireSession } = require("../../middleware/requireSession");

// ── Public ─────────────────────────────────────────────────────────
userRoute.post("/register", register);
userRoute.post("/register/verify-email", verifyRegistrationEmail);
userRoute.post("/login", login);
userRoute.post("/forgot-password", requestPasswordReset);
userRoute.post("/reset-password", resetPassword);
userRoute.post("/signout", requireSession, signOut);
userRoute.post("/token-refresh", requireSession, tokenRefresh);

// ── Protected ──────────────────────────────────────────────────────
userRoute.put("/update", requireSession, update);
userRoute.post("/email-change/request", requireSession, requestEmailChange);
userRoute.post("/email-change/verify", requireSession, verifyEmailChange);
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
