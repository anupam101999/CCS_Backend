const userRoute = require("express").Router();
const {
  register,
  verifyRegistrationEmail,
  login,
  requestEmailChange,
  verifyEmailChange,
  update,
  supportTicket,
  updateTicket,
  addTicketMessage,
  listAppointments,
  bookAppointment,
  updateAppointment,
  rescheduleAppointment,
  getMyTickets,
  getHomeNotifications,
  markNotificationRead,
  clearHomeNotification,
  clearHomeNotifications,
  deleteNotification,
  clearNotifications,
  deleteTicketPhoto,
  deleteAppointmentPhoto,
  confirmedAppointments,
  signOut,
  tokenRefresh,
  requestPasswordReset,
  resetPassword,
} = require("./customerController");
const { requireSession } = require("../../middleware/requireSession");
const { requireTrustedOrigin } = require("../../middleware/requireTrustedOrigin");
const {
  loginLimiter,
  passwordResetLimiter,
  refreshLimiter,
  verificationLimiter,
} = require("../../middleware/authRateLimits");

// Public
userRoute.post("/register", verificationLimiter, register);
userRoute.post("/register/verify-email", verificationLimiter, verifyRegistrationEmail);
userRoute.post("/login", loginLimiter, login);
userRoute.post("/forgot-password", passwordResetLimiter, requestPasswordReset);
userRoute.post("/reset-password", passwordResetLimiter, resetPassword);
userRoute.post("/signout", requireTrustedOrigin, signOut);
userRoute.post("/token-refresh", requireTrustedOrigin, refreshLimiter, tokenRefresh);

// Protected
userRoute.put("/update", requireSession, update);
userRoute.post("/email-change/request", requireSession, requestEmailChange);
userRoute.post("/email-change/verify", requireSession, verifyEmailChange);
userRoute.post("/support/ticket", requireSession, supportTicket);
userRoute.put("/support/tickets/:ticketId", requireSession, updateTicket);
userRoute.post(
  "/support/tickets/:ticketId/messages",
  requireSession,
  addTicketMessage,
);
userRoute.delete(
  "/support/tickets/:ticketId/photos",
  requireSession,
  deleteTicketPhoto,
);
userRoute.delete(
  "/appointments/:bookingId/photos",
  requireSession,
  deleteAppointmentPhoto,
);
userRoute.get("/appointments/:userId", requireSession, listAppointments);
userRoute.post("/appointments", requireSession, bookAppointment);
userRoute.put("/appointments/:bookingId", requireSession, updateAppointment);
userRoute.put(
  "/appointments/:bookingId/reschedule",
  requireSession,
  rescheduleAppointment,
);
userRoute.get("/myNotifications/:userId", requireSession, getMyTickets);
userRoute.get(
  "/myNotifications/:userId/home",
  requireSession,
  getHomeNotifications,
);
userRoute.put(
  "/myNotifications/:userId/:ticketId/read",
  requireSession,
  markNotificationRead,
);
userRoute.delete(
  "/myNotifications/:userId/home/:ticketId",
  requireSession,
  clearHomeNotification,
);
userRoute.delete(
  "/myNotifications/:userId/home",
  requireSession,
  clearHomeNotifications,
);
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
userRoute.delete(
  "/myNotifications/:userId",
  requireSession,
  clearNotifications,
);

module.exports = userRoute;
