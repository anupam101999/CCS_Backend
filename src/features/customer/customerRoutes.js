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
const { requireFeatureAccess } = require("../../middleware/requireFeatureAccess");
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
userRoute.post("/support/ticket", requireSession, requireFeatureAccess("tickets"), supportTicket);
userRoute.put("/support/tickets/:ticketId", requireSession, requireFeatureAccess("tickets"), updateTicket);
userRoute.post(
  "/support/tickets/:ticketId/messages",
  requireSession,
  requireFeatureAccess("tickets"),
  addTicketMessage,
);
userRoute.delete(
  "/support/tickets/:ticketId/photos",
  requireSession,
  requireFeatureAccess("tickets"),
  deleteTicketPhoto,
);
userRoute.delete(
  "/appointments/:bookingId/photos",
  requireSession,
  requireFeatureAccess("appointments"),
  deleteAppointmentPhoto,
);
userRoute.get("/appointments/:userId", requireSession, requireFeatureAccess("appointments"), listAppointments);
userRoute.post("/appointments", requireSession, requireFeatureAccess("appointments"), bookAppointment);
userRoute.put("/appointments/:bookingId", requireSession, requireFeatureAccess("appointments"), updateAppointment);
userRoute.put(
  "/appointments/:bookingId/reschedule",
  requireSession,
  requireFeatureAccess("appointments"),
  rescheduleAppointment,
);
userRoute.get("/myNotifications/:userId", requireSession, requireFeatureAccess("tickets"), getMyTickets);
userRoute.get(
  "/myNotifications/:userId/home",
  requireSession,
  requireFeatureAccess("tickets"),
  getHomeNotifications,
);
userRoute.put(
  "/myNotifications/:userId/:ticketId/read",
  requireSession,
  requireFeatureAccess("tickets"),
  markNotificationRead,
);
userRoute.delete(
  "/myNotifications/:userId/home/:ticketId",
  requireSession,
  requireFeatureAccess("tickets"),
  clearHomeNotification,
);
userRoute.delete(
  "/myNotifications/:userId/home",
  requireSession,
  requireFeatureAccess("tickets"),
  clearHomeNotifications,
);
userRoute.delete(
  "/myNotifications/:userId/:ticketId",
  requireSession,
  requireFeatureAccess("tickets"),
  deleteNotification,
);
userRoute.get(
  "/myConfirmedAppointments/:userId",
  requireSession,
  requireFeatureAccess("appointments"),
  confirmedAppointments,
);
userRoute.delete(
  "/myNotifications/:userId",
  requireSession,
  requireFeatureAccess("tickets"),
  clearNotifications,
);

module.exports = userRoute;
