const adminRoutes = require("express").Router();
const { requireAdmin } = require("../../middleware/requireAdmin");
const {
  getStats,
  getAllUsers,
  getAllAppointments,
  updateAppointment,
  updateAppointmentStatus,
  getAllTickets,
  updateTicket,
  getLogs,
} = require("./adminController");

adminRoutes.get("/stats",                          requireAdmin, getStats);
adminRoutes.get("/users",                          requireAdmin, getAllUsers);
adminRoutes.get("/appointments",                   requireAdmin, getAllAppointments);
adminRoutes.put("/appointments/:bookingId",        requireAdmin, updateAppointment);
adminRoutes.put("/appointments/:bookingId/status", requireAdmin, updateAppointmentStatus);
adminRoutes.get("/tickets",                        requireAdmin, getAllTickets);
adminRoutes.put("/tickets/:ticketId",              requireAdmin, updateTicket);
adminRoutes.get("/logs",                           requireAdmin, getLogs);

module.exports = adminRoutes;
