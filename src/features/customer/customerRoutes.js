const userRoute = require("express").Router();
const {
  register,
  verifyRegistrationEmail,
  login,
  signOut,
  tokenRefresh,
  requestPasswordReset,
  resetPassword,
} = require("./customerAuthController");
const {
  requestEmailChange,
  verifyEmailChange,
  update,
} = require("./customerProfileController");
const {
  supportTicket,
  updateTicket,
  addTicketMessage,
  getMyTickets,
  getHomeNotifications,
  markNotificationRead,
  clearHomeNotification,
  clearHomeNotifications,
  deleteNotification,
  clearNotifications,
  deleteTicketPhoto,
  deleteAppointmentPhoto,
} = require("./customerSupportController");
const {
  listAppointments,
  bookAppointment,
  updateAppointment,
  rescheduleAppointment,
  confirmedAppointments,
} = require("./customerAppointmentController");
const { requireSession } = require("../../middleware/requireSession");
const { requireFeatureAccess } = require("../../middleware/requireFeatureAccess");
const { requireTrustedOrigin } = require("../../middleware/requireTrustedOrigin");
const {
  loginLimiter,
  passwordResetLimiter,
  refreshLimiter,
  verificationLimiter,
} = require("../../middleware/authRateLimits");

const requireTickets = requireFeatureAccess("tickets");
const requireAppointments = requireFeatureAccess("appointments");

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
userRoute.post("/support/ticket", requireSession, requireTickets, supportTicket);
userRoute.put("/support/tickets/:ticketId", requireSession, requireTickets, updateTicket);
userRoute.post(
  "/support/tickets/:ticketId/messages",
  requireSession,
  requireTickets,
  addTicketMessage,
);
userRoute.delete(
  "/support/tickets/:ticketId/photos",
  requireSession,
  requireTickets,
  deleteTicketPhoto,
);
userRoute.delete(
  "/appointments/:bookingId/photos",
  requireSession,
  requireAppointments,
  deleteAppointmentPhoto,
);
userRoute.get("/appointments/:userId", requireSession, requireAppointments, listAppointments);
userRoute.post("/appointments", requireSession, requireAppointments, bookAppointment);
userRoute.put("/appointments/:bookingId", requireSession, requireAppointments, updateAppointment);
userRoute.put(
  "/appointments/:bookingId/reschedule",
  requireSession,
  requireAppointments,
  rescheduleAppointment,
);
userRoute.get("/myNotifications/:userId", requireSession, requireTickets, getMyTickets);
userRoute.get(
  "/myNotifications/:userId/home",
  requireSession,
  requireTickets,
  getHomeNotifications,
);
userRoute.put(
  "/myNotifications/:userId/:ticketId/read",
  requireSession,
  requireTickets,
  markNotificationRead,
);
userRoute.delete(
  "/myNotifications/:userId/home/:ticketId",
  requireSession,
  requireTickets,
  clearHomeNotification,
);
userRoute.delete(
  "/myNotifications/:userId/home",
  requireSession,
  requireTickets,
  clearHomeNotifications,
);
userRoute.delete(
  "/myNotifications/:userId/:ticketId",
  requireSession,
  requireTickets,
  deleteNotification,
);
userRoute.get(
  "/myConfirmedAppointments/:userId",
  requireSession,
  requireAppointments,
  confirmedAppointments,
);
userRoute.delete(
  "/myNotifications/:userId",
  requireSession,
  requireTickets,
  clearNotifications,
);

module.exports = userRoute;
