const adminRoutes = require("express").Router();
const { requireAdmin } = require("../../middleware/requireAdmin");
const {
  getStats,
  getAllUsers,
  updateUserRole,
  updateUserAccess,
  getFeatureAccess,
  updateFeatureAccess,
  updateUserFeatureAccess,
  getAllAppointments,
  updateAppointment,
  updateAppointmentStatus,
  getAllTickets,
  updateTicket,
  getLogs,
} = require("./adminController");
const {
  deleteTicketPhoto,
  deleteAppointmentPhoto,
} = require("../customer/customerSupportController");

adminRoutes.get("/stats",                          requireAdmin, getStats);
adminRoutes.get("/users",                          requireAdmin, getAllUsers);
adminRoutes.put("/users/:userId/role",             requireAdmin, updateUserRole);
adminRoutes.put("/users/:userId/access",           requireAdmin, updateUserAccess);
adminRoutes.get("/feature-access",                 requireAdmin, getFeatureAccess);
adminRoutes.put("/feature-access/:role/:feature",  requireAdmin, updateFeatureAccess);
adminRoutes.put("/users/:userId/features/:feature", requireAdmin, updateUserFeatureAccess);
adminRoutes.get("/appointments",                   requireAdmin, getAllAppointments);
adminRoutes.put("/appointments/:bookingId",        requireAdmin, updateAppointment);
adminRoutes.put("/appointments/:bookingId/status", requireAdmin, updateAppointmentStatus);
adminRoutes.get("/tickets",                        requireAdmin, getAllTickets);
adminRoutes.put("/tickets/:ticketId",              requireAdmin, updateTicket);
adminRoutes.delete("/tickets/:ticketId/photos",    requireAdmin, deleteTicketPhoto);
adminRoutes.delete("/appointments/:bookingId/photos", requireAdmin, deleteAppointmentPhoto);
adminRoutes.get("/logs",                           requireAdmin, getLogs);

module.exports = adminRoutes;
