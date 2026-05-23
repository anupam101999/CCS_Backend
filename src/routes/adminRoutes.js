const adminRoutes = require("express").Router();
const { requireAdmin } = require("../middleware/requireAdmin");
const {
  getStats,
  getAllAppointments,
  updateAppointmentStatus,
  getAllTickets,
  updateTicket,
} = require("../controllers/adminController");

adminRoutes.get("/stats",                          requireAdmin, getStats);
adminRoutes.get("/appointments",                   requireAdmin, getAllAppointments);
adminRoutes.put("/appointments/:bookingId/status", requireAdmin, updateAppointmentStatus);
adminRoutes.get("/tickets",                        requireAdmin, getAllTickets);
adminRoutes.put("/tickets/:ticketId",              requireAdmin, updateTicket);

module.exports = adminRoutes;